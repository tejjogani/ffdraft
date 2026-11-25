/**
 * A 3D model kept on a design board as inspiration, shown in a small turntable view. View only:
 * it is not part of any design until someone opens it as CAD. three.js and its loaders load
 * only when a model tile is on screen, so the board itself stays light.
 *
 * Nothing renders while nothing moves: a frame is drawn on load, on resize and while the person
 * drags to turn it. Every GPU resource is released when the tile goes away.
 */
import { cn, Spinner } from '@pave/ui'
import { Box } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '../../lib/assets'
import { extensionOf, MODEL_EXTENSIONS } from './board'

type State = 'loading' | 'ready' | 'unsupported' | 'failed'

export function ModelViewer({
  assetId,
  name,
  className,
}: {
  assetId: string
  name: string
  className?: string
}) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    const el = host.current
    if (!el) return
    let disposed = false
    let cleanup = () => {}
    const abort = new AbortController()
    void (async () => {
      try {
        const res = await fetch(assetUrl(assetId), { signal: abort.signal })
        // The format comes from the stored file's type: a board item's title has no extension.
        const ext = formatOf(res.headers.get('content-type'), name)
        if (!(MODEL_EXTENSIONS as readonly string[]).includes(ext)) {
          if (!disposed) setState('unsupported')
          return
        }
        const THREE = await import('three')
        const bytes = await res.arrayBuffer()
        const object = await parse(THREE, ext, bytes)
        if (disposed) return
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
        const scene = new THREE.Scene()
        scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8172, 2.2))
        const key = new THREE.DirectionalLight(0xffffff, 1.6)
        key.position.set(2, -3, 4)
        scene.add(key)
        // Clay, so a model reads as form whatever its file says about materials.
        const clay = new THREE.MeshStandardMaterial({
          color: 0xc9c2b4,
          roughness: 0.55,
          metalness: 0.1,
        })
        object.traverse((o) => {
          const mesh = o as import('three').Mesh
          if (mesh.isMesh) {
            mesh.material = clay
            mesh.geometry.computeVertexNormals()
          }
        })
        // Centred and sized to fit, Z up as in Pavé.
        const box = new THREE.Box3().setFromObject(object)
        const size = box.getSize(new THREE.Vector3()).length() || 1
        object.position.sub(box.getCenter(new THREE.Vector3()))
        const pivot = new THREE.Group()
        pivot.add(object)
        scene.add(pivot)
        const camera = new THREE.PerspectiveCamera(30, 1, size / 100, size * 10)
        camera.up.set(0, 0, 1)
        camera.position.set(0, -size * 1.9, size * 0.7)
        camera.lookAt(0, 0, 0)
        el.appendChild(renderer.domElement)
        renderer.domElement.className = 'size-full touch-none'
        const draw = () => renderer.render(scene, camera)
        const resize = () => {
          const w = el.clientWidth || 1
          const h = el.clientHeight || 1
          renderer.setSize(w, h, false)
          camera.aspect = w / h
          camera.updateProjectionMatrix()
          draw()
        }
        const observer = new ResizeObserver(resize)
        observer.observe(el)
        pivot.rotation.z = -0.5
        resize()
        let drag: { x: number; z: number } | null = null
        const down = (e: PointerEvent) => {
          drag = { x: e.clientX, z: pivot.rotation.z }
          renderer.domElement.setPointerCapture(e.pointerId)
        }
        const move = (e: PointerEvent) => {
          if (!drag) return
          pivot.rotation.z = drag.z + (e.clientX - drag.x) / 80
          draw()
        }
        const up = () => {
          drag = null
        }
        renderer.domElement.addEventListener('pointerdown', down)
        renderer.domElement.addEventListener('pointermove', move)
        renderer.domElement.addEventListener('pointerup', up)
        renderer.domElement.addEventListener('pointercancel', up)
        setState('ready')
        cleanup = () => {
          observer.disconnect()
          object.traverse((o) => (o as import('three').Mesh).geometry?.dispose())
          clay.dispose()
          renderer.dispose()
          renderer.forceContextLoss()
          renderer.domElement.remove()
        }
      } catch (e) {
        if (!disposed && !abort.signal.aborted) {
          console.error(`Showing ${name} failed:`, e)
          setState('failed')
        }
      }
    })()
    return () => {
      disposed = true
      abort.abort()
      cleanup()
    }
  }, [assetId, name])

  return (
    <div
      ref={host}
      role="img"
      aria-label={`3D model ${name}, view only: drag to turn it`}
      data-model-viewer={state}
      className={cn('stage relative aspect-square w-full overflow-hidden', className)}
    >
      {state !== 'ready' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3 text-center text-xs text-fg-subtle">
          {state === 'loading' ? (
            <Spinner className="size-4" label="Loading the model" />
          ) : (
            <Box className="size-5" aria-hidden />
          )}
          {state === 'unsupported' && 'STEP files can’t be shown or opened yet; that is planned.'}
          {state === 'failed' && 'This model could not be shown.'}
        </div>
      )}
    </div>
  )
}

const MIME_FORMAT: Record<string, string> = {
  'model/stl': 'stl',
  'model/obj': 'obj',
  'model/gltf-binary': 'glb',
  'model/3mf': '3mf',
  'model/ply': 'ply',
  'model/step': 'step',
}

/** The file's format: by its stored type, else by the name's extension. */
const formatOf = (mime: string | null, name: string): string =>
  MIME_FORMAT[(mime ?? '').split(';')[0]!.trim()] ?? extensionOf(name)

type Three = typeof import('three')

/** One loader per format, from three's examples, each loaded only when it is needed. */
async function parse(
  THREE: Three,
  ext: string,
  bytes: ArrayBuffer,
): Promise<import('three').Object3D> {
  const mesh = (geometry: import('three').BufferGeometry) => new THREE.Mesh(geometry)
  switch (ext) {
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
      return mesh(new STLLoader().parse(bytes))
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js')
      return mesh(new PLYLoader().parse(bytes))
    }
    case 'obj': {
      const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js')
      return new OBJLoader().parse(new TextDecoder().decode(bytes))
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js')
      return new ThreeMFLoader().parse(bytes)
    }
    case 'glb': {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
      const gltf = await new GLTFLoader().parseAsync(bytes, '')
      return gltf.scene
    }
    default:
      throw new Error(`No viewer for .${ext}`)
  }
}
