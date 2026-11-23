import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Content-addressed bytes, keyed by their SHA-256 (lowercase hex). Writes are idempotent. */
export interface BlobStore {
  put(sha256: string, bytes: Uint8Array): Promise<void>
  get(sha256: string): Promise<Uint8Array<ArrayBuffer> | null>
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

/**
 * Stores blobs as files under `root/ab/cd/<sha256>`. Keys are lowercase hex only, so names are
 * safe on case-insensitive file systems and on every platform.
 */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  #path(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid blob key "${sha256}"`)
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    const path = this.#path(sha256)
    if (await exists(path)) return
    await mkdir(dirname(path), { recursive: true })
    // Write-then-rename so a reader never sees a partial blob.
    const tmp = `${path}.${process.pid}-${Date.now()}.tmp`
    await writeFile(tmp, bytes)
    try {
      await rename(tmp, path)
    } catch (err) {
      // Windows refuses to replace a file that is open; a concurrent writer stored the same bytes.
      await rm(tmp, { force: true })
      if (!(await exists(path))) throw err
    }
  }

  async get(sha256: string): Promise<Uint8Array<ArrayBuffer> | null> {
    try {
      return await readFile(this.#path(sha256))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
}
