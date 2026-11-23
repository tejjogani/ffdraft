import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Content-addressed bytes, keyed by their SHA-256 (hex). Writes are idempotent. */
export interface BlobStore {
  put(sha256: string, bytes: Uint8Array): Promise<void>
  get(sha256: string): Promise<Uint8Array | null>
}

/** Stores blobs as files under `root/ab/cd/<sha256>`. */
export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  #path(sha256: string): string {
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Invalid blob key "${sha256}"`)
    return join(this.root, sha256.slice(0, 2), sha256.slice(2, 4), sha256)
  }

  async put(sha256: string, bytes: Uint8Array): Promise<void> {
    const path = this.#path(sha256)
    await mkdir(join(path, '..'), { recursive: true })
    // Write-then-rename so a reader never sees a partial blob.
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tmp, bytes)
    await rename(tmp, path)
  }

  async get(sha256: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.#path(sha256))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
  }
}
