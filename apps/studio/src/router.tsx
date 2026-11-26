import { PIECE_KINDS, type PieceKind, STAGES, type Stage } from '@pave/schema'
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import { lazy } from 'react'
import { Root } from './app/Shell'
import { AcceptInvitePage } from './pages/auth/AcceptInvitePage'
import { HomePage } from './pages/home/HomePage'
import { LIBRARY_TABS, LibraryPage, type LibraryTab } from './pages/library/LibraryPage'
import { NotFound, RouteError } from './pages/NotFound'
import { PieceDirections } from './pages/piece/PieceDirections'
import { PieceHistory } from './pages/piece/PieceHistory'
import { PieceOverview } from './pages/piece/PieceOverview'
import { PiecePage, PieceTab } from './pages/piece/PiecePage'
import { PiecesPage, type PiecesSearch } from './pages/pieces/PiecesPage'
import { AiSettings } from './pages/settings/AiSettings'
import { GeneralSettings } from './pages/settings/GeneralSettings'
import { IntegrationsSettings } from './pages/settings/IntegrationsSettings'
import { MembersSettings } from './pages/settings/MembersSettings'
import { PlanSettings } from './pages/settings/PlanSettings'
import { PrivacySettings } from './pages/settings/PrivacySettings'
import { SettingsLayout } from './pages/settings/SettingsLayout'
import { TraceDetail, TracesSettings } from './pages/settings/TracesSettings'
import { UsageSettings } from './pages/settings/UsageSettings'
import { UpgradePage } from './pages/upgrade/UpgradePage'

// Feature folders load on demand: the CAD and render workspaces bring heavy 3D dependencies.
const PieceDesign = lazy(async () => ({ default: (await import('./features/cad')).PieceDesign }))
const PieceRender = lazy(async () => ({ default: (await import('./features/render')).PieceRender }))
const RendersPage = lazy(async () => ({ default: (await import('./features/render')).RendersPage }))
const BoardsPage = lazy(async () => ({ default: (await import('./features/ideate')).BoardsPage }))
const BoardPage = lazy(async () => ({ default: (await import('./features/ideate')).BoardPage }))
const ModelsPage = lazy(async () => ({ default: (await import('./features/models')).ModelsPage }))
const ModelPage = lazy(async () => ({ default: (await import('./features/models')).ModelPage }))
const PieceOnModel = lazy(async () => ({
  default: (await import('./features/models')).PieceOnModel,
}))
const PieceSourcing = lazy(async () => ({
  default: (await import('./features/sourcing')).PieceSourcing,
}))
const SourcingPage = lazy(async () => ({
  default: (await import('./features/sourcing')).SourcingPage,
}))
const PieceProduction = lazy(async () => ({
  default: (await import('./features/production')).PieceProduction,
}))

const pick = <T extends string>(values: readonly T[], v: unknown): T | undefined =>
  values.includes(v as T) ? (v as T) : undefined

const piecesSearch = (s: Record<string, unknown>): PiecesSearch => ({
  view: pick(['gallery', 'table'] as const, s.view),
  stage: pick<Stage>(STAGES, s.stage),
  kind: pick<PieceKind>(PIECE_KINDS, s.kind),
  group: pick(['none', 'stage'] as const, s.group),
  sort: pick(['updated', 'created', 'title'] as const, s.sort),
})

const rootRoute = createRootRoute({ component: Root, notFoundComponent: NotFound })
const route = <P extends string>(path: P, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => rootRoute, path, component })

const homeRoute = route('/', HomePage)

const piecesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pieces',
  validateSearch: piecesSearch,
  component: () => <PiecesPage />,
})

const collectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/collections/$id',
  validateSearch: piecesSearch,
  component: function Collection() {
    return <PiecesPage collectionId={collectionRoute.useParams().id} />
  },
})

const pieceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pieces/$id',
  validateSearch: (s: Record<string, unknown>): { board?: string } =>
    typeof s.board === 'string' ? { board: s.board } : {},
  component: function Piece() {
    const { id } = pieceRoute.useParams()
    return <PiecePage key={id} id={id} />
  },
})

/** Piece tabs. `bleed` tabs fill the page edge to edge; the others sit in a centred column. */
const pieceTab = (
  path: string,
  Component: React.ComponentType<{ pieceId: string }>,
  bleed = false,
) =>
  createRoute({
    getParentRoute: () => pieceRoute,
    path,
    component: function Tab() {
      const { id } = pieceRoute.useParams()
      return (
        <PieceTab bleed={bleed} pieceId={id}>
          <Component pieceId={id} />
        </PieceTab>
      )
    },
  })

const moodboardsRoute = route('/moodboards', () => <BoardsPage />)
const boardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/moodboards/$boardId',
  component: function Board() {
    return <BoardPage boardId={boardRoute.useParams().boardId} />
  },
})
const legacyIdeas = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ideas',
  beforeLoad: () => {
    throw redirect({ to: '/moodboards', replace: true })
  },
})
const legacyIdea = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ideas/$boardId',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/moodboards/$boardId', params, replace: true })
  },
})
const modelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/models/$id',
  component: function Model() {
    return <ModelPage modelId={modelRoute.useParams().id} />
  },
})

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  validateSearch: (s: Record<string, unknown>): { tab?: LibraryTab } => ({
    tab: pick(LIBRARY_TABS, s.tab),
  }),
  component: function Library() {
    return <LibraryPage tab={libraryRoute.useSearch().tab ?? 'metals'} />
  },
})

const settingsRoute = route('/settings', SettingsLayout)
const setting = (path: string, component: () => React.ReactNode) =>
  createRoute({ getParentRoute: () => settingsRoute, path, component })
const traceRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'traces/$runId',
  component: function Trace() {
    return <TraceDetail runId={traceRoute.useParams().runId} />
  },
})

const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invite/$id',
  component: function Invite() {
    return <AcceptInvitePage invitationId={inviteRoute.useParams().id} />
  },
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  piecesRoute,
  collectionRoute,
  pieceRoute.addChildren([
    pieceTab('/', PieceOverview),
    pieceTab('directions', PieceDirections),
    pieceTab('design', PieceDesign, true),
    pieceTab('render', PieceRender, true),
    pieceTab('on-model', PieceOnModel),
    pieceTab('sourcing', PieceSourcing),
    pieceTab('production', PieceProduction),
    pieceTab('history', PieceHistory),
  ]),
  moodboardsRoute,
  legacyIdeas,
  legacyIdea,
  boardRoute,
  route('/renders', () => <RendersPage />),
  route('/models', () => <ModelsPage />),
  modelRoute,
  route('/sourcing', () => <SourcingPage />),
  libraryRoute,
  route('/upgrade', () => <UpgradePage />),
  settingsRoute.addChildren([
    createRoute({
      getParentRoute: () => settingsRoute,
      path: '/',
      beforeLoad: () => {
        throw redirect({ to: '/settings/general' })
      },
      component: Outlet,
    }),
    setting('general', GeneralSettings),
    setting('members', MembersSettings),
    setting('ai', AiSettings),
    setting('plan', PlanSettings),
    setting('usage', UsageSettings),
    setting('traces', TracesSettings),
    traceRoute,
    setting('privacy', PrivacySettings),
    setting('integrations', IntegrationsSettings),
  ]),
  inviteRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultErrorComponent: RouteError,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
