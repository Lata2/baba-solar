import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import ExcelJS from 'exceljs'
import { loadConfig, defaultDocumentsRoot } from '../../server/config'
import { createApp } from '../../server/app'
import { createLogger } from '../../server/logger'
import { jsonUserRepository } from '../../server/auth/users'
import { jsonDocumentRepository } from '../../server/storage/documentRepository'
import { localFileStorage } from '../../server/storage/fileStorage'
import { documentFileName, safeSegment } from '../../server/documents/naming'
import { fakeGoogle } from './fakeGoogle'

const ORIGIN = 'http://admin.test'
const AGENT = randomBytes(32).toString('base64url')
let dir: string
let server: Server
let base: string
let ctx: ReturnType<typeof createApp>
let docsRepo: ReturnType<typeof jsonDocumentRepository>
const google = fakeGoogle()

const PDF = (n = 1) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% version ${n}\ntrailer << /Root 1 0 R >>\n%%EOF\n`)
async function XLSX(text = 'hello') {
  const wb = new ExcelJS.Workbook()
  wb.addWorksheet('S').getCell('A1').value = text
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/** Minimal browser: cookie jar + Origin + CSRF header. */
function client() {
  let cookie = ''
  let csrf = ''
  const call = async (method: string, p: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { Origin: ORIGIN, ...extra }
    if (cookie) headers.Cookie = cookie
    if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf
    let payload: RequestInit['body'] | undefined
    if (body instanceof FormData) payload = body
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
    const res = await fetch(base + p, { method, headers, body: payload, redirect: 'manual' })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].includes('=;') || /Expires=Thu, 01 Jan 1970/.test(set) ? '' : set.split(';')[0]
    const ct = res.headers.get('content-type') ?? ''
    const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
    if (data && typeof data === 'object' && 'csrfToken' in data) csrf = (data as { csrfToken: string }).csrfToken
    return { status: res.status, data: data as any, headers: res.headers }
  }
  return { call, get cookie() { return cookie }, set csrf(v: string) { csrf = v }, get csrf() { return csrf } }
}

function docForm(meta: Record<string, unknown>, files: { pdf?: Buffer; xlsx?: Buffer }) {
  const f = new FormData()
  f.set('meta', JSON.stringify(meta))
  if (files.pdf) f.set('pdf', new Blob([new Uint8Array(files.pdf)], { type: 'application/pdf' }), 'q.pdf')
  if (files.xlsx) f.set('xlsx', new Blob([new Uint8Array(files.xlsx)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'q.xlsx')
  return f
}
const meta = (over: Record<string, unknown> = {}) => ({ kind: 'quotation', recordId: 'qt_1', docNumber: 'BS/QT/2026-27/0001', clientName: 'Ramesh Sharma', docDate: '2026-10-30', amount: 160000, record: { id: 'qt_1' }, ...over })

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bs-server-'))
  const cfg = loadConfig({
    NODE_ENV: 'test', APP_ORIGIN: ORIGIN, DATA_DIR: path.join(dir, 'data'), DOCUMENTS_ROOT: path.join(dir, 'Quotation and Billing'), SERVE_FRONTEND: 'false',
    GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret', TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    AGENT_TOKENS: AGENT, DRIVE_POLL_SECONDS: '3600', DRIVE_MAX_ATTEMPTS: '3',
  })
  const users = jsonUserRepository(cfg.dataDir)
  await users.create({ name: 'Admin', email: 'admin@babasolars.in', role: 'admin', password: 'Str0ng!Passw0rd' })
  await users.create({ name: 'Editor', email: 'editor@babasolars.in', role: 'editor', password: 'Edit0r!Passw0rd' })
  await users.create({ name: 'Sales', email: 'sales@babasolars.in', role: 'sales', password: 'Sa1es!Passw0rd' })
  const files = localFileStorage(cfg.documentsRoot)
  await files.ensureLayout()
  docsRepo = jsonDocumentRepository(cfg.dataDir)
  ctx = createApp({ cfg, log: createLogger(true), users, docs: docsRepo, files, fetchFn: google.fetchFn })
  server = ctx.app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`
})
afterAll(async () => { server?.close(); await rm(dir, { recursive: true, force: true }) })

describe('config', () => {
  it('uses C:\\Quotation and Billing on Windows', () => expect(defaultDocumentsRoot('win32')).toBe('C:\\Quotation and Billing'))
  it('rejects a bad encryption key / short agent token', () => {
    expect(() => loadConfig({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b', TOKEN_ENCRYPTION_KEY: 'short' })).toThrow(/TOKEN_ENCRYPTION_KEY/)
    expect(() => loadConfig({ AGENT_TOKENS: 'short' })).toThrow(/AGENT_TOKENS/)
  })
  it('creates Quotations and Billing folders', async () => {
    expect((await stat(path.join(dir, 'Quotation and Billing', 'Quotations'))).isDirectory()).toBe(true)
    expect((await stat(path.join(dir, 'Quotation and Billing', 'Billing'))).isDirectory()).toBe(true)
  })
})

describe('authentication, sessions, CSRF, roles', () => {
  it('rejects wrong passwords and hides whether the email exists', async () => {
    const c = client()
    const a = await c.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'wrong-password' })
    const b = await c.call('POST', '/auth/login', { email: 'nobody@babasolars.in', password: 'wrong-password' })
    expect([a.status, b.status]).toEqual([401, 401])
    expect(a.data.error.message).toBe(b.data.error.message)
  })
  it('locks an account after 5 failures', async () => {
    const c = client()
    for (let i = 0; i < 5; i++) await c.call('POST', '/auth/login', { email: 'sales@babasolars.in', password: `bad-${i}` })
    expect((await c.call('POST', '/auth/login', { email: 'sales@babasolars.in', password: 'Sa1es!Passw0rd' })).status).toBe(429)
  })
  it('logs in with an httpOnly, SameSite=Strict cookie and never returns the password hash', async () => {
    const c = client()
    const res = await c.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' })
    expect(res.status).toBe(200)
    const set = res.headers.get('set-cookie')!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=Strict/i)
    expect(JSON.stringify(res.data)).not.toMatch(/scrypt|passwordHash/)
    expect(res.data.permissions).toContain('users:manage')
    expect((await c.call('GET', '/auth/me')).data.user.email).toBe('admin@babasolars.in')
  })
  it('blocks state changes without the CSRF token or from another origin', async () => {
    const c = client()
    await c.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' })
    const good = c.csrf
    c.csrf = 'forged'
    expect((await c.call('POST', '/users', { name: 'X', email: 'x@y.in', role: 'sales', password: 'Abcdef!12345' })).status).toBe(403)
    c.csrf = good
    expect((await c.call('POST', '/users', { name: 'X', email: 'x@y.in', role: 'sales', password: 'Abcdef!12345' }, { Origin: 'https://evil.example' })).status).toBe(403)
    const plain = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Origin: ORIGIN, Cookie: c.cookie, 'X-CSRF-Token': good, 'Content-Type': 'text/plain' }, body: 'x' })
    expect(plain.status).toBe(415)
  })
  it('enforces roles on the server (editor cannot manage users or save quotations)', async () => {
    const c = client()
    await c.call('POST', '/auth/login', { email: 'editor@babasolars.in', password: 'Edit0r!Passw0rd' })
    expect((await c.call('GET', '/users')).status).toBe(403)
    expect((await c.call('POST', '/documents', docForm(meta(), { pdf: PDF() }))).status).toBe(403)
  })
  it('requires a session for documents', async () => {
    expect((await client().call('GET', '/documents')).status).toBe(401)
  })
  it('validates new users (weak password, duplicate email) and keeps one admin', async () => {
    const c = client()
    const me = await c.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' })
    expect((await c.call('POST', '/users', { name: 'W', email: 'w@b.in', role: 'sales', password: 'short' })).data.error.fieldErrors.password).toBeTruthy()
    expect((await c.call('POST', '/users', { name: 'D', email: 'editor@babasolars.in', role: 'sales', password: 'Abcdef!12345' })).status).toBe(409)
    expect((await c.call('PATCH', `/users/${me.data.user.id}`, { role: 'sales' })).status).toBe(400)
  })
  it('logout ends the session', async () => {
    const c = client()
    await c.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' })
    const cookie = c.cookie
    expect((await c.call('POST', '/auth/logout')).status).toBe(200)
    const replay = await fetch(`${base}/auth/me`, { headers: { Cookie: cookie } })
    expect(replay.status).toBe(401)
  })
})

describe('documents: validation, naming, local storage, dedupe', () => {
  const admin = client()
  beforeAll(async () => { await admin.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' }) })

  it('Windows-safe file names with document number and client name', () => {
    expect(documentFileName('BS/QT/2026-27/0001', 'Ramesh Sharma', 'pdf')).toBe('BS-QT-2026-27-0001 - Ramesh Sharma.pdf')
    expect(safeSegment('..\\..\\Windows')).toBe('Windows')
    expect(safeSegment('CON')).toBe('_CON')
    expect(safeSegment('A:B*C?"D<E>F|')).toBe('A-B-C-D-E-F-')
  })
  it('rejects fake files, scripts in PDFs, drafts and path tricks', async () => {
    const fake = await admin.call('POST', '/documents', docForm(meta(), { pdf: Buffer.from('<html>not a pdf</html>') }))
    expect(fake.status).toBe(400)
    const js = await admin.call('POST', '/documents', docForm(meta(), { pdf: Buffer.from('%PDF-1.4\n<< /S /JavaScript /JS (app.alert(1)) >>\n%%EOF') }))
    expect(js.status).toBe(400)
    expect((await admin.call('POST', '/documents', docForm(meta({ docNumber: 'DRAFT' }), { pdf: PDF() }))).status).toBe(400)
    expect((await admin.call('POST', '/documents', docForm(meta({ docNumber: '../../etc/passwd' }), { pdf: PDF() }))).status).toBe(400)
    const wrongType = new FormData()
    wrongType.set('meta', JSON.stringify(meta()))
    wrongType.set('pdf', new Blob([new Uint8Array(PDF())], { type: 'text/html' }), 'x.html')
    expect((await admin.call('POST', '/documents', wrongType)).status).toBe(400)
  })
  it('saves PDF + Excel into Quotations/<Client>/ and returns them', async () => {
    const res = await admin.call('POST', '/documents', docForm(meta(), { pdf: PDF(1), xlsx: await XLSX('v1') }))
    expect(res.status).toBe(201)
    expect(res.data.documents).toHaveLength(2)
    const pdfPath = path.join(dir, 'Quotation and Billing', 'Quotations', 'Ramesh Sharma', 'BS-QT-2026-27-0001 - Ramesh Sharma.pdf')
    expect((await readFile(pdfPath)).toString()).toContain('version 1')
    expect(existsSync(pdfPath.replace(/\.pdf$/, '.xlsx'))).toBe(true)
  })
  it('re-saving the same number updates the file instead of duplicating; renaming the client moves it', async () => {
    const res = await admin.call('POST', '/documents', docForm(meta({ clientName: 'Ramesh Kumar Sharma' }), { pdf: PDF(2) }))
    expect(res.data.documents[0].version).toBe(2)
    const list = (await admin.call('GET', '/documents?kind=quotation')).data
    expect(list.filter((d: { format: string }) => d.format === 'pdf')).toHaveLength(1)
    expect(existsSync(path.join(dir, 'Quotation and Billing', 'Quotations', 'Ramesh Sharma', 'BS-QT-2026-27-0001 - Ramesh Sharma.pdf'))).toBe(false)
    expect(existsSync(path.join(dir, 'Quotation and Billing', 'Quotations', 'Ramesh Kumar Sharma', 'BS-QT-2026-27-0001 - Ramesh Kumar Sharma.pdf'))).toBe(true)
  })
  it('keeps a JSON copy of each record for restoring in another browser (role-filtered)', async () => {
    const all = (await admin.call('GET', '/documents/records')).data
    expect(all.find((x: { recordId: string }) => x.recordId === 'qt_1')?.record).toEqual({ id: 'qt_1' })
    const e = client()
    await e.call('POST', '/auth/login', { email: 'editor@babasolars.in', password: 'Edit0r!Passw0rd' })
    expect((await e.call('GET', '/documents/records')).data).toEqual([])
  })
  it('a number used by another record is refused', async () => {
    expect((await admin.call('POST', '/documents', docForm(meta({ recordId: 'qt_other' }), { pdf: PDF(9) }))).status).toBe(409)
  })
  it('billing goes to the Billing folder; download is attachment-only', async () => {
    const res = await admin.call('POST', '/documents', docForm(meta({ kind: 'billing', recordId: 'inv_1', docNumber: 'BS/INV/2026-27/0001', clientName: 'Sunita Verma' }), { pdf: PDF(3) }))
    expect(res.data.documents[0].relativePath).toBe('Billing/Sunita Verma/BS-INV-2026-27-0001 - Sunita Verma.pdf')
    const file = await admin.call('GET', `/documents/${res.data.documents[0].id}/file`)
    expect(file.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(file.headers.get('x-content-type-options')).toBe('nosniff')
    expect(Buffer.isBuffer(file.data) && file.data.toString().startsWith('%PDF')).toBe(true)
  })
  it('sales staff can read documents but cannot delete them', async () => {
    const s = client()
    // (sales account was locked by the brute-force test — use a fresh sales user)
    await admin.call('POST', '/users', { name: 'Sales 2', email: 'sales2@babasolars.in', role: 'sales', password: 'Sa1es!Passw0rd2' })
    await s.call('POST', '/auth/login', { email: 'sales2@babasolars.in', password: 'Sa1es!Passw0rd2' })
    const list = (await s.call('GET', '/documents')).data
    expect(list.length).toBeGreaterThan(0)
    expect((await s.call('DELETE', `/documents/${list[0].id}`)).status).toBe(403)
  })
})

describe('Google Drive backup', () => {
  const admin = client()
  beforeAll(async () => { await admin.call('POST', '/auth/login', { email: 'admin@babasolars.in', password: 'Str0ng!Passw0rd' }) })

  it('shows "not connected" and never exposes secrets', async () => {
    const s = (await admin.call('GET', '/drive/status')).data
    expect(s.configured).toBe(true)
    expect(s.connected).toBe(false)
    expect(s.expectedAccount).toBe('babasolars76@gmail.com')
    expect(JSON.stringify(s)).not.toMatch(/secret|rt-1|refresh/i)
  })
  it('refuses a callback with a forged state', async () => {
    const res = await fetch(`${base}/drive/oauth/callback?code=good-code&state=forged`, { redirect: 'manual' })
    expect(res.headers.get('location')).toMatch(/drive=error/)
  })
  it('refuses a different Google account', async () => {
    google.state.email = 'someone.else@gmail.com'
    const { url } = (await admin.call('POST', '/drive/connect')).data
    const u = new URL(url)
    expect(u.searchParams.get('login_hint')).toBe('babasolars76@gmail.com')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('scope')).toContain('drive.file')
    const res = await fetch(`${base}/drive/oauth/callback?code=good-code&state=${u.searchParams.get('state')}`, { redirect: 'manual' })
    expect(decodeURIComponent(res.headers.get('location')!)).toMatch(/babasolars76@gmail.com/)
    google.state.email = 'babasolars76@gmail.com'
  })
  it('connects, creates the folders and backs up every stored document once', async () => {
    const { url } = (await admin.call('POST', '/drive/connect')).data
    const state = new URL(url).searchParams.get('state')
    const res = await fetch(`${base}/drive/oauth/callback?code=good-code&state=${state}`, { redirect: 'manual' })
    expect(res.headers.get('location')).toMatch(/drive=connected/)
    await ctx.drive.runOnce()
    const status = (await admin.call('GET', '/drive/status')).data
    expect(status.connected).toBe(true)
    expect(status.counts.uploaded).toBe(3)
    expect(google.folders()).toEqual(expect.arrayContaining(['Quotation and Billing', 'Quotation and Billing/Quotations', 'Quotation and Billing/Billing', 'Quotation and Billing/Quotations/Ramesh Kumar Sharma', 'Quotation and Billing/Billing/Sunita Verma']))
    expect(google.files().map((f) => f.path).sort()).toEqual([
      'Quotation and Billing/Billing/Sunita Verma/BS-INV-2026-27-0001 - Sunita Verma.pdf',
      'Quotation and Billing/Quotations/Ramesh Kumar Sharma/BS-QT-2026-27-0001 - Ramesh Kumar Sharma.pdf',
      'Quotation and Billing/Quotations/Ramesh Sharma/BS-QT-2026-27-0001 - Ramesh Sharma.xlsx',
    ])
  })
  it('the encrypted token file does not contain the refresh token in plain text', async () => {
    expect(await readFile(path.join(dir, 'data', 'google-drive.enc'), 'utf8')).not.toContain('rt-1')
  })
  it('an updated document replaces the same Drive file (no duplicates)', async () => {
    const creates = google.state.creates
    await admin.call('POST', '/documents', docForm(meta({ clientName: 'Ramesh Kumar Sharma' }), { pdf: PDF(5) }))
    await ctx.drive.runOnce()
    expect(google.state.creates).toBe(creates)
    expect(google.files().filter((f) => f.name.endsWith('.pdf') && f.name.startsWith('BS-QT'))).toHaveLength(1)
  })
  it('a lost registry entry is matched to the existing Drive file by its key', async () => {
    const before = google.state.creates
    const list = (await admin.call('GET', '/documents?kind=billing')).data
    await docsRepo.patchDrive(list[0].id, { fileId: null }) // simulate a lost id
    await ctx.drive.enqueue(list[0].id)
    await ctx.drive.runOnce()
    expect(google.state.creates).toBe(before)
  })
  it('retries failed uploads with backoff, then succeeds', async () => {
    google.state.failNextUploads = 1
    const res = await admin.call('POST', '/documents', docForm(meta({ kind: 'billing', recordId: 'inv_2', docNumber: 'BS/INV/2026-27/0002', clientName: 'Asha Patel' }), { pdf: PDF(6) }))
    const id = res.data.documents[0].id
    await ctx.drive.runOnce()
    let d = (await admin.call('GET', '/documents?kind=billing')).data.find((x: { id: string }) => x.id === id)
    expect(d.drive.status).toBe('pending')
    expect(d.drive.attempts).toBe(1)
    expect(d.drive.nextAttemptAt).toBeGreaterThan(Date.now())
    await docsRepo.patchDrive(id, { nextAttemptAt: 0 }) // skip the wait
    await ctx.drive.runOnce()
    d = (await admin.call('GET', '/documents?kind=billing')).data.find((x: { id: string }) => x.id === id)
    expect(d.drive.status).toBe('uploaded')
  })
  it('stops after the maximum attempts and can be retried by an admin', async () => {
    google.state.failNextUploads = 10
    const res = await admin.call('POST', '/documents', docForm(meta({ kind: 'billing', recordId: 'inv_3', docNumber: 'BS/INV/2026-27/0003', clientName: 'Asha Patel' }), { pdf: PDF(7) }))
    const id = res.data.documents[0].id
    for (let i = 0; i < 3; i++) { await docsRepo.patchDrive(id, { nextAttemptAt: 0 }); await ctx.drive.runOnce() }
    let d = (await admin.call('GET', '/documents?kind=billing')).data.find((x: { id: string }) => x.id === id)
    expect(d.drive.status).toBe('failed')
    google.state.failNextUploads = 0
    expect((await admin.call('POST', '/drive/retry')).data.queued).toBeGreaterThanOrEqual(1)
    await ctx.drive.runOnce()
    d = (await admin.call('GET', '/documents?kind=billing')).data.find((x: { id: string }) => x.id === id)
    expect(d.drive.status).toBe('uploaded')
  })
  it('a revoked Google token disconnects Drive and keeps documents queued', async () => {
    google.state.revoked = true
    // Drop the cached access token so the worker must refresh it → Google answers invalid_grant
    ;(ctx.drive as unknown as { client: { access: unknown } }).client.access = null
    const res = await admin.call('POST', '/documents', docForm(meta({ kind: 'billing', recordId: 'inv_4', docNumber: 'BS/INV/2026-27/0004', clientName: 'Asha Patel' }), { pdf: PDF(8) }))
    await ctx.drive.runOnce()
    const s = (await admin.call('GET', '/drive/status')).data
    expect(s.connected).toBe(false)
    expect(s.lastError).toMatch(/Connect Google Drive again/)
    const d = (await admin.call('GET', '/documents?kind=billing')).data.find((x: { id: string }) => x.id === res.data.documents[0].id)
    expect(d.drive.status).toBe('pending')
    google.state.revoked = false
  })
})

describe('desktop agent API', () => {
  it('needs the agent token', async () => {
    expect((await fetch(`${base}/agent/manifest`)).status).toBe(401)
    expect((await fetch(`${base}/agent/manifest`, { headers: { Authorization: 'Bearer wrong-token-wrong-token-wrong-token' } })).status).toBe(401)
  })
  it('lists documents and serves files with their checksum', async () => {
    const m = (await (await fetch(`${base}/agent/manifest`, { headers: { Authorization: `Bearer ${AGENT}` } })).json()) as { documents: Array<{ id: string; sha256: string }> }
    expect(m.documents.length).toBeGreaterThan(3)
    const d = m.documents[0]
    const f = await fetch(`${base}/agent/files/${d.id}`, { headers: { Authorization: `Bearer ${AGENT}` } })
    expect(f.headers.get('x-content-sha256')).toBe(d.sha256)
  })
})
