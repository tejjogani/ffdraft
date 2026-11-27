import type { Camera } from '@pave/match'
import { applyOps, buildDesign, type Design, type PhotoRead, TEMPLATES } from '@pave/schema'
import sharp from 'sharp'
import type { PaveServer } from '../app'
import { serviceContext } from '../service-context'

/** The read Claude would give of the photo: a six-claw round solitaire seen three-quarter. */
export const SCRIPTED_READ: PhotoRead = {
  observations: 'A round brilliant in six claws on a plain court band, seen from front and above.',
  kind: { value: 'ring', visible: 'yes' },
  view: 'threeQuarter',
  archetype: { value: 'solitaire', visible: 'yes' },
  stones: [
    {
      role: 'center',
      cut: 'round',
      arrangement: 'single',
      setting: 'prong',
      prongs: 6,
      countVisible: 1,
      widthToCentre: 1,
      visible: 'yes',
    },
  ],
  band: {
    profile: 'court',
    shoulder: 'plain',
    widthToStone: 0.3,
    taperTopToBottom: 1,
    visible: 'yes',
  },
  body: null,
  metal: { colour: 'white', finish: 'polished', visible: 'yes' },
  notVisible: ['the inside of the band'],
  unsure: [],
  plainBackground: true,
}

const SIZE = 480
const CAMERA: Camera = {
  azimuth: 45,
  elevation: 42,
  roll: 0,
  target: [0, 0, 3],
  distance: 180,
  span: 42,
  shift: [0, 0],
}

export function referenceDesign() {
  const base = buildDesign({
    ...TEMPLATES.find((template) => template.id === 'solitaire')!.spec,
    stones: [{ role: 'center', cut: 'round', carat: 1, setting: 'prong', prongs: 6 }],
  })
  const width = (base.nodes.center as { width: number }).width * 1.15
  const band = (base.nodes.band as { widthTop: number }).widthTop * 1.35
  const truth = applyOps(base, [
    { t: 'update', id: 'center', patch: { width } },
    { t: 'update', id: 'band', patch: { widthTop: band, widthBottom: band } },
  ]).design
  return { truth, width, band }
}

/** The source and result are drawn at an identical pose, pixel scale and framing for grading. */
export async function referencePixels(server: PaveServer, design: Design, fixedCamera = true) {
  const context = await server.runtime.context(server.runtime.local!)
  const geometry = context.services.get('geometry')
  if (!geometry.picture) throw new Error('The server has no CAD capture engine.')
  const { images } = await geometry.picture(
    design,
    {
      views: ['three-quarter'],
      size: SIZE,
      focus: [],
      ...(fixedCamera ? { shots: [{ camera: CAMERA, width: SIZE, height: SIZE }] } : {}),
    },
    serviceContext(context),
  )
  return images[0]!
}

export function encodeReference(pixels: Uint8Array) {
  return sharp(pixels, { raw: { width: SIZE, height: SIZE, channels: 4 } })
}

/** Foreground intersection over union on raw clay captures, before JPEG/PNG encoding. */
export function referenceOverlap(reference: Uint8Array, fitted: Uint8Array): number {
  if (reference.length !== fitted.length || reference.length % 4 !== 0)
    throw new Error('Contour images must have the same RGBA dimensions.')
  // The untouched background of @pave/match's headless clay rasterizer.
  const foreground = (pixels: Uint8Array, i: number) =>
    pixels[i] !== 244 || pixels[i + 1] !== 243 || pixels[i + 2] !== 240
  let union = 0
  let intersection = 0
  for (let i = 0; i < reference.length; i += 4) {
    const a = foreground(reference, i)
    const b = foreground(fitted, i)
    if (a || b) union++
    if (a && b) intersection++
  }
  return union === 0 ? 0 : intersection / union
}
