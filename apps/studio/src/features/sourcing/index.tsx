import {
  type Design,
  DIAEX_CUT_IDS,
  type DiaexCutId,
  GEM_CUTS,
  GEM_MATERIALS,
  importedDiamondCut,
  importRoleOf,
  isRhinoRoleBody,
  type Node,
  type NodeOf,
  nodeTitle,
  resolveDesign,
  stoneDims,
  stoneFitTargetError,
} from '@pave/schema'
import {
  Button,
  buttonClass,
  controlClass,
  EmptyState,
  Field,
  InlineError,
  Skeleton,
} from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Column, PageHeader, PageTitle } from '../../components/Page'
import { mm } from '../../lib/format'
import { useRpc } from '../../lib/query'
import { activeOrg, useSession } from '../../lib/session'
import { pendingImportedDiamonds } from './imported-diamonds'
import { diaexBrowseLink } from './links'
import { dimensions, StoneInventory } from './StoneInventory'

export function SourcingPage() {
  const pieces = useRpc('pieces.list', { limit: 200 })
  const [pieceId, setPieceId] = useState('')
  const selected = pieces.data?.find((piece) => piece.id === pieceId)
  return (
    <>
      <PageHeader crumbs={[{ label: 'Sourcing' }]} />
      <Column wide>
        <PageTitle title="Sourcing" />
        {pieces.isError ? (
          <InlineError message={pieces.error.message} onRetry={() => void pieces.refetch()} />
        ) : pieces.isPending ? (
          <Skeleton className="h-8 w-64" />
        ) : pieces.data.length ? (
          <Field label="Project" className="mb-6 max-w-sm">
            {(id) => (
              <select
                id={id}
                className={controlClass}
                value={selected?.id ?? ''}
                onChange={(e) => setPieceId(e.target.value)}
              >
                <option value="">Choose a project</option>
                {pieces.data.map((piece) => (
                  <option key={piece.id} value={piece.id}>
                    {piece.title}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <EmptyState
            title="No projects yet"
            action={
              <Link to="/pieces" className={buttonClass()}>
                Open projects
              </Link>
            }
          />
        )}
        {selected && <PieceSourcing key={selected.id} pieceId={selected.id} />}
      </Column>
    </>
  )
}

type StoneNode = NodeOf<'gem' | 'halo' | 'gemRow' | 'pave'>

function isDiamond(node: Node | undefined): node is StoneNode {
  return Boolean(
    node &&
      (node.kind === 'gem' ||
        node.kind === 'halo' ||
        node.kind === 'gemRow' ||
        node.kind === 'pave') &&
      node.stone.startsWith('diamond'),
  )
}

export function PieceSourcing({ pieceId }: { pieceId: string }) {
  const piece = useRpc('pieces.get', { id: pieceId })
  const design = useMemo(() => (piece.data ? resolveDesign(piece.data.design) : null), [piece.data])
  const role = activeOrg(useSession())?.role ?? 'viewer'
  const canFit = role !== 'viewer' && role !== 'guest'
  const [active, setActive] = useState<string | null>(null)
  const openCad = (
    <Link to="/pieces/$id/design" params={{ id: pieceId }} className={buttonClass()}>
      Open project CAD
    </Link>
  )
  if (piece.isError)
    return <InlineError message={piece.error.message} onRetry={() => void piece.refetch()} />
  if (!design || !piece.data) return <Skeleton className="h-16 w-full" />
  const stones = design.order.map((id) => design.nodes[id]).filter(isDiamond)

  const pending = pendingImportedDiamonds(design)
  const hasUnassigned = design.order.some((id) => {
    const body = design.nodes[id]
    return isRhinoRoleBody(body) && body.visible && importRoleOf(body) === 'unassigned'
  })
  const review = canFit ? (
    <Link
      to="/pieces/$id/design"
      params={{ id: pieceId }}
      search={{ review: 'rhino-roles' }}
      className={buttonClass({ variant: 'secondary', size: 'sm' })}
    >
      Review materials
    </Link>
  ) : null

  if (!stones.length && !pending.length)
    return (
      <EmptyState
        title={hasUnassigned ? 'Imported materials need review' : 'No diamonds to source'}
        description={
          hasUnassigned
            ? 'Confirm which imported parts are diamonds in CAD to find matching stones.'
            : 'Add a diamond in project CAD to find matching stones.'
        }
        action={(hasUnassigned && review) || openCad}
      />
    )

  return (
    <section aria-label="Project diamonds" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-fg">Project diamonds</h2>
        {stones.length > 0 && openCad}
      </div>
      {pending.length > 0 && (
        <ImportedDiamondSearch
          key={pieceId}
          ids={pending}
          design={design}
          pieceId={pieceId}
          version={piece.data.version}
          canFit={canFit}
        />
      )}
      <ul className="divide-y divide-line border-y border-line">
        {stones.map((node) => {
          const isOpen = active === node.id
          const reason =
            node.kind !== 'gem'
              ? 'This setting uses a group of stones.'
              : node.stone === 'diamond-black' || node.cut === 'cabochon'
                ? 'Diaex does not list this material or cut for fitting.'
                : stoneFitTargetError(design, node.id)
          const size =
            node.kind === 'gem'
              ? dimensions(stoneDims(node))
              : mm(node.kind === 'pave' ? node.sizeMax : node.stoneWidth)
          const listing =
            node.sourcing?.provider === 'diaex' ? diaexBrowseLink(node.sourcing.url) : undefined
          return (
            <li key={node.id} id={`stone-${node.id}`} className="scroll-mt-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-fg">{nodeTitle(node)}</h3>
                  <p className="mt-1 text-sm text-fg-muted">
                    {GEM_CUTS[node.cut].label} · {GEM_MATERIALS[node.stone].label} ·{' '}
                    <span className="tabular">{size}</span>
                  </p>
                  {node.sourcing && (
                    <p className="mt-1 break-all text-xs text-fg-muted">
                      {listing ? (
                        <a
                          href={listing.href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 underline decoration-line-strong underline-offset-2"
                        >
                          Fitted stone · {node.sourcing.sku}
                          <ArrowUpRight className="size-3 shrink-0" aria-hidden />
                        </a>
                      ) : (
                        <>Fitted stone · {node.sourcing.sku}</>
                      )}
                    </p>
                  )}
                  {reason && <p className="mt-1 text-xs text-fg-muted">{reason}</p>}
                </div>
                {!reason && (
                  <Button
                    size="sm"
                    aria-expanded={isOpen}
                    onClick={() => setActive(isOpen ? null : node.id)}
                  >
                    {isOpen
                      ? 'Close inventory'
                      : node.sourcing
                        ? 'Change diamond'
                        : 'Find diamonds'}
                  </Button>
                )}
              </div>
              {isOpen && !reason && node.kind === 'gem' && (
                <StoneInventory
                  key={node.id}
                  pieceId={pieceId}
                  version={piece.data.version}
                  diamond={node}
                  canFit={canFit}
                  onFit={() => setActive(null)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ImportedDiamondSearch({
  ids,
  design,
  pieceId,
  version,
  canFit,
}: {
  ids: string[]
  design: Design
  pieceId: string
  version: number
  canFit: boolean
}) {
  const [selectedId, setSelectedId] = useState('')
  const [cutOverride, setCutOverride] = useState<DiaexCutId | ''>('')
  const id = ids.includes(selectedId) ? selectedId : ids[0]!
  const body = design.nodes[id]
  if (!isRhinoRoleBody(body)) return null
  const cut = cutOverride || importedDiamondCut(body)
  return (
    <section
      aria-label="Imported diamonds"
      className="rounded-lg border border-line bg-bg-subtle p-4"
    >
      <h3 className="text-sm font-medium text-fg">
        {ids.length} imported {ids.length === 1 ? 'diamond' : 'diamonds'}
      </h3>
      <p className="mb-3 mt-1 text-sm text-fg-muted">
        Find available diamonds using the dimensions of a stone in your CAD.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Stone in CAD" className="min-w-0 max-w-full flex-auto">
          {(fieldId) => (
            <select
              id={fieldId}
              className={controlClass}
              value={id}
              onChange={(e) => {
                setSelectedId(e.target.value)
                setCutOverride('')
              }}
            >
              {ids.map((item, index) => (
                <option key={item} value={item}>
                  {index + 1}. {nodeTitle(design.nodes[item]!)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Search cut" className="min-w-32">
          {(fieldId) => (
            <select
              id={fieldId}
              className={controlClass}
              value={cut ?? ''}
              onChange={(e) => setCutOverride(e.target.value as DiaexCutId)}
            >
              {!cut && <option value="">Choose a cut</option>}
              {DIAEX_CUT_IDS.map((value) => (
                <option key={value} value={value}>
                  {GEM_CUTS[value].label}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {cut && (
        <>
          <StoneInventory
            key={JSON.stringify([id, cut, version])}
            pieceId={pieceId}
            version={version}
            diamond={body}
            searchCut={cut}
            canFit={false}
          />
          {canFit && (
            <Link
              to="/pieces/$id/design"
              params={{ id: pieceId }}
              search={{ review: 'rhino-roles', reviewBody: id }}
              className="mt-3 inline-block text-sm text-fg-muted underline decoration-line-strong underline-offset-2"
            >
              Set up this stone for a CAD replacement
            </Link>
          )}
        </>
      )}
    </section>
  )
}
