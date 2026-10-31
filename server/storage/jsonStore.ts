import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Tiny JSON-file store: whole-file atomic writes (temp file + rename) and serialised updates,
 * so a crash never leaves half-written data and two requests never overwrite each other.
 * This is the "no database yet" persistence behind the repository interfaces; swap the
 * repositories for Firebase / SQL later without touching routes.
 */
export class JsonStore<T> {
  private cache: T | null = null
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly file: string, private readonly initial: () => T) {}

  async read(): Promise<T> {
    if (this.cache) return structuredClone(this.cache)
    try {
      this.cache = JSON.parse(await readFile(this.file, 'utf8')) as T
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Cannot read ${path.basename(this.file)}: ${(e as Error).message}`)
      this.cache = this.initial()
    }
    return structuredClone(this.cache)
  }

  /** Read-modify-write under a lock. The callback may mutate and/or return a value. */
  update<R>(fn: (data: T) => R | Promise<R>): Promise<R> {
    const run = this.queue.then(async () => {
      const data = await this.read()
      const result = await fn(data)
      await atomicWrite(this.file, JSON.stringify(data, null, 2))
      this.cache = data
      return result
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}

export async function atomicWrite(file: string, content: string | Uint8Array, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(tmp, content, { mode })
    await rename(tmp, file)
  } catch (e) {
    await rm(tmp, { force: true })
    throw e
  }
}
