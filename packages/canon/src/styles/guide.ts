import type { StyleGuide } from '../model'

/** Typed identity: keeps style files terse while the compiler checks every field. */
export const guide = (g: StyleGuide): StyleGuide => g
