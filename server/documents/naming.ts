/**
 * File and folder names that are safe on Windows, macOS, Linux and Google Drive:
 *   "BS/QT/2026-27/0001" + "Ramesh Sharma" → "BS-QT-2026-27-0001 - Ramesh Sharma.pdf"
 */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

export function safeSegment(input: string, fallback = 'Unnamed', max = 80): string {
  let s = String(input ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '')
  if (s.length > max) s = s.slice(0, max).trim()
  if (!s || s === '.' || s === '..') s = fallback
  if (RESERVED.test(s)) s = `_${s}`
  return s
}

export type DocKind = 'quotation' | 'billing'
export type DocFormat = 'pdf' | 'xlsx'
export const KIND_FOLDER: Record<DocKind, string> = { quotation: 'Quotations', billing: 'Billing' }
export const MIME: Record<DocFormat, string> = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }

export function documentFileName(docNumber: string, clientName: string, format: DocFormat) {
  return `${safeSegment(docNumber, 'DOC', 40)} - ${safeSegment(clientName, 'Client', 80)}.${format}`
}

/** Path inside the storage root, using "/" (converted to the OS separator when writing). */
export function documentRelativePath(kind: DocKind, docNumber: string, clientName: string, format: DocFormat, clientSubfolders: boolean) {
  const parts = [KIND_FOLDER[kind]]
  if (clientSubfolders) parts.push(safeSegment(clientName, 'Client', 80))
  parts.push(documentFileName(docNumber, clientName, format))
  return parts.join('/')
}
