/** Registers the GLB writer (./glb.ts, owned by the render pipeline) as an export format. */
import { defineExporter } from '../core'
import { writeGlb } from './glb'
import { nothingToExport } from './meshes'

export const glb = defineExporter({
  format: 'glb',
  detail: 'production',
  run(scene, options) {
    const only = options.only && new Set(options.only)
    const evaluation = only
      ? {
          ...scene.evaluation,
          parts: scene.parts
            .filter((p) => p.sources.some((s) => only.has(s.nodeId)))
            .map((p) => p.part),
          stones: scene.evaluation.stones.filter((s) => only.has(s.nodeId)),
        }
      : scene.evaluation
    const stones = options.stones ?? true
    // Never an empty file, as with the other formats: a glTF with no meshes, accessors or
    // buffer data is not a valid glTF, and a renderer handed one fails further from the cause.
    if (evaluation.parts.length === 0 && !(stones && evaluation.stones.length > 0))
      throw new Error(nothingToExport({ stones, ...(options.only && { only: options.only }) }))
    return {
      bytes: writeGlb(evaluation, { stones }),
      mime: 'model/gltf-binary',
      extension: 'glb',
      notes: ['Metal is fused per alloy; stones are instanced reference geometry.'],
    }
  },
})
