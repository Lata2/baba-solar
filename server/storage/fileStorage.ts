import { access, mkdir, readFile, rm, constants, rmdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite } from './jsonStore'
import { KIND_FOLDER } from '../documents/naming'

/**
 * Local document storage. On the office Windows PC the root is "C:\Quotation and Billing" with
 * "Quotations" and "Billing" inside. On a VPS the root is a server folder and the Windows sync
 * agent mirrors it to C:\ (see agent/). Implements the same interface a cloud bucket would.
 */
export interface FileStorage {
  readonly root: string
  ensureLayout(): Promise<void>
  write(relativePath: string, data: Buffer): Promise<string>
  read(relativePath: string): Promise<Buffer>
  remove(relativePath: string): Promise<void>
  writable(): Promise<boolean>
}

export function localFileStorage(root: string): FileStorage {
  const resolveInside = (rel: string) => {
    const full = path.resolve(root, ...rel.split('/'))
    const rootWithSep = path.resolve(root) + path.sep
    if (!full.startsWith(rootWithSep)) throw new Error('Path escapes the storage folder.')
    return full
  }
  return {
    root,
    async ensureLayout() {
      for (const folder of Object.values(KIND_FOLDER)) await mkdir(path.join(root, folder), { recursive: true })
    },
    async write(rel, data) {
      const full = resolveInside(rel)
      await mkdir(path.dirname(full), { recursive: true })
      await atomicWrite(full, data, 0o644)
      return full
    },
    read: (rel) => readFile(resolveInside(rel)),
    async remove(rel) {
      const full = resolveInside(rel)
      await rm(full, { force: true })
      // Tidy an empty client folder (never the Quotations / Billing folders themselves).
      const dir = path.dirname(full)
      if (!Object.values(KIND_FOLDER).some((f) => path.resolve(root, f) === dir) && dir.startsWith(path.resolve(root) + path.sep)) {
        try { if (!(await readdir(dir)).length) await rmdir(dir) } catch { /* not empty / gone */ }
      }
    },
    async writable() {
      try { await mkdir(root, { recursive: true }); await access(root, constants.W_OK); return true } catch { return false }
    },
  }
}
