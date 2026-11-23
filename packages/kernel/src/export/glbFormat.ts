/** Registers the GLB writer (./glb.ts, owned by the render pipeline) as an export format. */
import { defineExporter } from '../core'
import { writeGlb } from './glb'

export const glb = defineExporter({
  format: 'glb',
  detail: 'production',
  run(scene, options) {
    const only = options.only && new Set(options.only)
    const evaluation = only
      ? {
          ...scene.evaluation,
          parts: scene.parts.filter((p) => p.sources.some((s) => only.has(s.nodeId))).map((p) => p.part),
          stones: scene.evaluation.stones.filter((s) => only.has(s.nodeId)),
        }
      : scene.evaluation
    return {
      bytes: writeGlb(evaluation, { stones: options.stones ?? true }),
      mime: 'model/gltf-binary',
      extension: 'glb',
      notes: ['Metal is fused per alloy; stones are instanced reference geometry.'],
    }
  },
})
