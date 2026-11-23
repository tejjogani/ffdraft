/**
 * Viewport demo for @pave/render/three: the fixture solitaire or a 300-stone pavé bar in any
 * look. URL parameters (look, piece, metal, ground, bounces, size, ui=0) make it scriptable;
 * `window.paveReady` turns true once a frame with the environment has been drawn.
 */
import { METAL_IDS, type MetalId, RenderSceneSchema, type RenderSceneInput } from '@pave/schema'
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { paveBar, solitaireRing } from '../fixtures'
import { LOOK_IDS, type LookId, resolveScene } from '../src'
import { applyResolvedScene, configureRenderer, createEnvironment, evaluationToThree } from '../src/three'

declare global {
  interface Window {
    paveReady: boolean
  }
}

const params = new URLSearchParams(location.search)
const look = (params.get('look') ?? 'studio-soft') as LookId
const piece = params.get('piece') ?? 'ring'
const metal = (params.get('metal') ?? (piece === 'ring' ? 'au18k-yellow' : 'au18k-white')) as MetalId
const bounces = Number(params.get('bounces') ?? 6)
const size = Number(params.get('size') ?? 768)
const ground = (params.get('ground') ?? 'look') as RenderSceneInput['ground']

function select(id: string, values: readonly string[], current: string) {
  const el = document.getElementById(id) as HTMLSelectElement | HTMLInputElement
  if (el instanceof HTMLSelectElement && !el.options.length)
    for (const v of values) el.add(new Option(v, v))
  el.value = current
  el.onchange = () => {
    params.set(id, el.value)
    location.search = params.toString()
  }
}
if (params.get('ui') === '0') document.getElementById('ui')!.style.display = 'none'
select('look', LOOK_IDS, look)
select('piece', [], piece)
select('metal', METAL_IDS, metal)
select('bounces', [], String(bounces))

const evaluation = piece === 'pave' ? paveBar({ material: metal, plating: metal.includes('white') ? 'rhodium' : 'none' }) : solitaireRing({ material: metal })
const scene = RenderSceneSchema.parse({
  look,
  ground,
  camera: { preset: piece === 'pave' ? 'front' : 'hero' },
  output: { width: size, height: size, quality: 'preview' },
})
const resolved = resolveScene(scene, evaluation)

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true })
renderer.setPixelRatio(1)
renderer.setSize(size, size)
document.body.append(renderer.domElement)
configureRenderer(renderer, resolved)

const threeScene = new Scene()
const camera = new PerspectiveCamera(30, 1)
const environment = createEnvironment(renderer, resolved)
const model = evaluationToThree(evaluation, resolved, {
  environment,
  gemQuality: { hero: { bounces, dispersion: true }, melee: { bounces: Math.min(bounces, 3), dispersion: false } },
})
threeScene.add(model.object)
applyResolvedScene(threeScene, camera, resolved, { model, environment })

// A still: draw a few frames (shader compilation, shadow maps), then stop.
let frames = 0
renderer.setAnimationLoop(() => {
  renderer.render(threeScene, camera)
  if (++frames < 3) return
  renderer.setAnimationLoop(null)
  window.paveReady = true
})
