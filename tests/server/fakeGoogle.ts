/**
 * In-memory stand-in for Google's OAuth and Drive v3 REST endpoints, used only by the server tests
 * so connect / upload / dedupe / retry paths run end to end without real credentials.
 */
import { createHash } from 'node:crypto'

interface FakeFile { id: string; name: string; mimeType: string; parents: string[]; appProperties: Record<string, string>; md5Checksum?: string; data?: Buffer; trashed: boolean }

export function fakeGoogle(opts: { email?: string } = {}) {
  const files = new Map<string, FakeFile>()
  let seq = 0
  const calls: string[] = []
  const state = { email: opts.email ?? 'babasolars76@gmail.com', failNextUploads: 0, uploads: 0, creates: 0, revoked: false }
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push(`${method} ${url.host}${url.pathname}`)
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
      const p = new URLSearchParams(String(init.body))
      if (p.get('grant_type') === 'authorization_code') {
        if (p.get('code') !== 'good-code' || !p.get('code_verifier')) return json(400, { error: 'invalid_grant' })
        return json(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.file' })
      }
      if (state.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      return json(200, { access_token: `at-${++seq}`, expires_in: 3600 })
    }
    if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') return json(200, {})
    if (url.host === 'openidconnect.googleapis.com') return json(200, { email: state.email, email_verified: true })
    if (url.host !== 'www.googleapis.com') return json(404, { error: { message: 'unknown host' } })
    if (!String((init.headers as Record<string, string>)?.Authorization ?? '').startsWith('Bearer ')) return json(401, { error: { message: 'no auth' } })

    const isUpload = url.pathname.startsWith('/upload/drive/v3/files')
    const idMatch = url.pathname.match(/\/files\/([^/]+)$/)
    if (!isUpload && method === 'GET' && !idMatch) {
      const q = url.searchParams.get('q') ?? ''
      const list = [...files.values()].filter((f) => {
        if (f.trashed) return false
        const name = q.match(/name = '((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1')
        if (name !== undefined && f.name !== name) return false
        if (q.includes("mimeType = 'application/vnd.google-apps.folder'") && f.mimeType !== 'application/vnd.google-apps.folder') return false
        const parent = q.match(/'([^']+)' in parents/)?.[1]
        if (parent && !(parent === 'root' ? f.parents.length === 0 : f.parents.includes(parent))) return false
        const key = q.match(/key='bsKey' and value='((?:[^'\\]|\\.)*)'/)?.[1]?.replace(/\\(.)/g, '$1')
        if (key !== undefined && f.appProperties.bsKey !== key) return false
        return true
      })
      return json(200, { files: list.map((f) => ({ id: f.id, name: f.name, md5Checksum: f.md5Checksum })) })
    }
    if (!isUpload && method === 'GET' && idMatch) {
      const f = files.get(decodeURIComponent(idMatch[1]))
      return f ? json(200, { id: f.id, name: f.name, md5Checksum: f.md5Checksum, trashed: f.trashed, parents: f.parents }) : json(404, { error: { message: 'File not found' } })
    }
    if (!isUpload && method === 'POST') {
      const meta = JSON.parse(String(init.body))
      const id = `folder${++seq}`
      files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents ?? [], appProperties: {}, trashed: false })
      return json(200, { id })
    }
    if (isUpload) {
      if (state.failNextUploads > 0) { state.failNextUploads--; return json(503, { error: { message: 'Backend Error', errors: [{ reason: 'backendError' }] } }) }
      const raw = Buffer.from(init.body as Uint8Array)
      const boundary = String((init.headers as Record<string, string>)['Content-Type']).split('boundary=')[1]
      const text = raw.toString('latin1')
      const parts = text.split(`--${boundary}`)
      const meta = JSON.parse(parts[1].split('\r\n\r\n')[1].trim())
      const headerEnd = raw.indexOf('\r\n\r\n', raw.indexOf(`--${boundary}`, 10)) + 4
      const end = raw.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))
      const data = raw.subarray(headerEnd, end)
      const md5 = createHash('md5').update(data).digest('hex')
      state.uploads++
      if (method === 'POST') {
        const id = `file${++seq}`
        state.creates++
        files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, appProperties: meta.appProperties, md5Checksum: md5, data, trashed: false })
        return json(200, { id, name: meta.name, md5Checksum: md5 })
      }
      const f = files.get(decodeURIComponent(idMatch![1]))
      if (!f) return json(404, { error: { message: 'File not found' } })
      Object.assign(f, { name: meta.name, appProperties: meta.appProperties, md5Checksum: md5, data })
      const add = url.searchParams.get('addParents')
      if (add) f.parents = [add]
      return json(200, { id: f.id, name: f.name, md5Checksum: md5 })
    }
    return json(400, { error: { message: `unhandled ${method} ${url.pathname}` } })
  }) as typeof fetch

  const pathOf = (f: FakeFile): string => {
    const parent = f.parents[0] ? files.get(f.parents[0]) : undefined
    return parent ? `${pathOf(parent)}/${f.name}` : f.name
  }
  return {
    fetchFn, state, calls,
    files: () => [...files.values()].filter((f) => f.mimeType !== 'application/vnd.google-apps.folder' && !f.trashed).map((f) => ({ ...f, path: pathOf(f) })),
    folders: () => [...files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map(pathOf).sort(),
  }
}
