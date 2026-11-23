import type { Asset } from '@pave/schema'
import { RpcError } from './rpc'

/** Uploads a file to the asset store. Multipart, so it can't share postJson. */
export async function uploadAsset(file: File): Promise<Asset> {
  const body = new FormData()
  body.append('file', file)
  const res = await fetch('/api/assets', { method: 'POST', body, credentials: 'same-origin' })
  if (!res.ok) throw new RpcError('upload_failed', `Upload failed (${res.status})`, res.status)
  return (await res.json()) as Asset
}

export const assetUrl = (id: string, width?: number): string =>
  `/api/assets/${id}${width ? `?w=${width}` : ''}`
