import { ok } from 'node:assert/strict'
import type { Curve, File3dm, GeometryBase, NurbsCurve, RhinoModule, UnitSystem } from 'rhino3dm'
import type { Vec3 } from '../geometry/vec'
import { freeRhino } from '../runtime/rhino'

type Hold = <T extends object | null>(handle: T) => T
const nullId = '00000000-0000-0000-0000-000000000000'

export function handles<T>(work: (hold: Hold) => T): T {
  const owned: object[] = []
  try {
    return work((handle) => {
      if (handle) owned.push(handle)
      return handle
    })
  } finally {
    for (const handle of owned.reverse()) freeRhino(handle)
  }
}

export function archive<T>(
  rhino: RhinoModule,
  bytes: Uint8Array,
  read: (doc: File3dm, hold: Hold) => T,
): T {
  return handles((hold) => {
    const doc = hold(rhino.File3dm.fromByteArray(bytes))
    ok(doc, 'OpenNURBS could not open the archive.')
    return read(doc, hold)
  })
}

export function counts<T extends string>(items: Iterable<T>) {
  const tally = new Map<T, number>()
  for (const item of items) tally.set(item, (tally.get(item) ?? 0) + 1)
  return Object.fromEntries(tally)
}

const modelUnits = (rhino: RhinoModule) =>
  new Map<UnitSystem, [number, string]>([
    [rhino.UnitSystem.Angstroms, [1e-7, 'angstroms']],
    [rhino.UnitSystem.Nanometers, [1e-6, 'nanometres']],
    [rhino.UnitSystem.Microns, [1e-3, 'microns']],
    [rhino.UnitSystem.Millimeters, [1, 'millimetres']],
    [rhino.UnitSystem.Centimeters, [10, 'centimetres']],
    [rhino.UnitSystem.Decimeters, [100, 'decimetres']],
    [rhino.UnitSystem.Meters, [1000, 'metres']],
    [rhino.UnitSystem.Dekameters, [1e4, 'dekametres']],
    [rhino.UnitSystem.Hectometers, [1e5, 'hectometres']],
    [rhino.UnitSystem.Kilometers, [1e6, 'kilometres']],
    [rhino.UnitSystem.Megameters, [1e9, 'megametres']],
    [rhino.UnitSystem.Gigameters, [1e12, 'gigametres']],
    [rhino.UnitSystem.Microinches, [25.4e-6, 'microinches']],
    [rhino.UnitSystem.Mils, [0.0254, 'mils']],
    [rhino.UnitSystem.Inches, [25.4, 'inches']],
    [rhino.UnitSystem.Feet, [304.8, 'feet']],
    [rhino.UnitSystem.Yards, [914.4, 'yards']],
    [rhino.UnitSystem.Miles, [1609344, 'miles']],
    [rhino.UnitSystem.PrinterPoints, [25.4 / 72, 'printer points']],
    [rhino.UnitSystem.PrinterPicas, [25.4 / 6, 'printer picas']],
    [rhino.UnitSystem.NauticalMiles, [1852e3, 'nautical miles']],
    [rhino.UnitSystem.AstronomicalUnits, [1.4959787e14, 'astronomical units']],
    [rhino.UnitSystem.LightYears, [9.4607304725808e18, 'light years']],
    [rhino.UnitSystem.Parsecs, [3.08567758e19, 'parsecs']],
  ])

export function readCurve(curve: NurbsCurve, scale = 1) {
  return handles((hold) => {
    const points = hold(curve.points())
    const domain = curve.domain as [number, number]
    return {
      degree: curve.degree,
      domain,
      knots: hold(curve.knots()).toList(),
      points: Array.from({ length: points.count }, (_, i) => {
        const [wx, wy, wz, w] = points.get(i) as [number, number, number, number]
        const weight = curve.isRational ? w : 1
        return [(wx / weight) * scale, (wy / weight) * scale, (wz / weight) * scale, weight]
      }),
      samples: [0, 0.25, 0.5, 0.75, 1].map((t) =>
        curve.pointAt(domain[0] + (domain[1] - domain[0]) * t).map((xyz) => xyz * scale),
      ),
    }
  })
}

interface DesignContextRow {
  named: boolean
  groups: number[]
  curve: 'open' | 'closed' | undefined
  bodyOrInstance: boolean
  materialIndex: number | undefined
  layerId: string | undefined
  definition: string | undefined
}

function designContext(
  doc: File3dm,
  hold: Hold,
  rows: DesignContextRow[],
  definitions: ReadonlyMap<string, string[]>,
) {
  const materialTable = hold(doc.materials())
  const groupTable = hold(doc.groups())
  const groups = new Map<number, { curve: boolean; bodyOrInstance: boolean }>()
  const placements = new Map<
    string,
    { count: number; layers: Set<string>; materials: Set<string> }
  >()
  const materialNames = new Map<number, string>()
  const materialName = (index: number | undefined) => {
    if (index === undefined || index < 0) return ''
    let name = materialNames.get(index)
    if (name === undefined) {
      name = handles((take) => take(materialTable.findIndex(index))?.name?.trim() ?? '')
      materialNames.set(index, name)
    }
    return name
  }

  const report = {
    visibleModelSpaceTopLevelObjects: rows.length,
    namedObjects: 0,
    referencedGroups: 0,
    groupsWithCurvesAndBodiesOrInstances: 0,
    materialTableRecords: materialTable.count,
    objectsWithNamedMaterial: 0,
    repeatedDefinitionsOnMultipleLayers: 0,
    repeatedDefinitionsWithMultipleNamedMaterials: 0,
    openCurves: 0,
    closedCurves: 0,
  }
  for (const row of rows) {
    if (row.named) report.namedObjects++
    if (row.curve === 'open') report.openCurves++
    if (row.curve === 'closed') report.closedCurves++
    for (const index of row.groups) {
      const group = groups.get(index) ?? { curve: false, bodyOrInstance: false }
      group.curve ||= Boolean(row.curve)
      group.bodyOrInstance ||= row.bodyOrInstance
      groups.set(index, group)
    }

    const material = materialName(row.materialIndex)
    if (material) report.objectsWithNamedMaterial++
    if (row.definition && definitions.has(row.definition)) {
      const placement = placements.get(row.definition) ?? {
        count: 0,
        layers: new Set<string>(),
        materials: new Set<string>(),
      }
      placement.count++
      if (row.layerId) placement.layers.add(row.layerId)
      if (material) placement.materials.add(material)
      placements.set(row.definition, placement)
    }
  }
  for (const [index, group] of groups) {
    if (!handles((take) => Boolean(take(groupTable.findIndex(index))))) continue
    report.referencedGroups++
    if (group.curve && group.bodyOrInstance) report.groupsWithCurvesAndBodiesOrInstances++
  }
  for (const { count, layers, materials } of placements.values()) {
    if (count < 2) continue
    if (layers.size > 1) report.repeatedDefinitionsOnMultipleLayers++
    if (materials.size > 1) report.repeatedDefinitionsWithMultipleNamedMaterials++
  }
  return report
}

export function sourceArchive(rhino: RhinoModule, doc: File3dm, hold: Hold) {
  const objects = hold(doc.objects())
  const layers = hold(doc.layers())
  const definitions = hold(doc.instanceDefinitions())
  const units = hold(doc.settings()).modelUnitSystem
  const unit = modelUnits(rhino).get(units)
  const layerRows = Array.from({ length: layers.count }, (_, i) =>
    handles((take) => {
      const layer = take(layers.get(i))
      return { id: layer.id, parent: layer.parentLayerId, visible: layer.visible }
    }),
  )
  const layersById = new Map(layerRows.map((layer) => [layer.id, layer]))
  const hiddenLayer = (id: string, parents = new Set<string>()): boolean => {
    const layer = layersById.get(id)
    if (!layer || id === nullId) return false
    if (!layer.visible || parents.has(id)) return true
    parents.add(id)
    return hiddenLayer(layer.parent, parents)
  }
  const layerVisibility = new Map(layerRows.map(({ id }) => [id, !hiddenLayer(id)]))
  const rows = Array.from({ length: objects.count }, (_, i) =>
    handles((take) => {
      const object = take(objects.get(i))
      const props = take(object.attributes())
      const geometry = take(object.geometry())
      const layer = take(layers.findIndex(props.layerIndex))
      const reference = geometry instanceof rhino.InstanceReference ? geometry : null
      const transform = reference && take(reference.xform)
      const determinant = transform?.determinant() ?? 0
      const placed = transform?.isAffine && Number.isFinite(determinant) && determinant !== 0
      const member = props.isInstanceDefinitionObject
      const hidden =
        props.mode === rhino.ObjectMode.Hidden || layerVisibility.get(layer?.id) === false
      const curve = geometry instanceof rhino.Curve
      const definition = reference?.parentIdefId
      let context: DesignContextRow | undefined
      if (!member && !hidden && props.activeSpace === rhino.ActiveSpace.ModelSpace) {
        const source = props.materialSource
        let materialIndex: number | undefined
        if (source === rhino.ObjectMaterialSource.MaterialFromObject) {
          materialIndex = props.materialIndex
        } else if (source === rhino.ObjectMaterialSource.MaterialFromLayer) {
          materialIndex = layer?.renderMaterialIndex
        }
        context = {
          named: Boolean(props.name?.trim()),
          groups: props.getGroupList() ?? [],
          curve: curve ? (geometry.isClosed ? 'closed' : 'open') : undefined,
          bodyOrInstance:
            Boolean(reference) ||
            geometry instanceof rhino.Brep ||
            geometry instanceof rhino.Extrusion ||
            geometry instanceof rhino.Mesh ||
            geometry instanceof rhino.Surface ||
            geometry instanceof rhino.SubD,
          materialIndex,
          layerId: layer?.id,
          definition,
        }
      }
      return {
        id: props.id,
        type: geometry?.constructor.name ?? 'Unreadable',
        member,
        hidden,
        paper: props.activeSpace === rhino.ActiveSpace.PageSpace,
        definition,
        placed,
        curve,
        provenanceId: props.getUserString('paveSourceObjectId') || props.id,
        context,
      }
    }),
  )
  const all = new Map(rows.map((row) => [row.id, row]))
  const root = rows.filter((row) => !row.member)
  const members = new Map(
    Array.from({ length: definitions.count }, (_, i) =>
      handles((take) => {
        const definition = take(definitions.get(i))
        return [definition.id, definition.getObjectIds() as string[]] as const
      }),
    ),
  )
  const refs = counts(rows.flatMap(({ definition }) => (definition ? [definition] : [])))
  const size = (id: string, seen: ReadonlySet<string>, inBlock = false): number => {
    const row = all.get(id)
    if (!row) return 1 // The importer reports a missing definition member.
    if (row.hidden) return 0
    if (row.paper || (inBlock && !row.member) || !row.definition) return 1
    const ids = members.get(row.definition)
    if (!row.placed || !ids?.length || seen.has(row.definition) || seen.size >= 32) return 1
    const path = new Set([...seen, row.definition])
    return ids.reduce((total, child) => total + size(child, path, true), 0)
  }
  // Count the visible placements with the same accounting as the reader: an unsupported
  // leaf or failed reference takes one slot, and a definition by itself takes none.
  const visibleEntries = root.reduce((total, row) => total + size(row.id, new Set()), 0)
  const directCurves = new Map<string, string | null>()
  for (const row of rows) {
    if (!row.curve || row.hidden || row.paper) continue
    // A provenance ID can occur on multiple placements or be carried across exports.
    const id = row.member || directCurves.has(row.provenanceId) ? null : row.id
    directCurves.set(row.provenanceId, id)
  }
  return {
    unit,
    directCurves,
    report: {
      modelUnit: Object.keys(rhino.UnitSystem).find(
        (key) => Reflect.get(rhino.UnitSystem, key) === units,
      ),
      objects: counts(rows.map(({ type }) => type)),
      layers: layers.count,
      hiddenLayers: layerRows.filter(({ id }) => layerVisibility.get(id) === false).length,
      hiddenTopLevelObjects: root.filter((row) => row.hidden).length,
      definitionMembers: rows.length - root.length,
      instanceDefinitions: definitions.count,
      placedBlockInstances: root.filter((row) => row.definition).length,
      repeatedDefinitions: Object.values(refs).filter((total) => total > 1).length,
      visibleEntries,
      designContext: designContext(
        doc,
        hold,
        rows.flatMap(({ context }) => (context ? [context] : [])),
        members,
      ),
    },
  }
}

export function sourceCurve(rhino: RhinoModule, doc: File3dm, id: string, scale: number) {
  return handles((hold) => {
    const object = hold(hold(doc.objects()).findId(id))
    const curve = hold(object.geometry()) as Curve
    const nurbs = curve instanceof rhino.NurbsCurve ? curve : hold(curve.toNurbsCurve())
    // A converted arc or polycurve can change parameterization. Compare the NURBS form
    // returned by OpenNURBS, reparameterized to the archived model's domain.
    if (nurbs !== curve) nurbs.domain = curve.domain
    return readCurve(nurbs, scale)
  })
}

export function nativeShape(
  rhino: RhinoModule,
  doc: File3dm,
  geometry: GeometryBase,
  includeEncoding = true,
) {
  return handles((hold) => {
    const instance = geometry instanceof rhino.InstanceReference ? geometry : null
    let shape = geometry
    if (instance) {
      const def = hold(hold(doc.instanceDefinitions()).findId(instance.parentIdefId))
      const ids = def?.getObjectIds() as string[] | undefined
      ok(ids?.length === 1, 'Native export instance must contain one solid.')
      const object = hold(hold(doc.objects()).findId(ids[0]!))
      ok(
        hold(object.attributes()).isInstanceDefinitionObject,
        'Native block member is not embedded.',
      )
      shape = hold(object.geometry())
    }
    ok(
      shape instanceof rhino.Brep && shape.isValid && shape.isSolid,
      'Expected a valid closed native BRep.',
    )
    const faceList = hold(shape.faces())
    const edgeList = hold(shape.edges())
    const trims = Array.from({ length: faceList.count }, (_, i) =>
      handles((take) => {
        const face = take(faceList.get(i))
        const loops = take(face.loops)
        return Array.from({ length: loops.count }, (_, l) =>
          handles((use) => use(loops.get(l)).trimCount),
        )
      }),
    )
    const samples = Array.from({ length: edgeList.count }, (_, i) =>
      handles((take) => {
        const edge = take(edgeList.get(i))
        const [start, end] = edge.domain as [number, number]
        return [start, (start + end) / 2, end].map((t) => edge.pointAt(t) as unknown as Vec3)
      }),
    ).flat()
    const xform = instance && hold(instance.xform)
    return {
      type: instance ? ('instance' as const) : ('BRep' as const),
      topology: { edges: edgeList.count, trims },
      shape: includeEncoding ? JSON.stringify(shape.encode()) : undefined,
      samples,
      placement:
        xform &&
        Array.from({ length: 16 }, (_, i) =>
          Number(Reflect.get(xform, `m${i % 4}${Math.floor(i / 4)}`)),
        ),
    }
  })
}
