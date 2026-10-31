import { randomBytes } from 'node:crypto'
import type { ServerConfig } from '../config'
import type { Logger } from '../logger'
import type { DocumentRecord, DocumentRepository } from '../storage/documentRepository'
import type { FileStorage } from '../storage/fileStorage'
import { KIND_FOLDER, MIME, safeSegment } from '../documents/naming'
import { DriveClient, GoogleApiError, authorizationUrl, exchangeCode, fetchEmail, pkcePair, revoke, type FetchFn } from './google'
import { TokenVault, type DriveAuthState } from './tokenVault'

export interface DriveStatusInfo {
  configured: boolean
  connected: boolean
  account: string | null
  expectedAccount: string | null
  rootFolder: string | null
  connectedAt: string | null
  lastError: string | null
  counts: Record<DocumentRecord['drive']['status'], number>
}

/**
 * Google Drive backup of every stored document:
 *  - OAuth 2.0 connect (state + PKCE), only the configured account (babasolars76@gmail.com) is accepted
 *  - Folders: <root>/Quotations|Billing/<Client>/  (created once, ids cached)
 *  - No duplicates: one Drive file per document key; re-saves update that file, unchanged content is skipped
 *    (MD5 compare), and a lost registry is recovered by searching the file's appProperties
 *  - Failures retry with exponential backoff (30 s → 6 h), then stay "failed" until retried by an admin
 */
export class DriveBackup {
  private vault: TokenVault | null
  private state: DriveAuthState | null = null
  private client: DriveClient | null = null
  private pending = new Map<string, { verifier: string; userId: string; exp: number }>()
  private timer: NodeJS.Timeout | null = null
  private current: Promise<number> | null = null
  private lastError: string | null = null
  private loaded = false

  constructor(private cfg: ServerConfig, private docs: DocumentRepository, private files: FileStorage, private log: Logger, private fetchFn: FetchFn = fetch) {
    this.vault = cfg.google?.encryptionKey ? new TokenVault(cfg.dataDir, cfg.google.encryptionKey) : null
  }

  get configured() { return !!this.cfg.google }

  private async ensureLoaded() {
    if (this.loaded || !this.vault || !this.cfg.google) return
    this.loaded = true
    try {
      this.state = await this.vault.load()
      if (this.state) this.client = new DriveClient(this.fetchFn, this.cfg.google, this.state.refreshToken)
    } catch (e) {
      this.lastError = `Saved Drive connection could not be read (${(e as Error).message}). Connect again.`
      this.log.error('drive_token_unreadable', { error: (e as Error).message })
    }
  }

  async status(): Promise<DriveStatusInfo> {
    await this.ensureLoaded()
    const counts = { pending: 0, uploading: 0, uploaded: 0, failed: 0, disabled: 0 }
    for (const d of await this.docs.list()) counts[d.drive.status]++
    return {
      configured: this.configured, connected: !!this.state, account: this.state?.email ?? null,
      expectedAccount: this.cfg.google?.accountEmail ?? null, rootFolder: this.cfg.google?.rootFolderName ?? null,
      connectedAt: this.state?.connectedAt ?? null, lastError: this.lastError, counts,
    }
  }

  /** Step 1: URL of Google's consent screen. */
  startConnect(userId: string) {
    if (!this.cfg.google) throw new Error('Google Drive is not configured on the server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).')
    const now = Date.now()
    for (const [k, v] of this.pending) if (v.exp < now) this.pending.delete(k)
    const state = randomBytes(24).toString('base64url')
    const { verifier, challenge } = pkcePair()
    this.pending.set(state, { verifier, userId, exp: now + 10 * 60_000 })
    return authorizationUrl(this.cfg.google, state, challenge, this.cfg.google.accountEmail)
  }

  /** Step 2: Google redirects back with ?code&state. Returns an error message or null. */
  async finishConnect(code: string, state: string): Promise<string | null> {
    const g = this.cfg.google
    const p = this.pending.get(state)
    this.pending.delete(state)
    if (!g || !p || p.exp < Date.now()) return 'The sign-in link expired. Start “Connect Google Drive” again.'
    try {
      const t = await exchangeCode(this.fetchFn, g, code, p.verifier)
      const who = await fetchEmail(this.fetchFn, t.access_token)
      if (!who.verified || who.email !== g.accountEmail) {
        await revoke(this.fetchFn, t.refresh_token ?? t.access_token)
        return `Please sign in with ${g.accountEmail} (you used ${who.email || 'another account'}).`
      }
      if (!t.refresh_token) return 'Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.'
      if (!t.scope.includes('drive.file')) return 'Drive permission was not granted. Tick the Google Drive box on the consent screen.'
      this.state = { email: who.email, refreshToken: t.refresh_token, scope: t.scope, connectedAt: new Date().toISOString(), connectedBy: p.userId, folders: {} }
      await this.vault!.save(this.state)
      this.client = new DriveClient(this.fetchFn, g, t.refresh_token)
      this.lastError = null
      this.log.info('drive_connected', { account: who.email })
      // Everything not yet in Drive gets queued.
      for (const d of await this.docs.list()) if (d.drive.status !== 'uploaded') await this.docs.patchDrive(d.id, { status: 'pending', attempts: 0, nextAttemptAt: 0, lastError: null })
      void this.runOnce()
      return null
    } catch (e) {
      this.log.error('drive_connect_failed', { error: (e as Error).message })
      return `Google sign-in failed: ${(e as Error).message}`
    }
  }

  async disconnect() {
    await this.ensureLoaded()
    if (this.state) await revoke(this.fetchFn, this.state.refreshToken)
    this.state = null
    this.client = null
    await this.vault?.clear()
  }

  /** New / changed document → queue it. */
  async enqueue(id: string) {
    await this.docs.patchDrive(id, { status: this.configured ? 'pending' : 'disabled', attempts: 0, nextAttemptAt: 0, lastError: null })
    if (this.configured) setImmediate(() => void this.runOnce())
  }

  async retryFailed() {
    let n = 0
    for (const d of await this.docs.list()) if (d.drive.status === 'failed' || d.drive.status === 'disabled') { await this.enqueue(d.id); n++ }
    return n
  }

  start() {
    if (!this.configured || this.timer) return
    this.timer = setInterval(() => void this.runOnce(), this.cfg.drive.pollSeconds * 1000)
    this.timer.unref()
    void this.runOnce()
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }

  /** One pass over the queue (one upload at a time). If a pass is running, waits for it and runs another. */
  async runOnce(): Promise<number> {
    while (this.current) await this.current.catch(() => 0)
    this.current = this.pass()
    try { return await this.current } finally { this.current = null }
  }

  private async pass(): Promise<number> {
    let done = 0
    await this.ensureLoaded()
    if (!this.client || !this.state) return 0
    const now = Date.now()
    const due = (await this.docs.list()).filter((d) => d.drive.status === 'pending' && d.drive.nextAttemptAt <= now)
    for (const d of due) {
      if (!this.client) break
      if (await this.uploadOne(d)) done++
    }
    return done
  }

  private async folderFor(d: DocumentRecord): Promise<string> {
    const names = [this.cfg.google!.rootFolderName, KIND_FOLDER[d.kind], ...(this.cfg.clientSubfolders ? [safeSegment(d.clientName, 'Client', 80)] : [])]
    let parent: string | null = null
    let pathKey = ''
    for (const name of names) {
      pathKey += `/${name}`
      let id: string | null = this.state!.folders[pathKey] ?? null
      if (id && !(await this.client!.folderExists(id))) id = null
      if (!id) {
        id = (await this.client!.findFolder(name, parent)) ?? (await this.client!.createFolder(name, parent))
        this.state!.folders[pathKey] = id
        await this.vault!.save(this.state!)
      }
      parent = id
    }
    return parent!
  }

  private async uploadOne(d: DocumentRecord): Promise<boolean> {
    await this.docs.patchDrive(d.id, { status: 'uploading' })
    try {
      const data = await this.files.read(d.relativePath)
      const parentId = await this.folderFor(d)
      let existing = d.drive.fileId ? await this.client!.getFile(d.drive.fileId) : null
      if (existing?.trashed) existing = null
      if (!existing) {
        const found = await this.client!.findByKey(d.key)
        existing = found ? await this.client!.getFile(found.id) : null
      }
      const props = { bsKey: d.key, bsKind: d.kind, bsDocNumber: d.docNumber.slice(0, 100), bsSha256: d.sha256 }
      let fileId: string
      if (existing && existing.md5Checksum === d.md5 && existing.name === d.fileName && existing.parents?.includes(parentId)) {
        fileId = existing.id // identical file already there — no duplicate upload
      } else {
        const res = await this.client!.upload({
          id: existing?.id ?? null, name: d.fileName, parentId, mime: MIME[d.format], data, appProperties: props,
          removeParents: existing?.parents?.filter((p) => p !== parentId),
        })
        if (res.md5Checksum && res.md5Checksum !== d.md5) throw new GoogleApiError(500, 'Uploaded file checksum does not match — will retry.')
        fileId = res.id
      }
      // The local file may have been replaced while uploading — then upload again.
      const fresh = await this.docs.get(d.id)
      const changed = fresh && fresh.sha256 !== d.sha256
      await this.docs.patchDrive(d.id, { status: changed ? 'pending' : 'uploaded', fileId, attempts: 0, nextAttemptAt: 0, lastError: null, uploadedAt: new Date().toISOString(), uploadedMd5: d.md5 })
      this.lastError = null
      this.log.info('drive_uploaded', { doc: d.key, fileId })
      return true
    } catch (e) {
      const err = e instanceof GoogleApiError ? e : new GoogleApiError(0, (e as Error).message)
      if (err.status === 400 && /invalid_grant/i.test(err.message + err.reason)) {
        // Refresh token revoked/expired: stop until an admin reconnects; the document stays queued.
        this.lastError = 'Google Drive access was revoked or expired. Connect Google Drive again.'
        this.state = null
        this.client = null
        await this.vault?.clear()
        await this.docs.patchDrive(d.id, { status: 'pending', lastError: this.lastError })
        this.log.error('drive_token_revoked', {})
        return false
      }
      const attempts = d.drive.attempts + 1
      const give = !err.retryable || attempts >= this.cfg.drive.maxAttempts
      const delay = Math.min(6 * 3600_000, 30_000 * 2 ** (attempts - 1)) * (0.8 + Math.random() * 0.4)
      await this.docs.patchDrive(d.id, { status: give ? 'failed' : 'pending', attempts, nextAttemptAt: Date.now() + delay, lastError: err.message.slice(0, 300) })
      this.lastError = err.message.slice(0, 300)
      this.log.warn('drive_upload_failed', { doc: d.key, attempts, status: err.status, error: err.message.slice(0, 200), willRetry: !give })
      return false
    }
  }
}
