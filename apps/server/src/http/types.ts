import type { Context, Hono } from 'hono'
import type { Ctx } from '../context'

export type Env = { Variables: { ctx: Ctx } }
export type App = Hono<Env>
export type HttpContext = Context<Env>
