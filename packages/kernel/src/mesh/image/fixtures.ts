/** Test fixtures: PNG bytes written without any image library. */
import { zlibSync } from 'fflate'

/** Minimal PNG writer: one IDAT, the given filter on every row. */
export function png(
  width: number,
  height: number,
  type: number,
  depth: number,
  rows: Uint8Array[],
  extra: [string, Uint8Array][] = [],
  filter = 0,
): Uint8Array {
  const chunk = (name: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length)
    const view = new DataView(out.buffer)
    view.setUint32(0, body.length)
    for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i)
    out.set(body, 8)
    return out // CRC is not checked by the decoder
  }
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, width)
  v.setUint32(4, height)
  ihdr.set([depth, type, 0, 0, 0], 8)
  const raw = new Uint8Array(rows.reduce((n, r) => n + r.length + 1, 0))
  let at = 0
  for (const r of rows) {
    raw[at++] = filter
    raw.set(r, at)
    at += r.length
  }
  const parts = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...extra.map(([n, b]) => chunk(n, b)),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** An 8-bit greyscale PNG whose pixel (x, y) — from the top-left — has `value(x, y)` in 0–1. */
export function grayPng(
  width: number,
  height: number,
  value: (x: number, y: number) => number,
): Uint8Array {
  const rows = Array.from({ length: height }, (_, y) =>
    Uint8Array.from({ length: width }, (_, x) => Math.round(255 * value(x, y))),
  )
  return png(width, height, 0, 8, rows)
}
