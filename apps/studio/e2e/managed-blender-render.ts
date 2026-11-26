// Run after installing managed Blender in a disposable local Pavé server.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { setTimeout } from 'node:timers/promises'

const [base, output] = process.argv.slice(2)
if (!base || !output) throw new Error('Pass the URL of a disposable Pavé server and a PNG path.')

async function rpc(name: string, data: object) {
  const response = await fetch(`${base}/api/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) assert.fail(`${name}: ${response.status} ${await response.text()}`)
  return response.json()
}

const piece = await rpc('pieces.create', {
  title: 'Managed Blender preview',
  templateId: 'solitaire',
})
let take = await rpc('renders.create', {
  pieceId: piece.id,
  engine: 'blender',
  scene: { output: { width: 256, height: 256, quality: 'preview' } },
})
const deadline = Date.now() + 5 * 60_000
while ((take.status === 'queued' || take.status === 'running') && Date.now() < deadline) {
  await setTimeout(1000)
  take = await rpc('renders.get', { id: take.id })
}
assert.equal(take.status, 'done', `Blender take ${take.status}: ${take.error ?? ''}`)
assert.equal(take.engine, 'blender')
assert.equal(take.assetIds.length, 1)
const response = await fetch(`${base}/api/assets/${take.assetIds[0]}`, {
  signal: AbortSignal.timeout(30_000),
})
assert.ok(response.ok, `The rendered asset returned HTTP ${response.status}`)
const png = Buffer.from(await response.arrayBuffer())
assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
assert.equal(png.readUInt32BE(16), 256)
assert.equal(png.readUInt32BE(20), 256)
await writeFile(output, png)
console.log(
  `Managed Blender rendered a 256×256 PNG in ${take.seconds}s (${take.device ?? 'device unavailable'}).`,
)
