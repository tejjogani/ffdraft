/** Text helpers shared by the text-based mesh formats. */

const utf8 = new TextDecoder('utf-8')

export const decodeText = (bytes: Uint8Array): string => utf8.decode(bytes)

/** The first `n` bytes as Latin-1 text, for sniffing without decoding a whole file. */
export function headText(bytes: Uint8Array, n = 512): string {
  let s = ''
  const end = Math.min(n, bytes.length)
  for (let i = 0; i < end; i++) s += String.fromCharCode(bytes[i]!)
  return s
}

/** Splits text into lines without allocating one giant array of regex matches. */
export function* lines(text: string): Generator<string> {
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    yield text.slice(start, end)
    start = end + 1
  }
}

/** Fans a polygon (vertex list) into triangles. */
export function fan(polygon: readonly number[], out: number[]): void {
  for (let i = 1; i + 1 < polygon.length; i++) out.push(polygon[0]!, polygon[i]!, polygon[i + 1]!)
}
