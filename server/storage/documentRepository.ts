import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { JsonStore } from './jsonStore'
import type { DocFormat, DocKind } from '../documents/naming'

export type DriveStatus = 'pending' | 'uploading' | 'uploaded' | 'failed' | 'disabled'

export interface DocumentRecord {
  id: string
  /** Unique per document + format: "quotation:BS/QT/2026-27/0001:pdf". Used to avoid duplicates. */
  key: string
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
  sha256: string
  md5: string
  version: number
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  drive: {
    status: DriveStatus
    fileId: string | null
    attempts: number
    nextAttemptAt: number
    lastError: string | null
    uploadedAt: string | null
    uploadedMd5: string | null
  }
}

export interface RecordSnapshot { recordId: string; kind: DocKind; docNumber: string; savedAt: string; record: unknown }

/**
 * Document registry. JSON file today; implement this interface with Firestore / SQL later
 * (e.g. `firestoreDocumentRepository`) and pass it to createApp — routes do not change.
 */
export interface DocumentRepository {
  list(filter?: { kind?: DocKind; q?: string }): Promise<DocumentRecord[]>
  get(id: string): Promise<DocumentRecord | null>
  byKey(key: string): Promise<DocumentRecord | null>
  upsert(key: string, build: (existing: DocumentRecord | null) => DocumentRecord): Promise<{ doc: DocumentRecord; previous: DocumentRecord | null }>
  patchDrive(id: string, drive: Partial<DocumentRecord['drive']>): Promise<DocumentRecord | null>
  remove(id: string): Promise<DocumentRecord | null>
  saveSnapshot(s: RecordSnapshot): Promise<void>
  snapshot(kind: DocKind, recordId: string): Promise<RecordSnapshot | null>
  snapshots(kind?: DocKind): Promise<RecordSnapshot[]>
}

interface Data { documents: DocumentRecord[]; snapshots: Record<string, RecordSnapshot> }

export const newId = () => `doc_${randomUUID()}`

export function jsonDocumentRepository(dataDir: string): DocumentRepository {
  const store = new JsonStore<Data>(path.join(dataDir, 'documents.json'), () => ({ documents: [], snapshots: {} }))
  return {
    async list(f = {}) {
      const q = (f.q ?? '').toLowerCase()
      return (await store.read()).documents
        .filter((d) => (!f.kind || d.kind === f.kind) && (!q || `${d.docNumber} ${d.clientName} ${d.fileName}`.toLowerCase().includes(q)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async get(id) { return (await store.read()).documents.find((d) => d.id === id) ?? null },
    async byKey(key) { return (await store.read()).documents.find((d) => d.key === key) ?? null },
    upsert(key, build) {
      return store.update((d) => {
        const i = d.documents.findIndex((x) => x.key === key)
        const previous = i >= 0 ? d.documents[i] : null
        const doc = build(previous ? structuredClone(previous) : null)
        if (i >= 0) d.documents[i] = doc
        else d.documents.push(doc)
        return { doc, previous }
      })
    },
    patchDrive(id, drive) {
      return store.update((d) => {
        const doc = d.documents.find((x) => x.id === id)
        if (!doc) return null
        doc.drive = { ...doc.drive, ...drive }
        return doc
      })
    },
    remove(id) {
      return store.update((d) => {
        const doc = d.documents.find((x) => x.id === id) ?? null
        d.documents = d.documents.filter((x) => x.id !== id)
        return doc
      })
    },
    async saveSnapshot(s) { await store.update((d) => { d.snapshots[`${s.kind}:${s.recordId}`] = s }) },
    async snapshot(kind, recordId) { return (await store.read()).snapshots[`${kind}:${recordId}`] ?? null },
    async snapshots(kind) { return Object.values((await store.read()).snapshots).filter((s) => !kind || s.kind === kind) },
  }
}
