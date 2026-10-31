import { createHash, randomBytes } from 'node:crypto'

/**
 * Minimal Google OAuth 2.0 + Drive v3 REST client (no SDK): authorization-code flow with PKCE,
 * refresh tokens, folder management and multipart uploads. Scope `drive.file` gives access only to
 * files this app creates — never the rest of the Drive.
 */
export const GOOGLE = {
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  revokeUrl: 'https://oauth2.googleapis.com/revoke',
  userinfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
  filesUrl: 'https://www.googleapis.com/drive/v3/files',
  uploadUrl: 'https://www.googleapis.com/upload/drive/v3/files',
}
export const DRIVE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file']
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export type FetchFn = typeof fetch

export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public reason = '') { super(message) }
  /** Worth retrying later (network trouble, rate limit, Google outage). */
  get retryable() { return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500 || (this.status === 403 && /rateLimit|userRateLimit/i.test(this.reason)) }
}

async function call<T>(f: FetchFn, url: string, init: RequestInit): Promise<T> {
  let res: Response
  try { res = await f(url, { ...init, signal: AbortSignal.timeout(60_000) }) } catch (e) { throw new GoogleApiError(0, `Network error: ${(e as Error).message}`) }
  const text = await res.text()
  let json: Record<string, unknown> = {}
  try { json = text ? JSON.parse(text) : {} } catch { /* not JSON */ }
  if (!res.ok) {
    const err = json.error as { message?: string; errors?: Array<{ reason?: string }> } | string | undefined
    const message = typeof err === 'string' ? `${err}${json.error_description ? `: ${json.error_description}` : ''}` : err?.message ?? `HTTP ${res.status}`
    const reason = typeof err === 'string' ? err : err?.errors?.[0]?.reason ?? ''
    throw new GoogleApiError(res.status, message, reason)
  }
  return json as T
}

export function pkcePair() {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export interface OAuthClient { clientId: string; clientSecret: string; redirectUri: string }

export function authorizationUrl(c: OAuthClient, state: string, challenge: string, loginHint: string) {
  const p = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', scope: DRIVE_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state, code_challenge: challenge,
    code_challenge_method: 'S256', login_hint: loginHint,
  })
  return `${GOOGLE.authUrl}?${p}`
}

export async function exchangeCode(f: FetchFn, c: OAuthClient, code: string, verifier: string) {
  return call<{ access_token: string; refresh_token?: string; scope: string; expires_in: number; id_token?: string }>(f, GOOGLE.tokenUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: c.redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),
  })
}

export async function fetchEmail(f: FetchFn, accessToken: string) {
  const u = await call<{ email?: string; email_verified?: boolean }>(f, GOOGLE.userinfoUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  return { email: (u.email ?? '').toLowerCase(), verified: u.email_verified === true }
}

export async function revoke(f: FetchFn, token: string) {
  try { await call(f, `${GOOGLE.revokeUrl}?token=${encodeURIComponent(token)}`, { method: 'POST' }) } catch { /* already revoked */ }
}

/** Drive client bound to one refresh token. Access tokens are cached until shortly before expiry. */
export class DriveClient {
  private access: { token: string; exp: number } | null = null
  constructor(private f: FetchFn, private c: OAuthClient, private refreshToken: string) {}

  async token(): Promise<string> {
    if (this.access && this.access.exp - 60_000 > Date.now()) return this.access.token
    const t = await call<{ access_token: string; expires_in: number }>(this.f, GOOGLE.tokenUrl, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.c.clientId, client_secret: this.c.clientSecret, refresh_token: this.refreshToken, grant_type: 'refresh_token' }),
    })
    this.access = { token: t.access_token, exp: Date.now() + t.expires_in * 1000 }
    return t.access_token
  }

  private async auth(init: RequestInit = {}) {
    return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await this.token()}` } }
  }

  private static q(s: string) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'") }

  async findFolder(name: string, parentId: string | null) {
    const q = `name = '${DriveClient.q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${parentId ?? 'root'}' in parents`
    const r = await call<{ files: Array<{ id: string }> }>(this.f, `${GOOGLE.filesUrl}?${new URLSearchParams({ q, fields: 'files(id)', spaces: 'drive', pageSize: '5' })}`, await this.auth())
    return r.files[0]?.id ?? null
  }

  async createFolder(name: string, parentId: string | null) {
    const r = await call<{ id: string }>(this.f, `${GOOGLE.filesUrl}?fields=id`, await this.auth({
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }),
    }))
    return r.id
  }

  async folderExists(id: string) {
    try {
      const r = await call<{ trashed?: boolean }>(this.f, `${GOOGLE.filesUrl}/${encodeURIComponent(id)}?fields=id,trashed`, await this.auth())
      return !r.trashed
    } catch (e) { if (e instanceof GoogleApiError && e.status === 404) return false; throw e }
  }

  /** File previously uploaded for this document key (survives a lost registry). */
  async findByKey(key: string) {
    const q = `appProperties has { key='bsKey' and value='${DriveClient.q(key)}' } and trashed = false`
    const r = await call<{ files: Array<{ id: string; md5Checksum?: string; name: string }> }>(this.f, `${GOOGLE.filesUrl}?${new URLSearchParams({ q, fields: 'files(id,md5Checksum,name)', spaces: 'drive' })}`, await this.auth())
    return r.files[0] ?? null
  }

  async getFile(id: string) {
    try {
      return await call<{ id: string; md5Checksum?: string; name: string; trashed?: boolean; parents?: string[] }>(this.f, `${GOOGLE.filesUrl}/${encodeURIComponent(id)}?fields=id,md5Checksum,name,trashed,parents`, await this.auth())
    } catch (e) { if (e instanceof GoogleApiError && e.status === 404) return null; throw e }
  }

  /** Create (no id) or replace content of an existing file. */
  async upload(opts: { id?: string | null; name: string; parentId: string; mime: string; data: Buffer; appProperties: Record<string, string>; removeParents?: string[] }) {
    const boundary = `bs${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    const meta: Record<string, unknown> = { name: opts.name, mimeType: opts.mime, appProperties: opts.appProperties }
    if (!opts.id) meta.parents = [opts.parentId]
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${opts.mime}\r\n\r\n`),
      opts.data,
      Buffer.from(`\r\n--${boundary}--`),
    ])
    const params = new URLSearchParams({ uploadType: 'multipart', fields: 'id,md5Checksum,name' })
    if (opts.id && opts.removeParents?.length) { params.set('addParents', opts.parentId); params.set('removeParents', opts.removeParents.join(',')) }
    const url = opts.id ? `${GOOGLE.uploadUrl}/${encodeURIComponent(opts.id)}?${params}` : `${GOOGLE.uploadUrl}?${params}`
    return call<{ id: string; md5Checksum?: string; name: string }>(this.f, url, await this.auth({
      method: opts.id ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    }))
  }
}
