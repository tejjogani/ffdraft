/**
 * Places a resolved scene's camera, background, ground and animation in a three.js scene so
 * the viewport previews what Blender will render. Depth of field and the acrylic's blur are
 * left to the final render.
 */
import {
  AgXToneMapping,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  type Group,
  LinearSRGBColorSpace,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  type Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  type Scene,
  type ShaderMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  UniformsUtils,
  Vector3,
  VSMShadowMap,
  type WebGLRenderer,
} from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { sampleTrack } from '../animation'
import { cameraPose, viewTangents } from '../camera'
import type { Background } from '../looks'
import type { ResolvedCamera, ResolvedGround, ResolvedScene, TrackTarget } from '../types'
import type { PaveEnvironment } from './environment'
import type { PaveModel } from './evaluation'
import { toThreePoint, toThreeQuat, zUpGroup } from './space'

/** Tone mapping, exposure and shadows to match the Blender view transform. */
export function configureRenderer(renderer: WebGLRenderer, resolved: ResolvedScene): void {
  renderer.toneMapping = resolved.color.view === 'agx' ? AgXToneMapping : NeutralToneMapping
  renderer.toneMappingExposure = 2 ** resolved.color.exposure
  renderer.outputColorSpace = SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = VSMShadowMap
}

/** Display-referred backgrounds bypass tone mapping, as they are composited in Blender. */
function background(bg: Background): Color | DataTexture | null {
  if (bg.kind === 'transparent') return null
  if (bg.kind === 'solid') return new Color().setRGB(...bg.color, SRGBColorSpace)
  const h = 256
  const data = new Uint8Array(h * 4)
  for (let y = 0; y < h; y++) {
    // DataTexture row 0 is the bottom of the screen.
    const t = y / (h - 1)
    for (let c = 0; c < 3; c++)
      data[y * 4 + c] = Math.round((bg.bottom[c]! + (bg.top[c]! - bg.bottom[c]!) * t) * 255)
    data[y * 4 + 3] = 255
  }
  const texture = new DataTexture(data, 1, h)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

const ACRYLIC_SHADER = {
  name: 'PaveAcrylic',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    ior: { value: 1.49 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vec4 world = modelMatrix * vec4( position, 1.0 );
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`,
  // Dielectric mirror: Schlick Fresnel weights the planar reflection over the dark base.
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float ior;
    varying vec4 vUv;
    varying vec3 vWorld;
    void main() {
      vec3 view = normalize( cameraPosition - vWorld );
      float f0 = pow( ( ior - 1.0 ) / ( ior + 1.0 ), 2.0 );
      float f = f0 + ( 1.0 - f0 ) * pow( 1.0 - clamp( view.y, 0.0, 1.0 ), 5.0 );
      vec3 reflection = texture2DProj( tDiffuse, vUv ).rgb;
      gl_FragColor = vec4( color * ( 1.0 - f ) + reflection * f, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

function sweepGeometry(profile: [number, number][], width: number): BufferGeometry {
  const positions: number[] = []
  const index: number[] = []
  profile.forEach(([d, h], i) => {
    positions.push(-width / 2, d, h, width / 2, d, h)
    if (i > 0) index.push(2 * i - 2, 2 * i - 1, 2 * i + 1, 2 * i - 2, 2 * i + 1, 2 * i)
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** A zero-intensity shadow caster: ShadowMaterial shows its shadow without adding light. */
function shadowCaster(
  resolved: ResolvedScene,
  z: number,
): { light: DirectionalLight; plane: Mesh } {
  const { center, radius } = resolved.subject
  // Shadow from the luminance-weighted direction of the rig's upward-facing panels.
  const dir = new Vector3()
  for (const p of resolved.rig.panels) {
    const v = new Vector3(
      p.position[0] - center[0],
      p.position[1] - center[1],
      p.position[2] - center[2],
    )
    const up = Math.max(0, v.z / v.length())
    const weight = (p.radiance[0] + p.radiance[1] + p.radiance[2]) * p.size[0] * p.size[1] * up * up
    dir.addScaledVector(v.normalize(), weight)
  }
  if (dir.lengthSq() === 0) dir.set(0, 0, 1)
  dir.normalize()
  const light = new DirectionalLight(0xffffff, 0)
  light.position.set(...center).addScaledVector(dir, radius * 4)
  light.target.position.set(...center)
  light.castShadow = true
  light.shadow.mapSize.set(1024, 1024)
  // Broad softboxes cast a faint, very soft contact shadow.
  light.shadow.radius = 24
  light.shadow.blurSamples = 24
  const cam = light.shadow.camera
  // The frustum must contain the whole catcher plane, or VSM draws a line at its edge.
  cam.left = cam.bottom = -radius * 3.5
  cam.right = cam.top = radius * 3.5
  cam.near = radius
  cam.far = radius * 8
  const plane = new Mesh(new CircleGeometry(radius * 3, 64), new ShadowMaterial({ opacity: 0.25 }))
  plane.position.set(center[0], center[1], z)
  plane.receiveShadow = true
  return { light, plane }
}

function ground(g: ResolvedGround, resolved: ResolvedScene): Group {
  const group = zUpGroup('pave-ground')
  if (g.kind === 'none') return group
  if (g.kind === 'reflective') {
    const mirror = new Reflector(new PlaneGeometry(g.size, g.size), {
      shader: { ...ACRYLIC_SHADER, uniforms: UniformsUtils.clone(ACRYLIC_SHADER.uniforms) },
      color: new Color().setRGB(...g.color, LinearSRGBColorSpace),
      textureWidth: 1024,
      textureHeight: 1024,
    })
    ;(mirror.material as ShaderMaterial).uniforms.ior!.value = g.ior
    mirror.position.set(resolved.subject.center[0], resolved.subject.center[1], g.z)
    group.add(mirror)
    return group
  }
  if (g.kind === 'sweep') {
    const sweep = new Mesh(
      sweepGeometry(g.profile, g.width),
      new MeshStandardMaterial({
        color: new Color().setRGB(...g.color, LinearSRGBColorSpace),
        roughness: g.roughness,
      }),
    )
    sweep.position.set(...g.center)
    sweep.rotation.z = (g.azimuth * Math.PI) / 180
    sweep.receiveShadow = true
    group.add(sweep)
  }
  const { light, plane } = shadowCaster(resolved, g.z + resolved.subject.radius * 1e-3)
  group.add(light, light.target, plane)
  return group
}

function placeCamera(camera: PerspectiveCamera, c: ResolvedCamera, outputAspect: number): void {
  const { position, quaternion } = cameraPose(c)
  camera.position.copy(toThreePoint(position))
  camera.quaternion.copy(toThreeQuat(quaternion))
  // Show the whole output frame: match its vertical extent, or its width on narrow viewports.
  const [tx, ty] = viewTangents(c.focalLength, outputAspect)
  const tanY = camera.aspect >= outputAspect ? ty : tx / camera.aspect
  camera.fov = (2 * Math.atan(tanY) * 180) / Math.PI
  camera.near = c.near
  camera.far = c.far
  camera.updateProjectionMatrix()
}

export interface StageController {
  /** Poses camera, piece and studio for an animation frame (no-op for stills). */
  setFrame(frame: number): void
  /** Re-fits the camera after the viewport's aspect changes. */
  resize(): void
  /**
   * Moves the camera alone (a viewfinder drag): the studio, ground and lights stay as resolved
   * until the scene is resolved again, as it is when the move is saved.
   */
  setCamera(camera: ResolvedCamera): void
  dispose(): void
}

export interface ApplyOptions {
  model?: PaveModel
  environment?: PaveEnvironment
}

export function applyResolvedScene(
  scene: Scene,
  camera: PerspectiveCamera,
  resolved: ResolvedScene,
  options: ApplyOptions = {},
): StageController {
  const { model, environment } = options
  const aspect = resolved.output.width / resolved.output.height
  const bg = background(resolved.background)
  scene.background = bg
  if (environment) {
    scene.environment = environment.texture
    scene.environmentRotation.set(0, 0, 0)
    model?.setEnvironment(environment)
  }
  const stage: Object3D = ground(resolved.ground, resolved)
  scene.add(stage)

  const tracks = resolved.animation?.tracks ?? {}
  const at = (target: TrackTarget, fallback: number, frame: number) => {
    const keys = tracks[target]
    return keys ? sampleTrack(keys, frame) : fallback
  }
  let current = 0
  let cameraNow = resolved.camera
  const setFrame = (frame: number) => {
    current = frame
    const c = cameraNow
    placeCamera(
      camera,
      {
        ...c,
        azimuth: at('cameraAzimuth', c.azimuth, frame),
        elevation: at('cameraElevation', c.elevation, frame),
        distance: at('cameraDistance', c.distance, frame),
      },
      aspect,
    )
    if (model) model.spin.rotation.z = (at('pieceRotation', 0, frame) * Math.PI) / 180
    if (environment && tracks.rigRotation) {
      const deg = at('rigRotation', resolved.rig.rotation, frame)
      scene.environmentRotation.y = ((deg - environment.rotation) * Math.PI) / 180
      model?.setEnvironment(environment, deg)
    }
  }
  setFrame(0)

  return {
    setFrame,
    resize: () => setFrame(current),
    setCamera: (c) => {
      cameraNow = c
      setFrame(current)
    },
    dispose: () => {
      stage.removeFromParent()
      stage.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose()
        if (o instanceof Reflector || o instanceof DirectionalLight) o.dispose()
        else if (o instanceof Mesh) (o.material as { dispose(): void }).dispose()
      })
      if (bg instanceof DataTexture) bg.dispose()
    },
  }
}
