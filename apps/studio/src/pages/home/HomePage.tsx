import { buildDesign, TEMPLATES, type Template } from '@pave/schema'
import { buttonClass, InlineError } from '@pave/ui'
import { Link } from '@tanstack/react-router'
import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import { KindGlyph } from '../../components/KindGlyph'
import { Column, PageHeader, SectionTitle } from '../../components/Page'
import { PieceCard, PieceCardSkeleton } from '../../components/PieceCard'
import { useCreatePiece } from '../../lib/pieces'
import { useRpc } from '../../lib/query'
import { useSession } from '../../lib/session'
import { Composer } from './Composer'

const greeting = (h: number) =>
  h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'

export function HomePage() {
  const session = useSession()
  const firstName = session.user.name.split(' ')[0]
  const now = new Date()
  return (
    <>
      <PageHeader crumbs={[{ label: 'Home' }]} />
      <Column>
        <section className="pt-[9vh] pb-14">
          <p className="mb-1 text-sm text-fg-subtle">
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          <h1 className="mb-7 font-serif text-display text-fg">
            {greeting(now.getHours())}
            {firstName && (
              <>
                , <span className="italic">{firstName}</span>
              </>
            )}
          </h1>
          <Composer />
        </section>
        <RecentPieces />
        <Templates />
      </Column>
    </>
  )
}

function RecentPieces() {
  const pieces = useRpc('pieces.list', { limit: 24 })
  const recent = useMemo(
    () =>
      [...(pieces.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    [pieces.data],
  )
  if (pieces.isSuccess && recent.length === 0) return null
  return (
    <section className="mb-14">
      <SectionTitle
        actions={
          <Link to="/pieces" className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            All pieces <ArrowRight aria-hidden />
          </Link>
        }
      >
        Jump back in
      </SectionTitle>
      {pieces.isError ? (
        <InlineError message={pieces.error.message} onRetry={() => void pieces.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {pieces.isPending
            ? Array.from({ length: 4 }, (_, i) => <PieceCardSkeleton key={i} />)
            : recent.map((p) => <PieceCard key={p.id} piece={p} />)}
        </div>
      )}
    </section>
  )
}

function Templates() {
  const create = useCreatePiece()
  const families = useMemo(() => {
    const map = new Map<Template['family'], Template[]>()
    for (const t of TEMPLATES) map.set(t.family, [...(map.get(t.family) ?? []), t])
    return [...map]
  }, [])
  return (
    <section>
      <SectionTitle>Start from a template</SectionTitle>
      <div className="flex flex-col gap-6">
        {families.map(([family, templates]) => (
          <div key={family}>
            <h3 className="mb-2 text-xs text-fg-subtle">{family}</h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  disabled={create.isPending}
                  onClick={() => create.mutate({ templateId: t.id })}
                  className="group flex items-center gap-3 rounded-lg p-1.5 pr-3 text-left transition-colors duration-120 hover:bg-bg-hover disabled:opacity-60"
                >
                  <span className="stage flex size-12 shrink-0 items-center justify-center rounded-md shadow-[0_0_0_1px_var(--line)]">
                    <KindGlyph kind={buildDesign(t.spec).kind} className="w-8 text-fg-muted" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">
                      {t.spec.title}
                    </span>
                    <span className="block truncate text-xs text-fg-subtle">{t.spec.summary}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
