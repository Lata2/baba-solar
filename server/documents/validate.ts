import { HttpError } from '../http'
import type { DocFormat, DocKind } from './naming'

/**
 * Upload validation: the declared type must match the file's real content (magic bytes and
 * structure), sizes are limited, and metadata is checked field by field. Anything else is rejected.
 */
export function detectFormat(buf: Buffer): DocFormat | null {
  if (buf.length > 8 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    const tail = buf.subarray(Math.max(0, buf.length - 1024)).toString('latin1')
    return tail.includes('%%EOF') ? 'pdf' : null
  }
  if (buf.length > 30 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    // OOXML spreadsheet: zip with these entry names (stored uncompressed in the local headers).
    const s = buf.toString('latin1')
    if (s.includes('[Content_Types].xml') && s.includes('xl/workbook.xml') && !/xl\/vbaProject\.bin/.test(s)) return 'xlsx'
  }
  return null
}

/** PDF features that run code or launch things are not allowed in generated documents. */
export function pdfLooksActive(buf: Buffer): boolean {
  const s = buf.toString('latin1')
  return /\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction\s*<<[^>]*\/S\s*\/JavaScript)\b/.test(s)
}

export interface DocumentMetaInput {
  kind: DocKind
  recordId: string
  docNumber: string
  clientName: string
  docDate: string
  amount: number
  /** JSON snapshot of the quotation / invoice (kept for recovery and future DB import). */
  record: unknown
}

export function parseMeta(raw: unknown): DocumentMetaInput {
  let m: Record<string, unknown>
  try { m = typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) } catch { throw new HttpError(400, 'Document details are not valid JSON.', 'validation') }
  if (!m || typeof m !== 'object') throw new HttpError(400, 'Document details are missing.', 'validation')
  const e: Record<string, string> = {}
  const kind = m.kind
  if (kind !== 'quotation' && kind !== 'billing') e.kind = 'Kind must be quotation or billing.'
  const recordId = typeof m.recordId === 'string' ? m.recordId : ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(recordId)) e.recordId = 'Invalid record id.'
  const docNumber = typeof m.docNumber === 'string' ? m.docNumber.trim() : ''
  if (!/^[A-Za-z0-9][A-Za-z0-9/_.-]{0,39}$/.test(docNumber) || /DRAFT/i.test(docNumber)) e.docNumber = 'Save the document first — drafts are not stored.'
  const clientName = typeof m.clientName === 'string' ? m.clientName.trim() : ''
  if (!clientName || clientName.length > 120) e.clientName = 'Client name is required (max 120 characters).'
  const docDate = typeof m.docDate === 'string' ? m.docDate : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) e.docDate = 'Invalid date.'
  const amount = Number(m.amount)
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e10) e.amount = 'Invalid amount.'
  const record = m.record ?? null
  if (record !== null && JSON.stringify(record).length > 300_000) e.record = 'Record snapshot is too large.'
  if (Object.keys(e).length) throw new HttpError(400, Object.values(e)[0], 'validation', e)
  return { kind: kind as DocKind, recordId, docNumber, clientName, docDate, amount, record }
}
