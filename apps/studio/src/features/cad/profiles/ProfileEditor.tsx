import {
  DrawnProfile,
  PROFILE_POINT_LIMIT,
  type ProfilePlane,
  type ProfilePoint,
} from '@pave/schema'
import { Button, Dialog, IconButton, Input, Segmented } from '@pave/ui'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { ProfileCanvas } from './ProfileCanvas'

type Mode = DrawnProfile['mode']
type TextPoint = [string, string]
type Rectangle = { u: string; v: string; width: string; height: string }

function pointOf([u, v]: TextPoint): ProfilePoint | null {
  if (!u.trim() || !v.trim()) return null
  const a = Number(u)
  const b = Number(v)
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null
}

const asText = ([u, v]: ProfilePoint): TextPoint => [String(u), String(v)]
const round = (value: number) => Number(value.toFixed(4))

function rectangleOf(points: readonly ProfilePoint[]): Rectangle {
  const u = points.map(([value]) => value)
  const v = points.map(([, value]) => value)
  return {
    u: String(Math.min(...u)),
    v: String(Math.min(...v)),
    width: String(round(Math.max(...u) - Math.min(...u))),
    height: String(round(Math.max(...v) - Math.min(...v))),
  }
}

const initialRectangle: Rectangle = { u: '-6', v: '-4', width: '12', height: '8' }

function cornersOf(rectangle: Rectangle): ProfilePoint[] {
  if (Object.values(rectangle).some((value) => !value.trim() || !Number.isFinite(Number(value))))
    return []
  const { u, v, width, height } = rectangle
  const x = Number(u)
  const y = Number(v)
  if (Number(width) <= 0 || Number(height) <= 0) return []
  const right = round(x + Number(width))
  const top = round(y + Number(height))
  return [
    [x, y],
    [right, y],
    [right, top],
    [x, top],
  ]
}

const measure = (value: string) => ({ type: 'number', step: 'any', value }) as const

export function ProfileEditor({
  original,
  initialDepth,
  onClose,
  onSave,
}: {
  original?: DrawnProfile
  initialDepth?: number
  onClose(): void
  onSave(source: DrawnProfile, depth: number): void
}) {
  const fieldId = useId()
  const [plane, setPlane] = useState<ProfilePlane>(original?.plane ?? 'front')
  const [mode, setMode] = useState<Mode>(original?.mode ?? 'polyline')
  const [points, setPoints] = useState<TextPoint[]>(original?.points.map(asText) ?? [])
  const [rectangle, setRectangle] = useState<Rectangle>(
    original?.mode === 'rectangle' ? rectangleOf(original.points) : initialRectangle,
  )
  const [corner, setCorner] = useState<ProfilePoint | null>(null)
  const [depth, setDepth] = useState(String(initialDepth ?? 2))
  const [error, setError] = useState('')
  const [u, setU] = useState('')
  const [v, setV] = useState('')
  const face =
    mode === 'rectangle'
      ? cornersOf(rectangle)
      : points.flatMap((point) => {
          const parsed = pointOf(point)
          return parsed ? [parsed] : []
        })
  const addPoint = (point: ProfilePoint) => {
    if (mode === 'rectangle') {
      if (corner) {
        setRectangle(rectangleOf([corner, point]))
        setCorner(null)
      } else setCorner(point)
      return
    }
    if (points.length < PROFILE_POINT_LIMIT) setPoints([...points, asText(point)])
  }
  const changeMode = (next: Mode) => {
    if (next === 'rectangle' && face.length > 1) setRectangle(rectangleOf(face))
    if (next === 'polyline' && face.length) setPoints(face.map(asText))
    setCorner(null)
    setMode(next)
    setError('')
  }
  const save = () => {
    const parsed = DrawnProfile.safeParse({ type: 'profile', mode, plane, points: face })
    const thickness = Number(depth)
    if (mode === 'polyline' && face.length !== points.length) {
      setError('Fill in both coordinates of each point.')
    } else if (mode === 'rectangle' && corner) {
      setError('Pick the opposite corner to finish the rectangle.')
    } else if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Finish drawing the profile.')
    } else if (!depth.trim() || !Number.isFinite(thickness) || thickness < 0.6 || thickness > 20) {
      setError('Enter an extrusion depth from 0.6 to 20 mm.')
    } else {
      try {
        onSave(parsed.data, thickness)
        onClose()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Couldn’t save the profile.')
      }
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={original ? 'Edit profile' : 'Draw a profile'}
      description="Draw a closed outline in millimetres and extrude it into a solid."
      className="w-[min(720px,calc(100vw-32px))]!"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            {original ? 'Save profile' : 'Extrude profile'}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          aria-label="Profile tool"
          value={mode}
          onChange={changeMode}
          options={[
            { value: 'polyline', label: 'Polyline' },
            { value: 'rectangle', label: 'Rectangle' },
          ]}
        />
        <Segmented
          aria-label="Drawing plane"
          value={plane}
          onChange={setPlane}
          options={[
            { value: 'front', label: 'Front' },
            { value: 'top', label: 'Top' },
            { value: 'right', label: 'Right' },
          ]}
        />
      </div>
      <ProfileCanvas
        points={mode === 'rectangle' && corner ? [] : face}
        plane={plane}
        corner={corner}
        onPoint={addPoint}
      />
      <p className="mt-2 text-xs text-fg-muted">
        {mode === 'rectangle'
          ? corner
            ? 'Pick the opposite corner.'
            : 'Pick two corners or type the measurements.'
          : 'Click to add points or type their coordinates. Extruding closes the outline.'}
      </p>

      {mode === 'rectangle' ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['width', 'Width (mm)'],
              ['height', 'Height (mm)'],
              ['u', 'Horizontal origin (mm)'],
              ['v', 'Vertical origin (mm)'],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              htmlFor={`${fieldId}-${key}`}
              className="flex min-w-0 flex-col gap-1 text-xs"
            >
              {label}
              <Input
                {...measure(rectangle[key])}
                id={`${fieldId}-${key}`}
                onChange={(event) => {
                  setCorner(null)
                  setRectangle({ ...rectangle, [key]: event.target.value })
                }}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className="mt-3">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              const point = pointOf([u, v])
              if (point) {
                addPoint(point)
                setU('')
                setV('')
              }
            }}
          >
            <label htmlFor={`${fieldId}-u`} className="flex flex-1 flex-col gap-1 text-xs">
              Horizontal (mm)
              <Input
                {...measure(u)}
                id={`${fieldId}-u`}
                onChange={(event) => setU(event.target.value)}
              />
            </label>
            <label htmlFor={`${fieldId}-v`} className="flex flex-1 flex-col gap-1 text-xs">
              Vertical (mm)
              <Input
                {...measure(v)}
                id={`${fieldId}-v`}
                onChange={(event) => setV(event.target.value)}
              />
            </label>
            <Button
              icon={Plus}
              type="submit"
              disabled={!pointOf([u, v]) || points.length >= PROFILE_POINT_LIMIT}
            >
              Add point
            </Button>
          </form>
          {points.length > 0 && (
            <ol
              aria-label="Profile points"
              className="mt-2 flex max-h-28 flex-col gap-1 overflow-y-auto"
            >
              {points.map((value, index) => (
                <li key={index} className="grid grid-cols-[3.5rem_1fr_1fr_auto] items-center gap-2">
                  <span className="text-xs text-fg-muted">Point {index + 1}</span>
                  {(['horizontal', 'vertical'] as const).map((axis, at) => (
                    <Input
                      key={axis}
                      {...measure(value[at]!)}
                      aria-label={`Point ${index + 1} ${axis} (mm)`}
                      onChange={(event) => {
                        const next: TextPoint = [...value]
                        next[at] = event.target.value
                        setPoints(points.map((p, i) => (i === index ? next : p)))
                      }}
                    />
                  ))}
                  <IconButton
                    icon={Trash2}
                    label={`Remove point ${index + 1}`}
                    onClick={() => setPoints(points.filter((_, at) => at !== index))}
                  />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      <label htmlFor={`${fieldId}-depth`} className="mt-3 flex max-w-48 flex-col gap-1 text-xs">
        Extrusion depth (mm)
        <Input
          {...measure(depth)}
          id={`${fieldId}-depth`}
          onChange={(event) => setDepth(event.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Dialog>
  )
}
