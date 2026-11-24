/**
 * Viewport-only materials: the clay and technical display modes, x-ray, ghosts of last-good
 * geometry, and the screen-space outline used for silhouettes and selection. Photographic
 * materials come from @pave/render/three; these never leave the CAD viewport.
 */
import {
  BackSide,
  CanvasTexture,
  Color,
  type ColorRepresentation,
  DoubleSide,
  LineBasicMaterial,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  Vector2,
} from 'three'

/**
 * Draws back faces pushed out along their normals by a constant number of pixels, so the part
 * peeking out around the front faces reads as an outline of even width at any zoom. Works on
 * instanced meshes (three adds `instanceMatrix` for them).
 */
export class OutlineMaterial extends ShaderMaterial {
  constructor(color: ColorRepresentation, px: number, opacity = 1) {
    super({
      uniforms: {
        color: { value: new Color(color) },
        opacity: { value: opacity },
        px: { value: px },
        resolution: { value: new Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        uniform float px;
        uniform vec2 resolution;
        void main() {
          mat4 m = modelMatrix;
          #ifdef USE_INSTANCING
            m = modelMatrix * instanceMatrix;
          #endif
          vec4 clip = projectionMatrix * viewMatrix * m * vec4( position, 1.0 );
          vec3 n = mat3( viewMatrix ) * mat3( m ) * normal;
          vec2 dir = ( projectionMatrix * vec4( n, 0.0 ) ).xy;
          float len = length( dir );
          if ( len > 1e-6 ) clip.xy += dir / len * px * 2.0 / resolution * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        uniform float opacity;
        void main() {
          gl_FragColor = vec4( color, opacity );
          #include <colorspace_fragment>
        }`,
      side: BackSide,
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
      toneMapped: false,
    })
    this.name = 'Outline'
  }

  setColor(color: ColorRepresentation, opacity = 1): void {
    ;(this.uniforms.color!.value as Color).set(color)
    this.uniforms.opacity!.value = opacity
    this.transparent = opacity < 1
    this.depthWrite = opacity >= 1
  }

  setResolution(width: number, height: number): void {
    ;(this.uniforms.resolution!.value as Vector2).set(width, height)
  }
}

/** The palette a display mode is drawn in, read from the design tokens for the current theme. */
export interface ViewportPalette {
  ink: string
  select: string
  clayMetal: string
  clayStone: string
  paper: string
  danger: string
}

export function readPalette(el: Element): ViewportPalette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const dark = document.documentElement.dataset.theme === 'dark'
  return {
    ink: v('--fg', '#1c1b1a'),
    select: v('--select', '#2b6ce6'),
    danger: v('--danger', '#cf4436'),
    clayMetal: dark ? '#b9b4ab' : '#d9d4cb',
    clayStone: dark ? '#c9d0db' : '#dfe5ee',
    paper: dark ? '#2a2a28' : '#fbfaf8',
  }
}

export interface ModeMaterials {
  clayMetal: MeshStandardMaterial
  clayStone: MeshStandardMaterial
  paper: MeshBasicMaterial
  xray: MeshBasicMaterial
  ghost: MeshBasicMaterial
  silhouette: OutlineMaterial
  selected: OutlineMaterial
  hovered: OutlineMaterial
  tint: MeshBasicMaterial
  /** Crease edges in technical mode. */
  edges: LineBasicMaterial
  dispose(): void
}

export function createModeMaterials(p: ViewportPalette): ModeMaterials {
  const clayMetal = new MeshStandardMaterial({ color: p.clayMetal, roughness: 0.62, metalness: 0 })
  const clayStone = new MeshStandardMaterial({
    color: p.clayStone,
    roughness: 0.35,
    metalness: 0.15,
    flatShading: true,
  })
  // Technical faces sit slightly behind their edges so lines are never z-fought.
  const paper = new MeshBasicMaterial({
    color: p.paper,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
  const xray = new MeshBasicMaterial({
    color: p.ink,
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: DoubleSide,
  })
  const ghost = new MeshBasicMaterial({
    color: p.danger,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  })
  const tint = new MeshBasicMaterial({
    color: p.select,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const edges = new LineBasicMaterial({ color: p.ink })
  const all: Material[] = [edges]
  const silhouette = new OutlineMaterial(p.ink, 0.9)
  const selected = new OutlineMaterial(p.select, 1.6)
  const hovered = new OutlineMaterial(p.select, 1.2, 0.45)
  all.push(clayMetal, clayStone, paper, xray, ghost, tint, silhouette, selected, hovered)
  return {
    clayMetal,
    clayStone,
    paper,
    xray,
    ghost,
    silhouette,
    selected,
    hovered,
    tint,
    edges,
    dispose: () => {
      for (const m of all) m.dispose()
    },
  }
}

/** A soft radial contact shadow, drawn once into a small texture. */
export function contactShadowTexture(): CanvasTexture {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0,0,0,0.55)')
  g.addColorStop(0.45, 'rgba(0,0,0,0.22)')
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return new CanvasTexture(canvas)
}
