import {
  GEM_CUTS,
  GEM_MATERIALS,
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

  if (!stones.length)
    return (
      <EmptyState
        title="No diamonds to source"
        description="Add a diamond in Design to find listings for it."
        action={openCad}
      />
    )

  return (
    <section aria-label="Project diamonds" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-medium text-fg">Project diamonds</h2>
        {openCad}
      </div>
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
            <li key={node.id} className="py-4">
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
