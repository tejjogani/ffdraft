import type { ExemplarSource } from '../model'

/** Typed identity: keeps exemplar files terse while the compiler checks every field. */
export const exemplar = (e: ExemplarSource): ExemplarSource => e

export const us = (value: number) => ({ system: 'us' as const, value })
