/**
 * Metals as MeshPhysicalMaterial (research §5: "Metals need nothing custom"), tuned from the
 * library. Two shader patches cover what the stock material cannot do on CAD meshes without
 * UVs: brushed anisotropy needs a tangent frame (we use the circumferential direction around
 * the brush axis, as Blender's radial Tangent node does), and hammered relief perturbs the
 * normal with the same Voronoi-dimple field the Blender worker bump-maps. Sandblast grain is
 * below viewport resolution and is left to the roughness.
 */
import type { FinishId, MetalId, PlatingId } from '@pave/schema'
import {
  Color,
  LinearSRGBColorSpace,
  MeshPhysicalMaterial,
  ShaderChunk,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { type MetalMaterial, metalMaterial } from '../materials'

const BRUSH_FRAME = /* glsl */ `
uniform vec3 paveBrushAxis;
uniform mat4 modelViewMatrix;
mat3 paveBrushFrame( vec3 n ) {
  // The axis is in object space, which for Pavé meshes is the piece frame.
  vec3 axis = normalize( mat3( modelViewMatrix ) * paveBrushAxis );
  vec3 t = cross( axis, n );
  t = dot( t, t ) < 1e-6 ? cross( vec3( 0.0, 1.0, 0.0 ), n ) : normalize( t );
  return mat3( t, cross( n, t ), n );
}
`

/** Hash-based 3D Voronoi; returns the offset from the nearest cell centre (object units). */
const CELLS = /* glsl */ `
uniform float paveCellSize;
uniform float paveCellStrength;
uniform mat3 normalMatrix;
varying vec3 vPaveObject;
vec3 paveHash3( vec3 p ) {
  p = vec3( dot( p, vec3( 127.1, 311.7, 74.7 ) ), dot( p, vec3( 269.5, 183.3, 246.1 ) ), dot( p, vec3( 113.5, 271.9, 124.6 ) ) );
  return fract( sin( p ) * 43758.5453123 );
}
vec3 paveCellOffset( vec3 p ) {
  vec3 cell = floor( p );
  vec3 best = vec3( 0.0 );
  float bestD = 1e9;
  for ( int z = -1; z <= 1; z ++ ) for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec3 c = cell + vec3( x, y, z );
    vec3 d = c + paveHash3( c ) - p;
    float dd = dot( d, d );
    if ( dd < bestD ) { bestD = dd; best = d; }
  }
  return -best;
}
`

function patch(m: MetalMaterial) {
  return (shader: WebGLProgramParametersWithUniforms) => {
    if (m.anisotropy > 0) {
      shader.uniforms.paveBrushAxis = { value: new Vector3(...m.brushAxis) }
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <normal_fragment_begin>',
          ShaderChunk.normal_fragment_begin.replace(
            /getTangentFrame\([\s\S]*?\);/,
            'paveBrushFrame( normal );',
          ),
        )
        .replace('void main() {', `${BRUSH_FRAME}\nvoid main() {`)
    }
    if (m.relief?.kind === 'cells') {
      shader.uniforms.paveCellSize = { value: m.relief.sizeMm }
      shader.uniforms.paveCellStrength = { value: m.relief.strength }
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'varying vec3 vPaveObject;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaveObject = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', `${CELLS}\nvoid main() {`)
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
        {
          // A spherical dimple per cell: the surface tilts toward the cell centre.
          vec3 offset = paveCellOffset( vPaveObject / paveCellSize );
          vec3 tilt = normalize( normalMatrix * offset ) * paveCellStrength * length( offset );
          normal = normalize( normal + tilt - dot( tilt, normal ) * normal );
        }`,
        )
    }
  }
}

export function createMetalMaterialFrom(m: MetalMaterial): MeshPhysicalMaterial {
  const material = new MeshPhysicalMaterial({
    color: new Color().setRGB(m.color[0], m.color[1], m.color[2], LinearSRGBColorSpace),
    metalness: 1,
    roughness: m.roughness,
    anisotropy: m.anisotropy,
  })
  if (m.anisotropy > 0 || m.relief?.kind === 'cells') {
    material.onBeforeCompile = patch(m)
    material.customProgramCacheKey = () => `pave-metal:${m.anisotropy > 0}:${m.relief?.kind ?? ''}`
  }
  return material
}

export function createMetalMaterial(
  id: MetalId,
  finish: FinishId,
  plating: PlatingId,
): MeshPhysicalMaterial {
  return createMetalMaterialFrom(metalMaterial(id, finish, plating))
}
