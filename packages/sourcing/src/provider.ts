/**
 * Sourcing is a provider seam so the open-source project stays vendor-neutral: Diaex is the
 * first-party marketplace, `none` leaves the Stones tab a plain bill of materials.
 *
 * Phases (docs/research/07-sourcing.md §6): P0 link-out needs nothing from the marketplace and
 * is what ships today; match / cart / requests / metals light up as `capabilities` report them.
 */
import type { MetalRequirement, StoneRequirement } from './requirements'

export interface SourcingCapabilities {
  linkOut: boolean
  match: boolean
  cart: boolean
  requests: boolean
  metals: boolean
  /** Gem materials the marketplace stocks; others can only be requested. */
  materials: readonly string[]
}

export interface StoneCandidate {
  sku: string
  url: string
  priceUsd: number | null
  carat: number
  measured: { length: number; width: number; depth: number }
  grade: { color?: string; clarity?: string; cut?: string; lab?: string; certificate?: string }
  /** 1 = drops into the seat as drawn; lower = needs the seat regenerated. */
  fit: number
  seenAt: string
}

export interface SourcingContext {
  orgId: string
  userId: string
  /** Opaque provider credentials held by the server; never sent to the browser. */
  connection: unknown
}

export interface SourcingProvider {
  readonly id: string
  readonly label: string
  capabilities(): SourcingCapabilities
  /** A deep link into the marketplace's own search, pre-filtered to fit the seat. */
  searchUrl(requirement: StoneRequirement): string | null
  matchStones?(ctx: SourcingContext, requirements: StoneRequirement[]): Promise<Record<string, StoneCandidate[]>>
  upsertCart?(ctx: SourcingContext, skus: string[]): Promise<{ checkoutUrl: string }>
  createRequest?(ctx: SourcingContext, requirement: StoneRequirement, note?: string): Promise<{ id: string; url: string }>
  quoteMetal?(ctx: SourcingContext, requirement: MetalRequirement): Promise<{ totalUsd: number; validUntil: string }>
}

export const noSourcing: SourcingProvider = {
  id: 'none',
  label: 'None',
  capabilities: () => ({ linkOut: false, match: false, cart: false, requests: false, metals: false, materials: [] }),
  searchUrl: () => null,
}
