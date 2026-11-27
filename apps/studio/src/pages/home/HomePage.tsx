import { Button, buttonClass, InlineError } from '@pave/ui'
import { Link, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowRight, Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Column, PageHeader, PageTitle, SectionTitle } from '../../components/Page'
import { PieceCard, PieceCardSkeleton } from '../../components/PieceCard'
import { projectFolder } from '../../features/projects/folder'
import { type ProjectIntakeDraft, useOpenNewProject } from '../../features/projects/new-project'
import { useRpc } from '../../lib/query'
import { useSession } from '../../lib/session'
import { useAssistant } from '../../stores/assistant'
import { BrainstormPage } from './BrainstormPage'
import { Composer } from './Composer'
import { IntakePage } from './IntakePage'
import type { IntakeSearch } from './intake'

const greeting = (h: number) =>
  h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'

export function HomePage({ search }: { search: IntakeSearch }) {
  const projectIntake = useLocation({ select: (location) => location.state.projectIntake })
  const drafting = !!(search.intake || search.brainstorm || projectIntake)
  useEffect(() => {
    if (drafting) useAssistant.getState().close()
  }, [drafting])
  if (search.intake)
    return <IntakePage key={search.intake} search={search} pieceId={search.intake} />
  if (search.brainstorm)
    return (
      <BrainstormPage key={search.brainstorm} id={search.brainstorm} threadId={search.thread} />
    )
  if (projectIntake) return <ProjectIntakeComposer draft={projectIntake} />
  return <HomeDashboard />
}

function ProjectIntakeComposer({ draft }: { draft: ProjectIntakeDraft }) {
  const router = useRouter()
  const collections = useRpc('collections.list', {})
  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Design intake' }]}
        actions={
          <Button variant="ghost" onClick={() => router.history.back()}>
            Cancel
          </Button>
        }
      />
      <Column>
        <PageTitle
          title={draft.title}
          description={projectFolder(draft.collectionId, collections.data)}
        />
        <Composer draft={draft} />
      </Column>
    </>
  )
}

function HomeDashboard() {
  const session = useSession()
  const navigate = useNavigate()
  const openNewProject = useOpenNewProject()
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
          <h1 className="mb-7 studio-title text-fg">
            {greeting(now.getHours())}
            {firstName && (
              <>
                , <span className="italic">{firstName}</span>
              </>
            )}
          </h1>
          <Composer />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button icon={Plus} onClick={() => openNewProject()}>
              New project
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void navigate({ to: '/', search: { brainstorm: crypto.randomUUID() } })
              }
            >
              Brainstorm <ArrowRight aria-hidden />
            </Button>
          </div>
        </section>
        <RecentPieces />
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
            All projects <ArrowRight aria-hidden />
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
