/**
 * The native Pavé file in the studio: save a piece as `.pave`, and open one (from a button, the
 * ⌘K palette, or by dropping it anywhere on the window). Both are always free; the server does
 * the work and the checks (features documented in docs/pave-file.md).
 */
import { isPaveFileName, PAVE_EXTENSION, type Piece } from '@pave/schema'
import { toast } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { assetUrl, uploadAsset } from '../../lib/assets'
import { invalidateFor, queryClient } from '../../lib/query'
import { RpcError, rpc } from '../../lib/rpc'
import { safeFileName, saveFile } from '../../lib/save-file'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function savePaveFile(piece: Pick<Piece, 'id' | 'title'>): Promise<void> {
  const pending = toast({ title: 'Preparing the Pavé file…', timeout: 0 })
  try {
    const { asset, notes } = await rpc.call('pieces.saveFile', { id: piece.id })
    const blob = await (await fetch(assetUrl(asset.id))).blob()
    toast.dismiss(pending)
    const saved = await saveFile(
      new Blob([blob], { type: asset.mime }),
      safeFileName(piece.title || 'Untitled piece', PAVE_EXTENSION),
      'Pavé file',
    )
    if (!saved) return
    toast({
      title: 'Saved as a Pavé file',
      // What stayed behind matters more than "it worked": a picture whose rights stay here.
      description: notes[0] ?? 'Free, and never counted against your plan.',
      type: 'success',
    })
  } catch (e) {
    toast.dismiss(pending)
    toast.error('Couldn’t save the Pavé file', message(e))
  }
}

/** Opens `file` as a new piece and goes to it. Returns the new piece's id, or null. */
export async function openPaveFile(
  file: File,
  go: (pieceId: string) => void,
): Promise<string | null> {
  if (!isPaveFileName(file.name)) {
    toast.error('That isn’t a Pavé file', `Choose a file ending in .${PAVE_EXTENSION}.`)
    return null
  }
  const pending = toast({ title: `Opening ${file.name}…`, timeout: 0 })
  try {
    const asset = await uploadAsset(file).catch((e: unknown) => {
      if (e instanceof RpcError && e.status === 413)
        throw new Error('The file is larger than this server accepts for uploads.')
      throw e
    })
    const { piece, notes } = await rpc.call('pieces.openFile', { assetId: asset.id })
    toast.dismiss(pending)
    invalidateFor(queryClient, 'pieces')
    go(piece.id)
    toast({
      title: `Opened “${piece.title || 'Untitled piece'}”`,
      description:
        notes[0] ??
        (piece.provenance?.elsewhere
          ? 'Saved elsewhere; its history and where it came from are kept.'
          : 'A new piece, with its history, references and shots.'),
      type: 'success',
    })
    return piece.id
  } catch (e) {
    toast.dismiss(pending)
    toast.error('Couldn’t open the Pavé file', message(e))
    return null
  }
}

/** Asks for a .pave file with the system's file dialog. */
export function pickPaveFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = `.${PAVE_EXTENSION}`
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

export function useOpenPaveFile(): () => void {
  const navigate = useNavigate()
  return () =>
    void pickPaveFile().then(
      (file) =>
        file && openPaveFile(file, (id) => void navigate({ to: '/pieces/$id', params: { id } })),
    )
}

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')

/**
 * Dropping a .pave file anywhere opens it. Drop targets that take files themselves (the
 * composer, the reference panel) handle their drop first and call preventDefault, so this only
 * sees drops nobody else wanted; other files dropped there are left alone.
 */
export function usePaveFileDrop(): void {
  const navigate = useNavigate()
  useEffect(() => {
    const over = (e: DragEvent) => {
      // Saying "copy" for any file stops the browser from navigating away to a dropped file.
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e) || e.defaultPrevented) return
      e.preventDefault()
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isPaveFileName(f.name))
      if (!files.length) return
      const go = (id: string) => void navigate({ to: '/pieces/$id', params: { id } })
      // One at a time: each opening is a transaction and a page change.
      void files.reduce<Promise<unknown>>(
        (chain, file) => chain.then(() => openPaveFile(file, go)),
        Promise.resolve(),
      )
    }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [navigate])
}
