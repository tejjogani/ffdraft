import {
  type Design,
  GEM_CUT_IDS,
  GEM_CUTS,
  GEM_MATERIAL_IDS,
  GEM_MATERIALS,
  type GemCutId,
  type GemMaterialId,
  type ImportedRoleChoice,
  importRoleOf,
  isRhinoRoleBody,
  METAL_IDS,
  METALS,
  type MetalId,
  nodeTitle,
  type Op,
  rhinoRoleCandidates,
  rhinoRoleFrameIssue,
  rhinoRoleLinks,
} from '@pave/schema'
import { Button, Chip, Dialog, Input, Select } from '@pave/ui'
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from '../../../lib/assets'
import { plural } from '../../../lib/format'
import type { ImportedMesh } from '../mesh-edit/model'
import { RecoverRhinoLabels } from '../model-import/RecoverRhinoLabels'
import { isolatedStoneIds, measureRhinoRoleBody } from '../model-import/role-measurements'
import {
  parseRhinoStoneFields,
  type RhinoStoneField,
  type RhinoStoneFields,
  type RhinoStoneMeasurements,
  rhinoStoneFields,
  selectedRhinoPeers,
  uniqueRhinoHeadPairs,
} from './role-review'

const roleLabels = {
  unassigned: 'Unassigned',
  reference: 'Reference',
  metal: 'Metal',
  stone: 'Stone',
  setting: 'Setting',
} as const
const roleOptions = (Object.keys(roleLabels) as (keyof typeof roleLabels)[]).map((value) => ({
  value,
  label: roleLabels[value],
}))
const metalOptions = METAL_IDS.map((value) => ({ value, label: METALS[value].label }))
const cutOptions = GEM_CUT_IDS.map((value) => ({ value, label: GEM_CUTS[value].label }))
const speciesOptions = GEM_MATERIAL_IDS.map((value) => ({
  value,
  label: GEM_MATERIALS[value].label,
}))
const styleOptions = [
  { value: 'prong', label: 'Prong' },
  { value: 'basket', label: 'Basket' },
  { value: 'bezel', label: 'Bezel' },
] as const
type HeadStyle = (typeof styleOptions)[number]['value']

export const rhinoRoleLabel = (body: ImportedMesh) => roleLabels[importRoleOf(body) ?? 'unassigned']
const placementPath = (body: ImportedMesh) =>
  body.source.rhinoContext?.placements.map((placement) => placement.id) ??
  body.source.rhinoInstancePath ??
  []

function sourceHint(body: ImportedMesh, placeNumbers: ReadonlyMap<string, number>) {
  const context = body.source.rhinoContext
  const placements = context?.placements ?? []
  const path = placementPath(body)
  const place = placements.at(-1)
  const material =
    context?.material ??
    (context?.materialFromParent && placements.findLast((item) => item.material)?.material)
  const groupNames = context?.groups.map((group) => group.name).filter(Boolean) ?? []
  return [
    body.source.rhinoLayer,
    path.length > 0 && `Placement ${placeNumbers.get(JSON.stringify(path))}`,
    place?.layer && place.layer !== body.source.rhinoLayer && place.layer,
    material,
    groupNames.length > 0 && `Group ${groupNames.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ')
}

function matchingPlacement(body: ImportedMesh) {
  return {
    id: body.id,
    groups: body.source.rhinoContext?.groups.map((group) => group.id) ?? [],
    placement: placementPath(body),
  }
}

async function readMesh(body: ImportedMesh, signal: AbortSignal) {
  const response = await fetch(assetUrl(body.source.assetId), {
    signal,
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error('The retained mesh could not be read.')
  return response.arrayBuffer()
}

function Label({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  )
}

function StoneFields({
  fields,
  onChange,
}: {
  fields: RhinoStoneFields
  onChange: (field: RhinoStoneField, value: string) => void
}) {
  const fieldId = useId()
  const rows = [
    {
      label: 'Dimensions (mm)',
      fields: [
        ['width', 'Width'],
        ['length', 'Length'],
        ['depth', 'Depth'],
      ],
    },
    {
      label: 'Girdle position (mm)',
      fields: [
        ['x', 'X'],
        ['y', 'Y'],
        ['z', 'Z'],
      ],
    },
    {
      label: 'World rotation (°)',
      fields: [
        ['rx', 'X'],
        ['ry', 'Y'],
        ['rz', 'Z'],
      ],
    },
  ] as const
  return rows.map((row) => (
    <fieldset key={row.label} className="grid min-w-0 grid-cols-3 gap-2">
      <legend className="mb-1.5 text-xs font-medium text-fg-muted">{row.label}</legend>
      {row.fields.map(([field, label]) => (
        <label
          key={field}
          htmlFor={`${fieldId}-${field}`}
          className="grid min-w-0 gap-1 text-xs text-fg-subtle"
        >
          {label}
          <Input
            id={`${fieldId}-${field}`}
            type="number"
            step="any"
            aria-label={`${row.label} ${label}`}
            className="font-mono tabular"
            value={fields[field]}
            onChange={(event) => onChange(field, event.currentTarget.value)}
          />
        </label>
      ))}
    </fieldset>
  ))
}

interface PeerMeasurement {
  id: string
  measurement?: RhinoStoneMeasurements
}

async function measureMatches(
  bodies: ImportedMesh[],
  design: Design,
  cut: GemCutId,
  signal: AbortSignal,
): Promise<PeerMeasurement[]> {
  const results: PeerMeasurement[] = []
  for (let i = 0; i < bodies.length; i += 4) {
    signal.throwIfAborted()
    const batch = await Promise.all(
      bodies.slice(i, i + 4).map(async (body): Promise<PeerMeasurement> => {
        try {
          if (rhinoRoleFrameIssue(body, design)) return { id: body.id }
          const bytes = await readMesh(body, signal)
          return { id: body.id, measurement: measureRhinoRoleBody(bytes, cut) }
        } catch {
          return { id: body.id }
        }
      }),
    )
    results.push(...batch)
  }
  return results
}

const formatted = (values: readonly number[]) =>
  values.map((value) => Number(value.toFixed(3))).join(', ')

export function RhinoRoleReview({
  design,
  initialId,
  onSelect,
  onClose,
  onSave,
  onRecover,
}: {
  design: Design
  initialId?: string
  onSelect: (body: ImportedMesh) => void
  onClose: () => void
  onSave: (choices: ImportedRoleChoice[]) => void
  onRecover: (ops: Op[]) => void
}) {
  const [selectedId, setSelectedId] = useState(initialId)
  const [bodyFilter, setBodyFilter] = useState('')
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const radioName = useId()
  const bodies = useMemo(
    () => design.order.map((id) => design.nodes[id]).filter(isRhinoRoleBody),
    [design],
  )
  const placeNumbers = new Map<string, number>()
  for (const body of bodies) {
    const path = placementPath(body)
    if (!path.length) continue
    const key = JSON.stringify(path)
    if (!placeNumbers.has(key)) placeNumbers.set(key, placeNumbers.size + 1)
  }
  const labelFor = (body: ImportedMesh) => {
    const hint = sourceHint(body, placeNumbers)
    return hint ? `${nodeTitle(body)} · ${hint}` : nodeTitle(body)
  }
  const selected =
    bodies.find((body) => body.id === selectedId) ??
    bodies.find((body) => rhinoRoleLabel(body) === 'Unassigned') ??
    bodies[0]
  const select = (body: ImportedMesh) => {
    setSelectedId(body.id)
    onSelect(body)
  }
  if (!selected) return null
  const search = bodyFilter.trim().toLowerCase()
  const filtered = bodies.filter((body) =>
    `${labelFor(body)} ${rhinoRoleLabel(body)}`.toLowerCase().includes(search),
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      initialFocus={filterRef}
      title="Review Rhino roles"
      description="Classify imported bodies for editing, rendering, and production."
      className="top-[8dvh]! max-h-[calc(92dvh-1rem)]! w-[min(800px,calc(100vw-24px))]"
      footer={<div ref={setFooter} className="flex gap-2" />}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.8fr)]">
        <aside aria-label="Rhino bodies" className="min-w-0 self-start">
          <label
            htmlFor={`${radioName}-filter`}
            className="grid gap-1.5 text-xs font-medium text-fg-muted"
          >
            {plural(bodies.length, 'Rhino body', 'Rhino bodies')}
            <Input
              ref={filterRef}
              id={`${radioName}-filter`}
              type="search"
              aria-label="Filter Rhino bodies"
              placeholder="Filter bodies…"
              value={bodyFilter}
              onChange={(event) => setBodyFilter(event.currentTarget.value)}
            />
          </label>
          <fieldset className="min-w-0">
            <legend className="sr-only">Selected Rhino body</legend>
            <ul className="mt-2 max-h-[19dvh] overflow-y-auto rounded-md border border-line sm:max-h-[54dvh]">
              {filtered.map((body) => (
                <li key={body.id} className="border-b border-line last:border-b-0">
                  <label className="relative block min-w-0 cursor-pointer">
                    <input
                      type="radio"
                      name={radioName}
                      checked={body.id === selected.id}
                      onChange={() => select(body)}
                      className="peer sr-only"
                    />
                    <span className="block min-w-0 px-2.5 py-2 text-xs hover:bg-bg-hover peer-checked:bg-bg-active peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-select">
                      <span className="block truncate font-medium" title={nodeTitle(body)}>
                        {nodeTitle(body)}
                      </span>
                      <span className="mt-1 flex min-w-0 items-center gap-2">
                        <Chip>{rhinoRoleLabel(body)}</Chip>
                        <span
                          className="truncate text-fg-muted"
                          title={sourceHint(body, placeNumbers)}
                        >
                          {sourceHint(body, placeNumbers)}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-2.5 py-2 text-xs text-fg-muted">No matching bodies.</li>
              )}
            </ul>
          </fieldset>
          <div className="mt-2">
            <RecoverRhinoLabels design={design} onRecover={onRecover} />
          </div>
        </aside>
        <ReviewBody
          key={selected.id}
          body={selected}
          design={design}
          bodies={bodies}
          source={sourceHint(selected, placeNumbers)}
          labelFor={labelFor}
          footer={footer}
          onSelect={select}
          onSave={onSave}
          onClose={onClose}
        />
      </div>
    </Dialog>
  )
}

function ReviewBody({
  body,
  design,
  bodies,
  source,
  labelFor,
  footer,
  onSelect,
  onSave,
  onClose,
}: {
  body: ImportedMesh
  design: Design
  bodies: ImportedMesh[]
  source: string
  footer: HTMLDivElement | null
  labelFor: (body: ImportedMesh) => string
  onSelect: (body: ImportedMesh) => void
  onSave: (choices: ImportedRoleChoice[]) => void
  onClose: () => void
}) {
  const links = useMemo(() => rhinoRoleLinks(design, body.id), [design, body.id])
  const currentRole = importRoleOf(body) ?? 'unassigned'
  const currentGem = currentRole === 'stone' ? links.gem : undefined
  const currentSetting = currentRole === 'stone' ? links.setting : undefined
  const [role, setRole] = useState(currentRole)
  const [material, setMaterial] = useState<MetalId | null>(
    currentRole === 'metal' ? body.material : null,
  )
  const initialCut = currentGem?.importSourceFit?.cut ?? currentGem?.cut ?? null
  const [cut, setCut] = useState<GemCutId | null>(initialCut)
  const [species, setSpecies] = useState<GemMaterialId | null>(currentGem?.stone ?? null)
  const initialHead = currentSetting?.importSourceId ?? ''
  const initialHeadMaterial = currentSetting?.material ?? null
  const initialStyle =
    styleOptions.find((option) => option.value === currentSetting?.style)?.value ?? null
  const [headId, setHeadId] = useState(initialHead)
  const [headMaterial, setHeadMaterial] = useState<MetalId | null>(initialHeadMaterial)
  const [style, setStyle] = useState<HeadStyle | null>(initialStyle)
  const [bulk, setBulk] = useState(false)
  const [pair, setPair] = useState(false)
  const [peerOverrides, setPeerOverrides] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [seedOverride, setSeedOverride] = useState<boolean>()
  const [customFields, setCustomFields] = useState<Partial<RhinoStoneFields>>({})
  const [remeasured, setRemeasured] = useState<RhinoStoneMeasurements>()
  const [originalMesh, setOriginalMesh] = useState<ArrayBuffer | null | undefined>(undefined)
  const [batch, setBatch] = useState<{ cut: GemCutId; readings: PeerMeasurement[] } | null>(null)
  const [error, setError] = useState('')
  const frameIssue = rhinoRoleFrameIssue(body, design)
  const sourceFit = currentGem?.importSourceFit
  const lockGem = !!currentGem?.sourcing
  const needsMesh = role === 'stone' && !!cut && !frameIssue

  useEffect(() => {
    if (!needsMesh) return
    const controller = new AbortController()
    void readMesh(body, controller.signal)
      .then((bytes) => {
        if (!controller.signal.aborted) setOriginalMesh(bytes)
      })
      .catch(() => {
        if (!controller.signal.aborted) setOriginalMesh(null)
      })
    return () => controller.abort()
  }, [body, needsMesh])

  const matchingIds = useMemo(
    () => new Set(rhinoRoleCandidates(design, body.id)),
    [design, body.id],
  )
  const peers = useMemo(
    () =>
      bodies.filter(
        (item) =>
          item.id !== body.id &&
          matchingIds.has(item.id) &&
          (importRoleOf(item) ?? 'unassigned') === 'unassigned',
      ),
    [bodies, body.id, matchingIds],
  )
  const includesPeers = bulk && peers.length > 0 && role !== 'unassigned' && role !== 'setting'
  const measurePeers = role === 'stone' && includesPeers
  useEffect(() => {
    if (!measurePeers || !cut) return
    const controller = new AbortController()
    void measureMatches(peers, design, cut, controller.signal)
      .then((readings) => {
        if (!controller.signal.aborted) setBatch({ cut, readings })
      })
      .catch(() => {
        if (!controller.signal.aborted) setBatch(null)
      })
    return () => controller.abort()
  }, [cut, design, measurePeers, peers])
  const readings = batch?.cut === cut ? batch?.readings : undefined

  const suggestion = useMemo(() => {
    if (remeasured) return remeasured
    if (sourceFit)
      return {
        width: sourceFit.width,
        length: sourceFit.length,
        depth: sourceFit.depth,
        girdle: sourceFit.transform?.position ?? ([0, 0, 0] as [number, number, number]),
        rotation: sourceFit.transform?.rotation ?? ([0, 0, 0] as [number, number, number]),
      }
    if (!cut || !originalMesh) return undefined
    try {
      return measureRhinoRoleBody(originalMesh, cut)
    } catch {
      return undefined
    }
  }, [cut, originalMesh, remeasured, sourceFit])
  const fields = { ...rhinoStoneFields(suggestion, 6), ...customFields }
  const measurement = parseRhinoStoneFields({ ...rhinoStoneFields(suggestion), ...customFields })
  const enteredRotation = (['rx', 'ry', 'rz'] as const).map((field) =>
    fields[field].trim() ? Number(fields[field]) : NaN,
  ) as [number, number, number]
  const recalculateFit = () => {
    if (!cut || !originalMesh || !enteredRotation.every(Number.isFinite)) return
    let fit: RhinoStoneMeasurements | undefined
    try {
      fit = measureRhinoRoleBody(originalMesh, cut, enteredRotation)
    } catch {
      // An unavailable mesh leaves the form editable.
    }
    if (!fit) {
      setError(
        'These angles could not be used to measure the retained mesh. Enter the fit manually.',
      )
      return
    }
    setRemeasured(fit)
    setCustomFields({})
    setError('')
  }

  const peerMeasurements = new Map(readings?.map(({ id, measurement }) => [id, measurement]))
  const measuredPoints = (readings ?? []).flatMap(({ id, measurement }) =>
    measurement ? [{ id, girdle: measurement.girdle }] : [],
  )
  const isolated = isolatedStoneIds(
    measurement ? [...measuredPoints, { id: body.id, girdle: measurement.girdle }] : measuredPoints,
  )
  const chosenPeers = new Set(
    selectedRhinoPeers(
      includesPeers
        ? peers.filter((peer) => !readings || peerMeasurements.get(peer.id)).map((peer) => peer.id)
        : [],
      isolated,
      peerOverrides,
    ),
  )
  const seedIsIsolated = includesPeers && isolated.has(body.id)
  const includeSeed = !seedIsIsolated || (seedOverride ?? false)
  const appliedCount = chosenPeers.size + Number(includeSeed)
  const availableHeads = useMemo(
    () =>
      bodies.filter((item) => {
        if (item.id === body.id || rhinoRoleFrameIssue(item, design)) return false
        const role = importRoleOf(item)
        return (
          (item.id === initialHead && currentRole === 'stone') ||
          (role !== 'stone' && role !== 'setting')
        )
      }),
    [bodies, body.id, currentRole, design, initialHead],
  )
  const headOptions = [
    { value: '', label: 'No setting body' },
    ...availableHeads.map((item) => ({ value: item.id, label: labelFor(item) })),
  ]
  const editHead =
    headId !== initialHead || headMaterial !== initialHeadMaterial || style !== initialStyle
  const pairEnabled = role === 'stone' && includesPeers && !!headId
  const headRequired = !!headId && ((includeSeed && editHead) || (pairEnabled && pair))
  const paired = useMemo(() => {
    if (!pairEnabled || !pair) return new Map<string, string>()
    const headMatches = new Set(rhinoRoleCandidates(design, headId))
    const heads = availableHeads.filter(
      (item) => headMatches.has(item.id) && item.id !== headId && !matchingIds.has(item.id),
    )
    return uniqueRhinoHeadPairs(peers.map(matchingPlacement), heads.map(matchingPlacement))
  }, [availableHeads, design, headId, matchingIds, pair, pairEnabled, peers])

  const message =
    (lockGem && 'This stone has a fitted diamond. Its role and source fit are locked.') ||
    (role === 'stone' && frameIssue) ||
    (role === 'stone' &&
      !!cut &&
      needsMesh &&
      !suggestion &&
      (originalMesh === undefined
        ? 'Measuring the retained Rhino mesh…'
        : 'Pavé could not suggest a fit from the mesh. Enter the measurements to confirm this stone.')) ||
    (measurePeers && !!cut && !readings && 'Measuring matching bodies…') ||
    ''
  const canSave =
    !lockGem &&
    (role === 'metal'
      ? !!material
      : role === 'stone'
        ? !!(
            appliedCount &&
            cut &&
            species &&
            measurement &&
            !frameIssue &&
            (!headRequired || (headMaterial && style)) &&
            (!includesPeers || !!readings)
          )
        : role !== 'setting' && (role !== currentRole || includesPeers))

  const save = () => {
    if (!canSave || role === 'setting') return
    try {
      if (role === 'stone') {
        if (!cut || !species || !measurement) return
        const makeHead = (id: string) =>
          headMaterial && style ? { sourceId: id, material: headMaterial, style } : undefined
        const selectedHead = editHead ? (headId ? makeHead(headId) : null) : undefined
        const choices: ImportedRoleChoice[] = []
        if (includeSeed)
          choices.push({
            sourceId: body.id,
            role,
            stone: { ...measurement, cut, species },
            ...(selectedHead !== undefined && { head: selectedHead }),
          })
        if (includesPeers && readings) {
          for (const reading of readings) {
            if (!chosenPeers.has(reading.id)) continue
            const peerHeadId = paired.get(reading.id)
            const head = peerHeadId ? makeHead(peerHeadId) : undefined
            if (!reading.measurement)
              throw new Error('Review each stone without a measured fit individually.')
            choices.push({
              sourceId: reading.id,
              role,
              stone: { ...reading.measurement, cut, species },
              ...(head && { head }),
            })
          }
        }
        onSave(choices)
      } else {
        onSave(
          [body, ...peers.filter((peer) => chosenPeers.has(peer.id))].map((item) => ({
            sourceId: item.id,
            role,
            ...(role === 'metal' && material && { material }),
          })),
        )
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const pairedCount = [...paired.keys()].filter((id) => chosenPeers.has(id)).length
  const linkedStone =
    currentRole === 'setting' && bodies.find((item) => item.id === links.gem?.importSourceId)
  return (
    <>
      {footer &&
        createPortal(
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>
              {includesPeers ? `Confirm ${plural(appliedCount, 'body', 'bodies')}` : 'Confirm role'}
            </Button>
          </>,
          footer,
        )}
      <section
        aria-label="Role details"
        className="grid min-w-0 content-start gap-3 border-t border-line pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4"
      >
        <div className="grid gap-1">
          <h3 className="break-words text-sm font-medium">{nodeTitle(body)}</h3>
          {source && <p className="break-words text-xs text-fg-muted">{source}</p>}
          {seedIsIsolated && (
            <label className="flex items-start gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                className="mt-px size-4 shrink-0 accent-current"
                checked={includeSeed}
                onChange={(event) => setSeedOverride(event.currentTarget.checked)}
              />
              Include {nodeTitle(body)} (away from the other stones)
            </label>
          )}
        </div>
        <Label label="Role">
          <Select
            aria-label="Role"
            value={role}
            onChange={(value) => {
              setRole(value)
              setError('')
              setBatch(null)
            }}
            options={roleOptions.filter(
              (option) => option.value !== 'setting' || currentRole === 'setting',
            )}
            disabled={lockGem}
          />
        </Label>
        {role === 'setting' && linkedStone && (
          <div className="grid justify-items-start gap-2 text-xs text-fg-muted">
            <p>This setting is linked to {nodeTitle(linkedStone)}.</p>
            <Button size="sm" onClick={() => onSelect(linkedStone)}>
              Review linked stone
            </Button>
          </div>
        )}
        {role === 'metal' && (
          <Label label="Alloy">
            <Select
              aria-label="Alloy"
              value={material}
              onChange={setMaterial}
              options={metalOptions}
            />
          </Label>
        )}
        {role === 'stone' && !frameIssue && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Label label="Gem species">
                <Select
                  aria-label="Gem species"
                  value={species}
                  onChange={setSpecies}
                  options={speciesOptions}
                  disabled={lockGem}
                />
              </Label>
              <Label label="Cut">
                <Select
                  aria-label="Cut"
                  value={cut}
                  onChange={(value) => {
                    setCut(value)
                    setRemeasured(undefined)
                    setBatch(null)
                  }}
                  options={cutOptions}
                  disabled={lockGem}
                />
              </Label>
            </div>
            {!lockGem && (
              <>
                {suggestion && !sourceFit && (
                  <p className="text-xs text-fg-muted">
                    Verify these estimates from the retained mesh before confirming.
                  </p>
                )}
                <StoneFields
                  fields={fields}
                  onChange={(field, value) =>
                    setCustomFields((previous) => ({ ...previous, [field]: value }))
                  }
                />
                <div>
                  <Button
                    size="sm"
                    disabled={!cut || !originalMesh || !enteredRotation.every(Number.isFinite)}
                    onClick={recalculateFit}
                  >
                    Recalculate fit at these angles
                  </Button>
                </div>
                <Label label="Setting body">
                  <Select
                    aria-label="Setting body"
                    value={headId}
                    options={headOptions}
                    onChange={(id) => {
                      setHeadId(id)
                      setPair(false)
                      setHeadMaterial(id === initialHead ? initialHeadMaterial : null)
                      setStyle(id === initialHead ? initialStyle : null)
                    }}
                  />
                </Label>
                {headId && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Label label="Setting alloy">
                        <Select
                          aria-label="Setting alloy"
                          value={headMaterial}
                          onChange={setHeadMaterial}
                          options={metalOptions}
                        />
                      </Label>
                      <Label label="Rebuild style">
                        <Select
                          aria-label="Rebuild style"
                          value={style}
                          onChange={setStyle}
                          options={[...styleOptions]}
                        />
                      </Label>
                    </div>
                    <p className="text-xs text-fg-muted">
                      The imported setting is kept until the stone changes size or cut. Then Pavé
                      rebuilds it in the selected style.
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
        {!lockGem && role !== 'unassigned' && role !== 'setting' && peers.length > 0 && (
          <div className="grid gap-2 border-t border-line pt-3">
            <label className="flex items-start gap-2 text-xs text-fg">
              <input
                type="checkbox"
                className="mt-px size-4 shrink-0 accent-current"
                checked={bulk}
                onChange={(event) => {
                  setBulk(event.currentTarget.checked)
                  setSeedOverride(undefined)
                  setPair(false)
                  setBatch(null)
                }}
              />
              Apply to {plural(peers.length, 'unassigned match', 'unassigned matches')}
            </label>
            {pairEnabled && (
              <label className="flex items-start gap-2 text-xs text-fg">
                <input
                  type="checkbox"
                  className="mt-px size-4 shrink-0 accent-current"
                  checked={pair}
                  onChange={(event) => setPair(event.currentTarget.checked)}
                />
                Also link unique matching settings in the same Rhino group and compatible placement
              </label>
            )}
            {pairEnabled && pair && (
              <p className="text-xs text-fg-muted">
                {plural(pairedCount, 'match', 'matches')} with a unique setting.
                {pairedCount < chosenPeers.size &&
                  ' The other selected stones will be confirmed without a setting.'}
              </p>
            )}
            {includesPeers && (
              <details open className="text-xs text-fg-muted">
                <summary className="cursor-pointer">
                  Review matching bodies
                  {role === 'stone' && readings ? ' and their measured fits' : ''}
                  {' · '}
                  {chosenPeers.size} selected
                </summary>
                <ul className="mt-1.5 grid max-h-52 gap-2 overflow-y-auto rounded-md border border-line p-2">
                  {peers.map((peer) => {
                    const reading = peerMeasurements.get(peer.id)
                    const peerHead = chosenPeers.has(peer.id) ? paired.get(peer.id) : undefined
                    return (
                      <li key={peer.id} className="grid gap-0.5">
                        <label className="flex items-start gap-2 text-fg">
                          <input
                            type="checkbox"
                            className="mt-px size-4 shrink-0 accent-current"
                            checked={chosenPeers.has(peer.id)}
                            disabled={role === 'stone' && !reading}
                            onChange={(event) => {
                              const checked = event.currentTarget.checked
                              setPeerOverrides((prior) => new Map(prior).set(peer.id, checked))
                            }}
                          />
                          <span>{labelFor(peer)}</span>
                        </label>
                        {isolated.has(peer.id) && (
                          <span className="pl-6">Away from the other stones</span>
                        )}
                        {readings && !reading && (
                          <span className="pl-6">Needs individual measurements</span>
                        )}
                        {reading && (
                          <span className="pl-6 font-mono">
                            {formatted([reading.width, reading.length, reading.depth])} mm · Girdle{' '}
                            {formatted(reading.girdle)} mm · Rotation {formatted(reading.rotation)}°
                          </span>
                        )}
                        {peerHead && (
                          <span className="pl-6">
                            Setting · {labelFor(design.nodes[peerHead] as ImportedMesh)}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="text-xs text-fg-muted">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </section>
    </>
  )
}
