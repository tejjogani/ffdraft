/**
 * `resolveScene`: the pure, deterministic compiler from the user/assistant-facing RenderScene to
 * an explicit job (research §4: "Compilation is a pure function of scene, GLB hash and compiler
 * version, so results are cacheable and the compiler can be golden-tested without rendering").
 */
import type { Evaluation } from '@pave/kernel/types'
import type { RenderScene } from '@pave/schema'
import { RACK_FOCUS_FSTOP, resolveAnimation } from './animation'
import { resolveCamera } from './camera'
import { resolveBackground, resolveGround } from './ground'
import { LOOKS } from './looks'
import {
  gemKey,
  gemMaterial,
  metalKey,
  metalMaterial,
  type ResolvedMaterial,
  type SurfaceMaterial,
} from './materials'
import { importedRenderMaterial } from './materials/imported'
import { resolveOutput } from './quality'
import { resolveRig } from './rig'
import { boundsCenter, boundsRadius, type SceneSubject, subjectOf } from './subject'
import { RESOLVED_SCENE_VERSION, type ResolvedScene } from './types'

const IMPORT_CLAY = 'surface:imported-clay'
const importClay: SurfaceMaterial = {
  kind: 'surface',
  color: [0.34, 0.34, 0.34],
  roughness: 0.56,
  ior: 1.45,
  subsurfaceMm: 0,
  thinFilm: null,
  coat: 0,
}

function resolveMaterials(scene: RenderScene, subject: SceneSubject) {
  const materials: Record<string, ResolvedMaterial> = {}
  const assignments: Record<string, string> = {}
  // '*' applies to the whole piece; a node's own override wins over it.
  const override = (nodeId: string) => ({ ...scene.overrides['*'], ...scene.overrides[nodeId] })
  for (const part of subject.parts) {
    if (scene.includeUnassignedRhino && part.importRole === 'unassigned') {
      if (scene.importedBodyLook === 'source' && part.sourceAppearance) {
        const key = `source:${JSON.stringify(part.sourceAppearance)}`
        materials[key] ??= importedRenderMaterial(part.sourceAppearance)
        assignments[part.id] = key
      } else {
        materials[IMPORT_CLAY] = importClay
        assignments[part.id] = IMPORT_CLAY
      }
      continue
    }
    const o = override(part.nodeId)
    const metal = o.material ?? part.material
    const finish = o.finish ?? part.finish
    const plating = o.plating ?? part.plating
    const k = metalKey(metal, finish, plating)
    materials[k] ??= metalMaterial(metal, finish, plating)
    assignments[part.id] = k
  }
  for (const s of subject.stones) {
    const stone = override(s.nodeId).stone ?? s.stone
    const k = gemKey(stone)
    materials[k] ??= gemMaterial(stone)
    assignments[s.id] = k
  }
  return { materials, assignments }
}

export function resolveScene(scene: RenderScene, input: Evaluation | SceneSubject): ResolvedScene {
  const subject = subjectOf(input)
  const look = LOOKS[scene.look]
  const radius = boundsRadius(subject.bounds)
  const output = resolveOutput(scene.output, scene.animation !== undefined)

  const frameReflection =
    scene.look === 'black-acrylic' && (scene.ground === 'look' || scene.ground === 'reflective')
  const camera = resolveCamera(scene.camera, subject, output.width / output.height, frameReflection)
  if (scene.animation?.type === 'rack-focus') camera.fStop ??= RACK_FOCUS_FSTOP

  const rig = resolveRig(look, scene.environment, scene.sparkle, camera.target, radius, camera)
  const floorZ = subject.bounds.min[2]

  return {
    version: RESOLVED_SCENE_VERSION,
    look: scene.look,
    subject: { center: boundsCenter(subject.bounds), radius },
    color: { view: look.view, exposure: look.exposure },
    camera,
    rig,
    background: resolveBackground(scene.environment, look),
    ground: resolveGround(scene.ground, look, floorZ, camera.target, radius, camera.azimuth),
    ...resolveMaterials(scene, subject),
    animation: scene.animation
      ? resolveAnimation(scene.animation, camera, rig.rotation, radius)
      : null,
    output,
  }
}
