import type { AgentToolName } from '@pave/agent'
import { type Design, describeNode, NODE_KINDS, NODE_SCHEMAS } from '@pave/schema'
import { z } from 'zod'

type Support = 'available' | 'limited' | 'unavailable' | 'unverified'
type Operation = { status: Support; detail: string; tools: AgentToolName[] }

// Product operations whose scope a Rhino command name or a feature schema alone cannot describe.
const operations: Record<string, Operation> = {
  sweep1: {
    status: 'limited',
    detail:
      'Sweep ordered construction or NURBS sections on one guide. Inspect the resulting solid or sheet.',
    tools: ['design.apply', 'design.evaluate'],
  },
  sweep2: {
    status: 'limited',
    detail:
      'Two open guides, with sections meeting both rails in order. A closed two-rail shank is unsupported.',
    tools: ['design.apply', 'design.evaluate'],
  },
  closedSweep2: {
    status: 'unavailable',
    detail:
      'Periodic two-rail sweeps are unavailable. An open-rail sweep covers the supported open section of a design.',
    tools: [],
  },
  moveGeneratedStone: {
    status: 'unavailable',
    detail:
      'Generated halo, row and pavé instances can be hidden or isolated in Studio. Their individual positions cannot be moved, pinned or deleted through a rebuild.',
    tools: [],
  },
  trimSurface: {
    status: 'unavailable',
    detail:
      'General freeform surface trimming is unavailable. Boolean tools operate on supported solids.',
    tools: [],
  },
  blendSrf: {
    status: 'unavailable',
    detail:
      'There is no general surface blend with G1 or G2 continuity control or a tool to certify that continuity.',
    tools: [],
  },
  subD: {
    status: 'unavailable',
    detail:
      'Subdivision control-cage authoring is unavailable. Moving vertices on an imported triangle mesh edits that mesh.',
    tools: [],
  },
  azureCutter: {
    status: 'unavailable',
    detail:
      'User-edited azure and bright-cut cutters are unavailable. Supported settings generate their own production seats.',
    tools: [],
  },
  rhinoFaceEdit: {
    status: 'limited',
    detail:
      'Inspect retained native geometry first. Eligible straight-sided end faces support a normal offset. Eligible face borders and edges can be copied as independent curves.',
    tools: [
      'design.rhinoCapFaces',
      'design.offsetRhinoCap',
      'design.rhinoFaceBorders',
      'design.rhinoEdges',
    ],
  },
  refitStone: {
    status: 'limited',
    detail:
      'Refit a confirmed stone and its linked setting using measured length, width and depth. Clearances and actual bearing contact need independent review.',
    tools: ['design.replaceStone', 'design.inspectMount', 'design.evaluate'],
  },
  referenceMatch: {
    status: 'limited',
    detail:
      'Inspect the reference, ask for missing scale and unseen construction, build the editable features and compare a controlled camera view. A matching outline cannot verify hidden geometry, seat contact or material identity.',
    tools: [
      'references.read',
      'chat.ask',
      'pieces.buildFromSpec',
      'match.fit',
      'viewport.capture',
      'design.evaluate',
    ],
  },
}

const normalize = (name: string) => name.toLowerCase().replace(/[\s_-]/g, '')

export function cadCapabilities(design: Design, requested?: string) {
  const projectKinds = [...new Set(design.order.map((id) => design.nodes[id]!.kind))]
  const names = [...NODE_KINDS, ...Object.keys(operations)]
  const key = requested && normalize(requested)
  const entry = key && Object.entries(operations).find(([name]) => normalize(name) === key)
  if (entry) return { operation: entry[0], ...entry[1], projectKinds, names }
  const kind =
    key &&
    NODE_KINDS.find((kind) =>
      [kind, describeNode(kind).title].some((name) => normalize(name) === key),
    )
  if (kind)
    return {
      operation: kind,
      status: 'available' as const,
      detail: describeNode(kind).description || describeNode(kind).title,
      projectKinds,
      names,
      tools: ['design.apply' as const],
      schema: z.toJSONSchema(NODE_SCHEMAS[kind], { io: 'input' }),
    }
  return {
    operation: requested ?? null,
    status: 'unverified' as const,
    projectKinds,
    names,
    tools: [],
    detail: requested
      ? 'No verified operation with that name. Inspect the listed names before offering an edit.'
      : 'Choose a name to inspect its supported scope, commands and feature inputs.',
  }
}
