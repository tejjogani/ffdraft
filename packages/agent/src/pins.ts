/**
 * How a pinned reference's picture is labelled inside a designer's message: a text block with
 * this prefix right before the image. The model reads which picture is which from it; the studio
 * hides the label and its picture, which the designer did not type or attach.
 */
export const PIN_LABEL_PREFIX = '[Pinned reference '
const MOODBOARD_LABEL_PREFIX = '[Moodboard reference '

export const pinLabel = (n: number, title: string, id: string, moodboard = false): string =>
  `${moodboard ? MOODBOARD_LABEL_PREFIX : PIN_LABEL_PREFIX}${n}: “${title || 'Untitled'}” (${id})]`

/** Whether a text block is a pin label (and the image after it a pinned picture). */
export const isPinLabel = (text: string): boolean =>
  text.startsWith(PIN_LABEL_PREFIX) || text.startsWith(MOODBOARD_LABEL_PREFIX)
