/**
 * @pave/server — the public surface for other server-side modules (assistant runtime, MCP
 * server, engines, desktop shell).
 */
export { type CreateAppOptions, createApp, type PaveServer } from './app'
export { type AssetKind, type NewAsset, putAsset, readAsset } from './assets/assets'
export { type BlobStore, FsBlobStore } from './assets/blob-store'
export { type AuthMode, type Config, configFromEnv } from './config'
export type { Ctx } from './context'
export { publish } from './context'
export { AppError, type ErrorCode, NotConfiguredError } from './errors'
export { EventBus, type JobKind, type ServerEvent } from './events'
export type { Handler, Handlers } from './handlers/types'
export { Runtime } from './runtime'
export * from './services'
export { addMessage, addStep, createThread, finishRun, startRun, traces } from './traces'
export { type NewUsage, recordUsage } from './usage'

import { putAsset, readAsset } from './assets/assets'
/** `assets.put(ctx, { bytes, name, mime, kind })` / `assets.read(ctx, id)`. */
export const assets = { put: putAsset, read: readAsset }
