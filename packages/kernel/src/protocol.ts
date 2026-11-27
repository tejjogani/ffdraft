/**
 * Messages between `createKernelClient()` (main thread) and the kernel Worker.
 *
 * Geometry crosses the boundary once: a part whose (`id`, `rev`) the main thread already holds
 * from the previous evaluation at that detail is sent without its buffers, and a gem mesh is
 * sent the first time its key appears. Both sides apply the same rule to the same ordered
 * stream of results, so neither needs to acknowledge anything.
 */
import type { Design } from '@pave/schema'
import type {
  Detail,
  Evaluation,
  ExportFormat,
  ExportOptions,
  ExportResult,
  MeshData,
  Part,
} from './types'

/** A part as posted: `mesh` and `edges` are omitted when the receiver already holds this rev. */
export type WirePart = Omit<Part, 'mesh' | 'edges'> & { mesh?: MeshData; edges?: Float32Array }

export type WireEvaluation = Omit<Evaluation, 'parts' | 'referenceParts' | 'gemMeshes'> & {
  parts: WirePart[]
  referenceParts?: WirePart[]
  /** Only the gem meshes not sent before. */
  gemMeshes: Record<string, MeshData>
}

export type Request =
  /**
   * `lock` names a Web Lock the Worker takes and holds for as long as it lives. It is released
   * when the Worker dies, however it dies (killed, out of memory), which is the only signal a
   * dead Worker gives: the client waits on the same lock to learn of it.
   */
  | { type: 'ready'; id: number; lock?: string }
  | { type: 'evaluate'; id: number; design: Design; detail: Detail | undefined; assets: boolean }
  | {
      type: 'export'
      id: number
      design: Design
      format: ExportFormat
      options: Omit<ExportOptions, 'assets' | 'signal'>
      assets: boolean
    }
  | { type: 'abort'; id: number }
  | { type: 'asset'; request: number; bytes?: Uint8Array; error?: string }

export type Response =
  /** `locked`: the Worker holds the lock the request named (the client may wait on it). */
  | { type: 'ready'; id: number; kinds: string[]; formats: ExportFormat[]; locked: boolean }
  | { type: 'evaluated'; id: number; evaluation: WireEvaluation }
  | { type: 'exported'; id: number; result: ExportResult }
  | { type: 'failed'; id: number; message: string; aborted: boolean }
  | { type: 'asset'; request: number; assetId: string }

/** The slice of the Web Locks API (`navigator.locks`) both ends use. */
export interface Locks {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: () => Promise<unknown>,
  ): Promise<unknown>
}

/** `navigator.locks` where the platform has it (browsers, Workers); Node has none. */
export const platformLocks = (): Locks | undefined =>
  (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks

/** The slice of a Worker / MessagePort both ends use. */
export interface Port<Out, In> {
  postMessage(message: Out, transfer?: Transferable[]): void
  onmessage: ((event: { data: In }) => void) | null
}

/** Remembers what the other side holds, per detail level. */
export class PartLedger {
  private readonly parts: Record<Detail, Map<string, Part>> = {
    draft: new Map(),
    production: new Map(),
  }
  private readonly gems = new Map<string, MeshData>()

  /** Sender: strips what the receiver holds and lists the buffers to transfer (as copies). */
  encode(evaluation: Evaluation): { wire: WireEvaluation; transfer: Transferable[] } {
    const transfer: Transferable[] = []
    const copy = <T extends Float32Array | Uint32Array>(array: T): T => {
      // The kernel caches these arrays, so the originals must stay attached.
      const duplicate = array.slice() as T
      transfer.push(duplicate.buffer)
      return duplicate
    }
    const copyMesh = (m: MeshData): MeshData => ({
      positions: copy(m.positions),
      normals: copy(m.normals),
      indices: copy(m.indices),
    })
    const held = this.parts[evaluation.detail]
    const encodePart = (part: Part): WirePart => {
      const { mesh, edges, ...facts } = part
      return held.get(part.id)?.rev === part.rev
        ? facts
        : { ...facts, mesh: copyMesh(mesh), edges: copy(edges) }
    }
    const parts = evaluation.parts.map(encodePart)
    const referenceParts = evaluation.referenceParts?.map(encodePart)
    const gemMeshes: Record<string, MeshData> = {}
    for (const [key, mesh] of Object.entries(evaluation.gemMeshes))
      if (!this.gems.has(key)) {
        this.gems.set(key, mesh)
        gemMeshes[key] = copyMesh(mesh)
      }
    this.remember(evaluation.detail, [...evaluation.parts, ...(evaluation.referenceParts ?? [])])
    return { wire: { ...evaluation, parts, referenceParts, gemMeshes }, transfer }
  }

  /** Receiver: restores the buffers that were left out. */
  decode(wire: WireEvaluation): Evaluation {
    const held = this.parts[wire.detail]
    const decodePart = (part: WirePart): Part => {
      if (part.mesh && part.edges) return part as Part
      const known = held.get(part.id)
      if (!known || known.rev !== part.rev)
        throw new Error(`Kernel worker referred to unknown geometry (${part.id})`)
      return { ...part, mesh: known.mesh, edges: known.edges }
    }
    const parts = wire.parts.map(decodePart)
    const referenceParts = wire.referenceParts?.map(decodePart)
    for (const [key, mesh] of Object.entries(wire.gemMeshes)) this.gems.set(key, mesh)
    const used = new Set(wire.stones.map((s) => s.meshKey))
    const gemMeshes = Object.fromEntries(
      [...used].map((key) => [key, this.gems.get(key) as MeshData]),
    )
    this.remember(wire.detail, [...parts, ...(referenceParts ?? [])])
    return { ...wire, parts, referenceParts, gemMeshes }
  }

  private remember(detail: Detail, parts: readonly Part[]): void {
    this.parts[detail] = new Map(parts.map((p) => [p.id, p]))
  }
}
