import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { atomicWrite } from '../storage/jsonStore'

/** Google refresh token, encrypted at rest with AES-256-GCM (key: TOKEN_ENCRYPTION_KEY). Never sent to the browser. */
export interface DriveAuthState {
  email: string
  refreshToken: string
  scope: string
  connectedAt: string
  connectedBy: string
  folders: Record<string, string> // folder path → Drive folder id cache
}

export class TokenVault {
  private file: string
  constructor(dataDir: string, private key: Buffer) { this.file = path.join(dataDir, 'google-drive.enc') }

  async load(): Promise<DriveAuthState | null> {
    let raw: string
    try { raw = await readFile(this.file, 'utf8') } catch { return null }
    const [v, iv, tag, data] = raw.trim().split('.')
    if (v !== 'v1') throw new Error('Unknown Drive token file format.')
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    const json = Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
    return JSON.parse(json) as DriveAuthState
  }

  async save(state: DriveAuthState) {
    const iv = randomBytes(12)
    const c = createCipheriv('aes-256-gcm', this.key, iv)
    const data = Buffer.concat([c.update(JSON.stringify(state), 'utf8'), c.final()])
    await atomicWrite(this.file, ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.'))
  }

  async clear() { await rm(this.file, { force: true }) }
}
