/**
 * The viewport's studio: the look's rig rendered as emissive panels and an ambient gradient
 * into a PMREM. The Blender worker builds the same panels as emissive planes and the same
 * gradient as its world, so reflections match without HDRI files (research §3).
 */
import {
  BackSide,
  BufferAttribute,
  Color,
  DoubleSide,
  Group,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PlaneGeometry,
  PMREMGenerator,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three'
import type { Rgb } from '../color'
import type { ResolvedRig, ResolvedScene } from '../types'
import type { SparkleUniforms } from './gem'
import { toThreePoint, zUpGroup } from './space'

const AMBIENT = {
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      vDir = normalize( position );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  // Same formula as the Blender world: horizon blended toward zenith / nadir by view z.
  fragmentShader: /* glsl */ `
    uniform vec3 zenith, horizon, nadir;
    varying vec3 vDir;
    void main() {
      float z = vDir.z;
      gl_FragColor = vec4( horizon + ( zenith - horizon ) * max( z, 0.0 ) + ( nadir - horizon ) * max( -z, 0.0 ), 1.0 );
    }`,
}

function panelMesh(p: ResolvedRig['panels'][number], scale: number): Mesh {
  const geometry = new PlaneGeometry(p.size[0], p.size[1])
  // PlaneGeometry vertices: top-left, top-right, bottom-left, bottom-right.
  const [bottom, top] = p.gradient.map((k) => k * scale) as [number, number]
  const colors = new Float32Array(12)
  for (const [i, k] of [top, top, bottom, bottom].entries())
    colors.set([p.radiance[0] * k, p.radiance[1] * k, p.radiance[2] * k], i * 3)
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  const mesh = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: DoubleSide, toneMapped: false }),
  )
  mesh.name = p.id
  return mesh
}

/**
 * Diffuse radiance of the floor under the piece: albedo × irradiance / π, with the irradiance of
 * the ambient gradient (∫ L cos dω = π·horizon + 2π/3·(zenith − horizon)) plus each panel as a
 * small emitter. Cycles sees the real sweep in reflections; the PMREM gets this flat stand-in.
 */
function diffuseFloorRadiance({ ambient, panels, pivot }: ResolvedRig, z: number, color: Rgb): Rgb {
  const floor = new Vector3(pivot[0], pivot[1], z)
  const e = [0, 1, 2].map(
    (c) =>
      Math.PI * ambient.horizon[c]! +
      ((2 * Math.PI) / 3) * (ambient.zenith[c]! - ambient.horizon[c]!),
  )
  for (const p of panels) {
    const v = new Vector3(...p.position).sub(floor)
    const d = v.length()
    v.divideScalar(d)
    const normal = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(...p.quaternion))
    const cos = Math.max(0, v.z) * Math.max(0, -normal.dot(v))
    const k = (cos * p.size[0] * p.size[1] * (p.gradient[0] + p.gradient[1])) / 2 / (d * d)
    for (let c = 0; c < 3; c++) e[c]! += p.radiance[c]! * k
  }
  return [0, 1, 2].map((c) => (color[c]! * e[c]!) / Math.PI) as Rgb
}

/**
 * What the PMREM sees below the horizon. Cycles has the real ground in the scene; the capture
 * gets a stand-in: a pale floor is a flat emitter at its lit radiance, and black acrylic is a
 * mirrored copy of the rig dimmed by Fresnel reflectance at grazing view.
 */
export type CaptureFloor =
  | { kind: 'emitter'; z: number; radiance: [number, number, number] }
  | { kind: 'mirror'; z: number; reflectance: number }

/** Schlick reflectance of a dielectric at 75° incidence. */
const grazingReflectance = (ior: number) => {
  const f0 = ((ior - 1) / (ior + 1)) ** 2
  return f0 + (1 - f0) * (1 - Math.cos((75 * Math.PI) / 180)) ** 5
}

export function captureFloor(resolved: ResolvedScene): CaptureFloor | undefined {
  const g = resolved.ground
  if (g.kind === 'reflective')
    return { kind: 'mirror', z: g.z, reflectance: grazingReflectance(g.ior) }
  if (g.kind === 'sweep' || g.kind === 'white-gloss')
    return { kind: 'emitter', z: g.z, radiance: diffuseFloorRadiance(resolved.rig, g.z, g.color) }
  return undefined
}

function rigGroup(rig: ResolvedRig, scale = 1): Group {
  const pivot = new Group()
  pivot.position.set(...rig.pivot)
  pivot.rotation.z = (rig.rotation * Math.PI) / 180
  for (const p of rig.panels) {
    const mesh = panelMesh(p, scale)
    mesh.position.set(
      p.position[0] - rig.pivot[0],
      p.position[1] - rig.pivot[1],
      p.position[2] - rig.pivot[2],
    )
    mesh.quaternion.set(...p.quaternion)
    pivot.add(mesh)
  }
  return pivot
}

/** Builds the rig as a scene in three.js world space (Y up). */
export function buildRigScene(rig: ResolvedRig, radius: number, floor?: CaptureFloor): Scene {
  const scene = new Scene()
  scene.background = new Color(0, 0, 0)
  const stage = zUpGroup('rig-stage')
  scene.add(stage)

  const ambient = new Mesh(
    new SphereGeometry(radius * 150, 64, 32),
    new ShaderMaterial({
      ...AMBIENT,
      side: BackSide,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        zenith: { value: new Vector3(...rig.ambient.zenith) },
        horizon: { value: new Vector3(...rig.ambient.horizon) },
        nadir: { value: new Vector3(...rig.ambient.nadir) },
      },
    }),
  )
  ambient.position.set(...rig.pivot)
  ambient.renderOrder = -1
  stage.add(ambient)

  stage.add(rigGroup(rig))
  if (floor?.kind === 'emitter') {
    const plane = new Mesh(
      new PlaneGeometry(radius * 200, radius * 200),
      new MeshBasicMaterial({ color: new Color(...floor.radiance), toneMapped: false }),
    )
    plane.position.set(rig.pivot[0], rig.pivot[1], floor.z)
    stage.add(plane)
  }
  if (floor?.kind === 'mirror') {
    // Reflect the rig through the plane z = floor.z.
    const mirror = new Group()
    mirror.position.z = 2 * floor.z
    mirror.scale.z = -1
    mirror.add(rigGroup(rig, floor.reflectance))
    stage.add(mirror)
  }
  return scene
}

export interface PaveEnvironment {
  /** PMREM cube texture: use as `scene.environment` and as the gem shader's environment. */
  texture: Texture
  /** Rig rotation baked into the texture (degrees), so animation can rotate relative to it. */
  rotation: number
  /** Sparkle lights in three.js world space with the rig turned to `rotationDeg`. */
  sparklesAt(rotationDeg: number): SparkleUniforms
  dispose(): void
}

/** Renders the look's rig into a PMREM environment. */
export function createEnvironment(
  renderer: WebGLRenderer,
  resolved: ResolvedScene,
  size = 512,
): PaveEnvironment {
  const { rig } = resolved
  const { radius } = resolved.subject
  const scene = buildRigScene(rig, radius, captureFloor(resolved))
  const pmrem = new PMREMGenerator(renderer)
  const toneMapping = renderer.toneMapping
  renderer.toneMapping = NoToneMapping
  const target = pmrem.fromScene(scene, 0, radius * 0.05, radius * 400, {
    size,
    position: toThreePoint(rig.pivot),
  })
  renderer.toneMapping = toneMapping
  pmrem.dispose()
  scene.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose()
      o.material.dispose()
    }
  })
  return {
    texture: target.texture,
    rotation: rig.rotation,
    sparklesAt: (deg) => sparkleUniforms(rig, deg),
    dispose: () => target.dispose(),
  }
}

/** Sparkle lights as world-space disks: radiance L = I / πr², angular radius r / d. */
export function sparkleUniforms(rig: ResolvedRig, rotationDeg = rig.rotation): SparkleUniforms {
  const rotate = new Matrix4().makeRotationZ((rotationDeg * Math.PI) / 180)
  const pivot = new Vector3(...rig.pivot)
  const out: SparkleUniforms = { positions: [], radiance: [], cos: [] }
  for (const s of rig.sparkles) {
    const local = new Vector3(...s.position).sub(pivot).applyMatrix4(rotate).add(pivot)
    const distance = local.distanceTo(pivot)
    const p = toThreePoint([local.x, local.y, local.z])
    const area = Math.PI * s.radius * s.radius
    // Raster pixels cannot resolve a sub-arcminute disk; widen to ~0.6° and keep energy.
    const angle = Math.max(s.radius / distance, 0.01)
    const k = (s.radius / distance / angle) ** 2
    out.positions.push(p)
    out.radiance.push(new Vector3(...s.intensity).multiplyScalar(k / area))
    out.cos.push(Math.cos(angle))
  }
  return out
}

/** Lookup rotation for an environment rotated by `deg` about the vertical axis. */
export function environmentRotation(deg: number): Matrix3 {
  return new Matrix3().setFromMatrix4(new Matrix4().makeRotationY((-deg * Math.PI) / 180))
}
