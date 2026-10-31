import { http } from '../http'
import type { DocumentStore, StoredDocument } from './types'

export interface DriveStatus {
  configured: boolean
  connected: boolean
  account: string | null
  expectedAccount: string | null
  rootFolder: string | null
  connectedAt: string | null
  lastError: string | null
  counts: Record<'pending' | 'uploading' | 'uploaded' | 'failed' | 'disabled', number>
  storage: { root: string; writable: boolean; clientSubfolders: boolean; platform: string }
}

/** Documents saved by the Baba Solars server (local C:\ folder or VPS folder) and backed up to Google Drive. */
export const serverStore: DocumentStore = {
  kind: 'server',
  label: 'Baba Solars server',
  async status() {
    const s = await http<DriveStatus>('GET', '/drive/status')
    return {
      ready: s.storage.writable,
      location: s.storage.root,
      message: s.storage.writable ? `Saved on the server in ${s.storage.root}` : `The server cannot write to ${s.storage.root}`,
    }
  },
  async save(meta, files) {
    const form = new FormData()
    form.set('meta', JSON.stringify(meta))
    if (files.pdf) form.set('pdf', files.pdf, 'document.pdf')
    if (files.xlsx) form.set('xlsx', files.xlsx, 'document.xlsx')
    const r = await http<{ documents: StoredDocument[]; storageRoot: string }>('POST', '/documents', { form })
    return { documents: r.documents, location: r.storageRoot }
  },
  async list(f = {}) {
    const p = new URLSearchParams()
    if (f.kind) p.set('kind', f.kind)
    if (f.q) p.set('q', f.q)
    if (f.recordId) p.set('recordId', f.recordId)
    return http<StoredDocument[]>('GET', `/documents?${p}`)
  },
  download: (d) => http<Blob>('GET', `/documents/${encodeURIComponent(d.id)}/file`, { raw: true }),
}

export const driveApi = {
  status: () => http<DriveStatus>('GET', '/drive/status'),
  connect: () => http<{ url: string }>('POST', '/drive/connect'),
  disconnect: () => http('POST', '/drive/disconnect'),
  retry: () => http<{ queued: number }>('POST', '/drive/retry'),
  records: () => http<Array<{ kind: 'quotation' | 'billing'; recordId: string; record: unknown }>>('GET', '/documents/records'),
  remove: (id: string) => http<{ ok: true; driveCopyKept: boolean }>('DELETE', `/documents/${encodeURIComponent(id)}`),
}
