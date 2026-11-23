/** Joins class names, skipping falsy values. Components avoid conflicting overrides by design. */
export const cn = (...classes: Array<string | false | null | undefined>): string =>
  classes.filter(Boolean).join(' ')
