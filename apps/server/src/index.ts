/**
 * @pave/server — the public surface for other server-side modules (assistant runtime, MCP
 * server, engines, desktop shell).
 */
export { type CreateAppOptions, createApp, type PaveServer } from './app'
export { compose, servicesFromEnv } from './compose'
export { type AssetKind, type NewAsset, putAsset, readAsset } from './assets/assets'
export { type BlobStore, FsBlobStore } from './assets/blob-store'
export { type AuthMode, type Config, configFromEnv } from './config'
export type { Ctx, Execute, Invoke } from './context'
export { invoke, publish } from './context'
export { AppError, type ErrorCode, NotConfiguredError } from './errors'
export { type EventAudience, EventBus, type JobKind, type ServerEvent } from './events'
export type { Handler, Handlers } from './handlers/types'
export {
  engineError,
  meshHandle,
  renderHandle,
  shotHandle,
  stopJob,
  submitJob,
} from './jobs'
export type { Unfinished } from './recovery'
export { Runtime } from './runtime'
export { serviceContext } from './service-context'
export * from './services'
export {
  addMessage,
  addStep,
  addUsage,
  beginStep,
  completeStep,
  createThread,
  decideStep,
  finishRun,
  resumeRun,
  startRun,
  traces,
} from './traces'
export { assertBudget, monthSpendUsd, type NewUsage, recordUsage } from './usage'

import { putAsset, readAsset } from './assets/assets'
/** `assets.put(ctx, { bytes, name, mime, kind })` / `assets.read(ctx, id)`. */
export const assets = { put: putAsset, read: readAsset }
