import type { Asset } from '@pave/schema'
import { RpcError } from './rpc'

/** Uploads a file to the asset store. Multipart, so it can't share postJson. */
export async function uploadAsset(file: File, signal?: AbortSignal): Promise<Asset> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/assets', {
    method: 'POST',
    body,
    credentials: 'same-origin',
    signal,
  })
  if (!res.ok) throw new RpcError('upload_failed', `Upload failed (${res.status})`, res.status)
  return (await res.json()) as Asset
}

export const assetUrl = (id: string, width?: number): string =>
  `/api/assets/${id}${width ? `?w=${width}` : ''}`

/** A stored asset's bytes. Fails when the server has no such file, so an error page is never taken for one. */
export async function downloadAsset(id: string): Promise<Blob> {
  const res = await fetch(assetUrl(id), { credentials: 'same-origin' })
  if (!res.ok)
    throw new RpcError(
      'download_failed',
      `The file could not be downloaded (${res.status})`,
      res.status,
    )
  return res.blob()
}
