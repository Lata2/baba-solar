/**
 * DOCUMENT STORAGE LAYER — where generated quotation / billing PDFs and Excel files are kept.
 * Pages call `documentStore()` and never care which backend is active:
 *   • ServerStore        → Baba Solars server: C:\Quotation and Billing (or a VPS folder + sync agent) + Google Drive
 *   • BrowserFolderStore → a folder on this computer chosen once with the browser's permission (Chrome/Edge)
 * A future Firebase / database store implements the same interface.
 */
export type DocKind = 'quotation' | 'billing'
export type DocFormat = 'pdf' | 'xlsx'
export type DriveState = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'disabled'

export interface DocumentMeta {
  kind: DocKind
  recordId: string
  docNumber: string
  clientName: string
  docDate: string
  amount: number
  /** JSON copy of the quotation / invoice saved alongside the files (server store only). */
  record?: unknown
}

export interface StoredDocument {
  id: string
  kind: DocKind
  format: DocFormat
  recordId: string
  docNumber: string
  clientName: string
  docDate: string
  amount: number
  fileName: string
  relativePath: string
  size: number
  version: number
  createdAt: string
  updatedAt: string
  drive: { status: DriveState; attempts: number; lastError: string | null; uploadedAt: string | null; nextAttemptAt: number } | null
}

export interface StoreStatus {
  ready: boolean
  /** e.g. "C:\Quotation and Billing" or the chosen folder name */
  location: string
  message: string
  /** The browser folder store needs a click to (re)grant permission. */
  needsPermission?: boolean
}

export interface SaveResult { documents: StoredDocument[]; location: string }

export interface DocumentStore {
  readonly kind: 'server' | 'browser-folder'
  readonly label: string
  status(): Promise<StoreStatus>
  save(meta: DocumentMeta, files: Partial<Record<DocFormat, Blob>>): Promise<SaveResult>
  list(filter?: { kind?: DocKind; q?: string; recordId?: string }): Promise<StoredDocument[]>
  download(doc: StoredDocument): Promise<Blob>
}

/** Same rules as the server (server/documents/naming.ts): Windows-safe names with number + client. */
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i
export function safeSegment(input: string, fallback = 'Unnamed', max = 80): string {
  let s = String(input ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ').replace(/-{2,}/g, '-').trim().replace(/^[.\s-]+|[.\s]+$/g, '')
  if (s.length > max) s = s.slice(0, max).trim()
  if (!s || s === '.' || s === '..') s = fallback
  if (RESERVED.test(s)) s = `_${s}`
  return s
}
export const KIND_FOLDER: Record<DocKind, string> = { quotation: 'Quotations', billing: 'Billing' }
export const documentFileName = (docNumber: string, clientName: string, format: DocFormat) =>
  `${safeSegment(docNumber, 'DOC', 40)} - ${safeSegment(clientName, 'Client', 80)}.${format}`
