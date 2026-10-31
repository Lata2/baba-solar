import { Router, type Request } from 'express'
import multer from 'multer'
import { createHash } from 'node:crypto'
import type { Permission } from '../../src/types'
import type { ServerConfig } from '../config'
import type { Logger } from '../logger'
import type { DriveBackup } from '../drive/backup'
import type { DocumentRecord, DocumentRepository } from '../storage/documentRepository'
import { newId } from '../storage/documentRepository'
import type { FileStorage } from '../storage/fileStorage'
import { HttpError, asyncRoute, requirePermission, type AuthedRequest } from '../http'
import { documentFileName, documentRelativePath, MIME, type DocFormat, type DocKind } from '../documents/naming'
import { detectFormat, parseMeta, pdfLooksActive } from '../documents/validate'

const READ: Record<DocKind, Permission> = { quotation: 'quotations:read', billing: 'invoices:read' }
const WRITE: Record<DocKind, Permission> = { quotation: 'quotations:write', billing: 'invoices:write' }

/** What the browser sees (no internal paths beyond the relative one, no record snapshot). */
export const publicDoc = (d: DocumentRecord) => ({
  id: d.id, kind: d.kind, format: d.format, recordId: d.recordId, docNumber: d.docNumber, clientName: d.clientName, docDate: d.docDate,
  amount: d.amount, fileName: d.fileName, relativePath: d.relativePath, size: d.size, version: d.version, createdAt: d.createdAt,
  updatedAt: d.updatedAt, drive: { status: d.drive.status, attempts: d.drive.attempts, lastError: d.drive.lastError, uploadedAt: d.drive.uploadedAt, nextAttemptAt: d.drive.nextAttemptAt },
})

export function documentRoutes(cfg: ServerConfig, docs: DocumentRepository, files: FileStorage, drive: DriveBackup, log: Logger) {
  const r = Router()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: cfg.maxUploadMb * 1024 * 1024, files: 2, fields: 2, fieldSize: 400_000, parts: 4 },
    fileFilter: (_req, file, cb) => {
      const ok = (file.fieldname === 'pdf' && file.mimetype === MIME.pdf) || (file.fieldname === 'xlsx' && file.mimetype === MIME.xlsx)
      if (ok) cb(null, true)
      else cb(new HttpError(400, 'Only a PDF ("pdf") and an Excel .xlsx ("xlsx") file can be uploaded.', 'validation'))
    },
  })
  const allowed = (req: Request, kind: DocKind, map: Record<DocKind, Permission>) => (req as AuthedRequest).permissions.includes(map[kind])

  r.get('/', asyncRoute(async (req, res) => {
    const kind = req.query.kind === 'quotation' || req.query.kind === 'billing' ? req.query.kind : undefined
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : ''
    const recordId = typeof req.query.recordId === 'string' ? req.query.recordId : ''
    const list = (await docs.list({ kind, q })).filter((d) => allowed(req, d.kind, READ) && (!recordId || d.recordId === recordId))
    res.setHeader('Cache-Control', 'no-store')
    res.json(list.map(publicDoc))
  }))

  /** Upload the PDF and/or Excel of a saved quotation or invoice. Same document number → same files (updated, never duplicated). */
  r.post('/', upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'xlsx', maxCount: 1 }]), asyncRoute(async (req, res) => {
    const a = req as AuthedRequest
    const meta = parseMeta((req.body as Record<string, unknown>)?.meta)
    if (!allowed(req, meta.kind, WRITE)) throw new HttpError(403, 'You do not have permission to save these documents.', 'forbidden')
    const uploaded = (req.files ?? {}) as Record<string, Express.Multer.File[]>
    const parts = (['pdf', 'xlsx'] as DocFormat[]).flatMap((format) => (uploaded[format]?.[0] ? [{ format, file: uploaded[format][0] }] : []))
    if (!parts.length) throw new HttpError(400, 'Attach the PDF and/or the Excel file.', 'validation')
    for (const p of parts) {
      if (detectFormat(p.file.buffer) !== p.format) throw new HttpError(400, `The ${p.format.toUpperCase()} file is damaged or not a real ${p.format.toUpperCase()}.`, 'validation')
      if (p.format === 'pdf' && pdfLooksActive(p.file.buffer)) throw new HttpError(400, 'PDFs with scripts or embedded files are not accepted.', 'validation')
    }
    const now = new Date().toISOString()
    const saved: DocumentRecord[] = []
    for (const { format, file } of parts) {
      const key = `${meta.kind}:${meta.docNumber}:${format}`
      const relativePath = documentRelativePath(meta.kind, meta.docNumber, meta.clientName, format, cfg.clientSubfolders)
      const sha256 = createHash('sha256').update(file.buffer).digest('hex')
      const md5 = createHash('md5').update(file.buffer).digest('hex')
      const before = await docs.byKey(key)
      if (before && before.recordId !== meta.recordId) throw new HttpError(409, `Document number ${meta.docNumber} already belongs to another record.`, 'conflict')
      if (before?.sha256 === sha256 && before.relativePath === relativePath) { saved.push(before); continue } // unchanged — nothing to do
      try {
        await files.write(relativePath, file.buffer)
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        // Windows locks a file that is open in Excel / a PDF viewer.
        if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') throw new HttpError(409, `“${documentFileName(meta.docNumber, meta.clientName, format)}” is open in another program (Excel / PDF viewer) or not writable. Close it and save again.`, 'conflict')
        throw e
      }
      const { doc, previous } = await docs.upsert(key, (ex) => ({
        id: ex?.id ?? newId(), key, kind: meta.kind, format, recordId: meta.recordId, docNumber: meta.docNumber, clientName: meta.clientName,
        docDate: meta.docDate, amount: meta.amount, fileName: documentFileName(meta.docNumber, meta.clientName, format), relativePath,
        size: file.size, sha256, md5, version: (ex?.version ?? 0) + 1, createdAt: ex?.createdAt ?? now, updatedAt: now,
        createdBy: ex?.createdBy ?? a.user.id, updatedBy: a.user.id,
        drive: ex?.drive ?? { status: 'pending', fileId: null, attempts: 0, nextAttemptAt: 0, lastError: null, uploadedAt: null, uploadedMd5: null },
      }))
      if (previous && previous.relativePath !== relativePath) await files.remove(previous.relativePath) // client renamed → move, don't duplicate
      await drive.enqueue(doc.id)
      saved.push((await docs.get(doc.id))!)
      log.info('document_saved', { key, version: doc.version, by: a.user.id })
    }
    if (meta.record) await docs.saveSnapshot({ recordId: meta.recordId, kind: meta.kind, docNumber: meta.docNumber, savedAt: now, record: meta.record })
    res.status(201).json({ documents: saved.map(publicDoc), storageRoot: cfg.documentsRoot })
  }))

  r.get('/:id/file', asyncRoute(async (req, res) => {
    const d = await docs.get(String(req.params.id))
    if (!d || !allowed(req, d.kind, READ)) throw new HttpError(404, 'Document not found.', 'not_found')
    const data = await files.read(d.relativePath).catch(() => { throw new HttpError(404, 'The file is missing from the storage folder.', 'not_found') })
    res.setHeader('Content-Type', MIME[d.format])
    res.setHeader('Content-Disposition', `attachment; filename="${d.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(d.fileName)}`)
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(data)
  }))

  /** All record snapshots the user may read — the admin panel merges them into a fresh / other browser. */
  r.get('/records', asyncRoute(async (req, res) => {
    const list = (await docs.snapshots()).filter((s) => allowed(req, s.kind, READ))
    res.setHeader('Cache-Control', 'no-store')
    res.json(list)
  }))

  /** Record snapshot (the quotation / invoice JSON saved with its files) — for recovery on another browser. */
  r.get('/records/:kind/:recordId', asyncRoute(async (req, res) => {
    const kind = req.params.kind as DocKind
    if (kind !== 'quotation' && kind !== 'billing') throw new HttpError(404, 'Not found.', 'not_found')
    if (!allowed(req, kind, READ)) throw new HttpError(403, 'You do not have permission.', 'forbidden')
    const s = await docs.snapshot(kind, String(req.params.recordId))
    if (!s) throw new HttpError(404, 'No saved copy of this record.', 'not_found')
    res.setHeader('Cache-Control', 'no-store')
    res.json(s)
  }))

  r.delete('/:id', requirePermission('backup:manage'), asyncRoute(async (req, res) => {
    const d = await docs.remove(String(req.params.id))
    if (!d) throw new HttpError(404, 'Document not found.', 'not_found')
    await files.remove(d.relativePath)
    log.info('document_deleted', { key: d.key, by: (req as AuthedRequest).user.id })
    res.json({ ok: true, driveCopyKept: d.drive.status === 'uploaded' })
  }))
  return r
}

export function driveRoutes(cfg: ServerConfig, drive: DriveBackup, files: FileStorage) {
  const r = Router()
  r.get('/status', requirePermission('quotations:read'), asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ ...(await drive.status()), storage: { root: cfg.documentsRoot, writable: await files.writable(), clientSubfolders: cfg.clientSubfolders, platform: process.platform } })
  }))
  r.post('/connect', requirePermission('backup:manage'), (req, res) => {
    res.json({ url: drive.startConnect((req as AuthedRequest).user.id) })
  })
  r.post('/disconnect', requirePermission('backup:manage'), asyncRoute(async (_req, res) => { await drive.disconnect(); res.json({ ok: true }) }))
  r.post('/retry', requirePermission('backup:manage'), asyncRoute(async (_req, res) => {
    const queued = await drive.retryFailed()
    void drive.runOnce()
    res.json({ queued })
  }))
  return r
}

/** OAuth redirect target — Google sends the browser here (cross-site, so no session cookie; the one-time `state` authenticates it). */
export function driveCallback(cfg: ServerConfig, drive: DriveBackup) {
  return asyncRoute(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const denied = typeof req.query.error === 'string' ? req.query.error : ''
    const error = denied ? `Google sign-in was cancelled (${denied}).` : !code || !state ? 'Missing sign-in details.' : await drive.finishConnect(code, state)
    const target = new URL('/admin/documents', cfg.appOrigins[0])
    target.searchParams.set('drive', error ? 'error' : 'connected')
    if (error) target.searchParams.set('message', error.slice(0, 200))
    res.redirect(303, target.toString())
  })
}

/** Read-only API for the Windows sync agent (Bearer token from AGENT_TOKENS). */
export function agentRoutes(cfg: ServerConfig, docs: DocumentRepository, files: FileStorage) {
  const r = Router()
  r.use((req, _res, next) => {
    const auth = req.get('authorization') ?? ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const ok = token.length >= 32 && cfg.agentTokens.some((t) => t.length === token.length && createHash('sha256').update(t).digest().equals(createHash('sha256').update(token).digest()))
    next(ok ? undefined : new HttpError(401, 'Invalid agent token.', 'unauthorized'))
  })
  r.get('/manifest', asyncRoute(async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json({ generatedAt: new Date().toISOString(), documents: (await docs.list()).map((d) => ({ id: d.id, kind: d.kind, relativePath: d.relativePath, sha256: d.sha256, size: d.size, updatedAt: d.updatedAt })) })
  }))
  r.get('/files/:id', asyncRoute(async (req, res) => {
    const d = await docs.get(String(req.params.id))
    if (!d) throw new HttpError(404, 'Not found.', 'not_found')
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('X-Content-SHA256', d.sha256)
    res.send(await files.read(d.relativePath))
  }))
  return r
}
