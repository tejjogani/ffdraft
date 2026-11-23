/**
 * GemMaterial — our refraction shader (research §5: drei's MeshRefractionMaterial does not
 * compile on three r187, so we own this). Per fragment, from the facet the camera sees:
 *
 *   - exact dielectric Fresnel split into reflection and refraction;
 *   - the refracted ray bounces inside the stone, traced against the gem's BVH
 *     (three-mesh-bvh's GLSL traversal); each internal hit splits again by Fresnel, with total
 *     internal reflection where it applies, and the escaping part looks up the environment;
 *   - per-channel IOR from the Abbe number (n_F − n_C = (n_d − 1) / V), so fire is real
 *     dispersion rather than an arbitrary RGB shift;
 *   - Beer–Lambert absorption by path length (attenuation colour / distance, as in Cycles);
 *   - glints from the rig's sparkle lights on every escaping ray.
 *
 * Optics run in world space; traversal runs in the gem's local space with the un-normalised
 * local direction, so hit distances stay world millimetres and non-uniform instance scales
 * (ovals, pears) still refract correctly. Works on InstancedMesh: hundreds of pavé stones share
 * one geometry and one BVH, and cost scales with gem pixels, not stone count.
 */
import { BVHShaderGLSL, MeshBVH, MeshBVHUniformStruct } from 'three-mesh-bvh'
import {
  type BufferGeometry,
  Color,
  LinearSRGBColorSpace,
  Matrix3,
  MeshPhysicalMaterial,
  ShaderMaterial,
  type Texture,
  Vector3,
} from 'three'
import type { GemMaterial as GemOptics, SurfaceMaterial } from '../materials'

export const MAX_SPARKLES = 8
const MAX_BOUNCES = 8

export interface GemQuality {
  /** Internal bounces, 1–8. Hero stones 5–6, melee 2 (research §5 budget). */
  bounces: number
  /** Trace red, green and blue separately (true fire) or one ray with the mean IOR. */
  dispersion: boolean
}

export const GEM_QUALITY = {
  hero: { bounces: 6, dispersion: true },
  melee: { bounces: 2, dispersion: false },
} as const satisfies Record<string, GemQuality>

const vertexShader = /* glsl */ `
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
flat varying mat3 vToLocal;
flat varying vec3 vGemCenter;

void main() {
  mat4 toWorld = modelMatrix;
  #ifdef USE_INSTANCING
    toWorld = modelMatrix * instanceMatrix;
  #endif
  vec4 world = toWorld * vec4( position, 1.0 );
  vWorldPosition = world.xyz;
  vLocalPosition = position;
  vToLocal = inverse( mat3( toWorld ) );
  vGemCenter = toWorld[ 3 ].xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const fragmentShader = /* glsl */ `
precision highp isampler2D;
precision highp usampler2D;

${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}

uniform BVH bvh;
uniform samplerCube envMap;
uniform mat3 envRotation;
uniform float envIntensity;
uniform float ior;
uniform float iorSpread;
uniform vec3 sigma;
uniform int bounces;
uniform int sparkleCount;
uniform vec3 sparklePosition[ ${MAX_SPARKLES} ];
uniform vec3 sparkleRadiance[ ${MAX_SPARKLES} ];
uniform float sparkleCos[ ${MAX_SPARKLES} ];

varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
flat varying mat3 vToLocal;
flat varying vec3 vGemCenter;

float fresnelDielectric( float cosI, float eta ) {
  // eta = n_incident / n_transmitted
  float sinT2 = eta * eta * ( 1.0 - cosI * cosI );
  if ( sinT2 >= 1.0 ) return 1.0;
  float cosT = sqrt( 1.0 - sinT2 );
  float rs = ( eta * cosI - cosT ) / ( eta * cosI + cosT );
  float rp = ( cosI - eta * cosT ) / ( cosI + eta * cosT );
  return 0.5 * ( rs * rs + rp * rp );
}

vec3 environment( vec3 dir ) {
  vec3 c = textureLod( envMap, envRotation * dir, 0.0 ).rgb * envIntensity;
  for ( int i = 0; i < ${MAX_SPARKLES}; i ++ ) {
    if ( i >= sparkleCount ) break;
    vec3 toLight = normalize( sparklePosition[ i ] - vGemCenter );
    c += sparkleRadiance[ i ] * smoothstep( sparkleCos[ i ] - 1e-4, sparkleCos[ i ], dot( dir, toLight ) );
  }
  return c;
}

// Light leaving the stone along the refracted ray of one wavelength (n = channel IOR).
vec3 traceInside( vec3 dir, float n ) {
  vec3 origin = vLocalPosition;
  vec3 radiance = vec3( 0.0 );
  vec3 throughput = vec3( 1.0 );
  mat3 toWorldNormal = transpose( vToLocal );
  for ( int i = 0; i < ${MAX_BOUNCES}; i ++ ) {
    if ( i >= bounces ) break;
    vec3 localDir = vToLocal * dir;
    uvec4 faceIndices;
    vec3 faceNormal, barycoord;
    float side, dist;
    if ( ! bvhIntersectFirstHit( bvh, origin + localDir * 1e-4, localDir, faceIndices, faceNormal, barycoord, side, dist ) ) break;
    // faceNormal opposes the ray: it points into the stone at this exit facet.
    vec3 normal = normalize( toWorldNormal * faceNormal );
    throughput *= exp( - sigma * dist );
    float cosI = clamp( dot( - dir, normal ), 0.0, 1.0 );
    float f = fresnelDielectric( cosI, n );
    if ( f < 1.0 ) radiance += throughput * ( 1.0 - f ) * environment( refract( dir, normal, n ) );
    throughput *= f;
    dir = reflect( dir, normal );
    origin += localDir * ( dist + 1e-4 );
    if ( max( throughput.r, max( throughput.g, throughput.b ) ) < 0.02 ) break;
  }
  // Light still trapped after the last bounce leaves somewhere; approximate it by the
  // environment along the current direction rather than dropping it to black.
  return radiance + throughput * environment( dir ) * 0.5;
}

void main() {
  vec3 view = normalize( vWorldPosition - cameraPosition );
  vec3 normal = normalize( cross( dFdx( vWorldPosition ), dFdy( vWorldPosition ) ) );
  if ( dot( normal, view ) > 0.0 ) normal = - normal;
  float cosI = clamp( dot( - view, normal ), 0.0, 1.0 );
  float f = fresnelDielectric( cosI, 1.0 / ior );
  vec3 color = f * environment( reflect( view, normal ) );

  #ifdef DISPERSION
    vec3 inside;
    float nr = ior - iorSpread, ng = ior, nb = ior + iorSpread;
    inside.r = traceInside( refract( view, normal, 1.0 / nr ), nr ).r;
    inside.g = traceInside( refract( view, normal, 1.0 / ng ), ng ).g;
    inside.b = traceInside( refract( view, normal, 1.0 / nb ), nb ).b;
  #else
    vec3 inside = traceInside( refract( view, normal, 1.0 / ior ), ior );
  #endif
  color += ( 1.0 - f ) * inside;

  gl_FragColor = vec4( color, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** One BVH per gem geometry; pavé InstancedMeshes reuse it. */
const bvhCache = new WeakMap<BufferGeometry, MeshBVHUniformStruct>()

function bvhUniform(geometry: BufferGeometry): MeshBVHUniformStruct {
  let struct = bvhCache.get(geometry)
  if (!struct) {
    struct = new MeshBVHUniformStruct()
    struct.updateFrom(new MeshBVH(geometry, { targetLeafSize: 4 }))
    bvhCache.set(geometry, struct)
  }
  return struct
}

export interface SparkleUniforms {
  positions: Vector3[]
  radiance: Vector3[]
  cos: number[]
}

export class GemMaterial extends ShaderMaterial {
  constructor(optics: GemOptics, geometry: BufferGeometry, quality: GemQuality = GEM_QUALITY.hero) {
    const sigma = optics.attenuationColor.map((c) => -Math.log(Math.max(c, 1e-6)) / optics.attenuationDistance)
    super({
      vertexShader,
      fragmentShader,
      uniforms: {
        bvh: { value: bvhUniform(geometry) },
        envMap: { value: null },
        envRotation: { value: new Matrix3() },
        envIntensity: { value: 1 },
        ior: { value: optics.ior },
        // Half the F–C spread either side of n_d; red and blue sit near C and F.
        iorSpread: { value: (optics.ior - 1) / optics.abbe / 2 },
        sigma: { value: new Vector3(...sigma) },
        bounces: { value: quality.bounces },
        sparkleCount: { value: 0 },
        sparklePosition: { value: Array.from({ length: MAX_SPARKLES }, () => new Vector3()) },
        sparkleRadiance: { value: Array.from({ length: MAX_SPARKLES }, () => new Vector3()) },
        sparkleCos: { value: new Array<number>(MAX_SPARKLES).fill(1) },
      },
      defines: quality.dispersion ? { DISPERSION: '' } : {},
    })
    this.name = 'GemMaterial'
  }

  setQuality(quality: GemQuality): void {
    this.uniforms.bounces!.value = Math.max(1, Math.min(MAX_BOUNCES, Math.round(quality.bounces)))
    const has = 'DISPERSION' in this.defines
    if (has !== quality.dispersion) {
      if (quality.dispersion) this.defines.DISPERSION = ''
      else delete this.defines.DISPERSION
      this.needsUpdate = true
    }
  }

  setEnvironment(texture: Texture | null, rotation: Matrix3, sparkles: SparkleUniforms): void {
    this.uniforms.envMap!.value = texture
    this.uniforms.envRotation!.value.copy(rotation)
    const n = Math.min(MAX_SPARKLES, sparkles.positions.length)
    this.uniforms.sparkleCount!.value = n
    for (let i = 0; i < n; i++) {
      this.uniforms.sparklePosition!.value[i].copy(sparkles.positions[i])
      this.uniforms.sparkleRadiance!.value[i].copy(sparkles.radiance[i])
      this.uniforms.sparkleCos!.value[i] = sparkles.cos[i]
    }
  }
}

/** Opaque and translucent stones: a physical surface (research §2: never refracted). */
export function createSurfaceGemMaterial(m: SurfaceMaterial): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({
    color: new Color().setRGB(m.color[0], m.color[1], m.color[2], LinearSRGBColorSpace),
    roughness: m.roughness,
    metalness: 0,
    ior: m.ior,
    clearcoat: m.coat,
    clearcoatRoughness: 0.05,
    iridescence: m.thinFilm ? 1 : 0,
    iridescenceIOR: 1.4,
    iridescenceThicknessRange: m.thinFilm ?? [100, 400],
  })
}
