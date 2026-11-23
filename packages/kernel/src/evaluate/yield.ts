/**
 * Cooperative yielding. The kernel is synchronous WASM, so an abort (or, in a Worker, the next
 * request) can only be noticed if evaluation periodically returns to the event loop.
 */
import { hostSetImmediate } from '../runtime/host'

/** Resolves on the next macrotask without the 4 ms clamp of nested `setTimeout`. */
const macrotask: () => Promise<void> = (() => {
  const immediate = hostSetImmediate
  if (immediate) return () => new Promise<void>((r) => immediate(r))
  const channel = new MessageChannel()
  const waiting: (() => void)[] = []
  channel.port1.onmessage = () => waiting.shift()?.()
  return () =>
    new Promise<void>((resolve) => {
      waiting.push(resolve)
      channel.port2.postMessage(0)
    })
})()

const SLICE_MS = 12

/** Returns a function to call between units of work: yields when a slice is used up, then throws if aborted. */
export function createBreather(signal: AbortSignal | undefined): () => Promise<void> {
  let last = performance.now()
  return async () => {
    if (performance.now() - last >= SLICE_MS) {
      await macrotask()
      last = performance.now()
    }
    signal?.throwIfAborted()
  }
}
