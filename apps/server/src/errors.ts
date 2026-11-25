import type { z } from 'zod'

export type ErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'budget_exceeded'
  | 'plan_limit'
  | 'not_configured'
  | 'internal'

const STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  /** The organisation's monthly budget would be exceeded; an admin can raise it. */
  budget_exceeded: 402,
  /** A plan allowance (renders, CAD exports) is used up for this month; Pro has more. */
  plan_limit: 402,
  conflict: 409,
  payload_too_large: 413,
  internal: 500,
  not_configured: 501,
} as const satisfies Record<ErrorCode, number>

export type ErrorStatus = (typeof STATUS)[ErrorCode]

/** An error that is safe to show to the caller, rendered as `{ error: { code, message, … } }`. */
export class AppError extends Error {
  readonly status: ErrorStatus
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details: { issues?: z.core.$ZodIssue[]; [key: string]: unknown } = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.status = STATUS[code]
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, ...this.details } }
  }
}

export const badRequest = (message: string, issues?: z.core.$ZodIssue[]) =>
  new AppError('bad_request', message, issues ? { issues } : {})
export const notFound = (what: string, id?: string) =>
  new AppError('not_found', id ? `${what} "${id}" not found` : `${what} not found`)
export const forbidden = (message: string) => new AppError('forbidden', message)
export const conflict = (message: string, details: Record<string, unknown> = {}) =>
  new AppError('conflict', message, details)

/** Thrown when a command needs an engine this deployment has not been given (→ 501). */
export class NotConfiguredError extends AppError {
  constructor(
    readonly service: string,
    message: string,
  ) {
    super('not_configured', message, { service })
    this.name = 'NotConfiguredError'
  }
}
