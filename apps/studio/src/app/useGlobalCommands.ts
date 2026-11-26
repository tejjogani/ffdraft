import { setTheme } from '@pave/ui'
import { useMatch, useNavigate } from '@tanstack/react-router'
import {
  Activity,
  BookOpen,
  Box,
  FileUp,
  FolderPlus,
  Gem,
  Home,
  Image,
  Laptop,
  Lightbulb,
  Moon,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Truck,
  User,
} from 'lucide-react'
import { useOpenPaveFile } from '../features/pavefile'
import { PROJECT_AREAS } from '../features/projects/areas'
import { type Command, useRegisterCommands } from '../lib/commands'
import { useCreatePiece } from '../lib/pieces'
import { useRpcMutation } from '../lib/query'
import { useCurrentView } from '../lib/use-current-view'
import { assistant } from '../stores/assistant'
import { useUI } from '../stores/ui'

/** The app-wide commands. Pages register their own contextual ones with useRegisterCommands. */
export function useGlobalCommands(): void {
  const navigate = useNavigate()
  const pieceId = useMatch({ from: '/pieces/$id', shouldThrow: false })?.params.id
  const isCurrent = useCurrentView()
  const createPiece = useCreatePiece()
  const createBoard = useRpcMutation('boards.create', {
    onMutate: () => isCurrent,
    onSuccess: (board, _input, stillHere) => {
      if (!stillHere?.()) return
      if (board.pieceId)
        void navigate({
          to: '/pieces/$id/directions',
          params: { id: board.pieceId },
          search: { board: board.id },
        })
      else void navigate({ to: '/ideas/$boardId', params: { boardId: board.id } })
    },
  })
  const createCollection = useRpcMutation('collections.create', {
    onMutate: () => isCurrent,
    onSuccess: (c, _input, stillHere) =>
      stillHere?.() && void navigate({ to: '/collections/$id', params: { id: c.id } }),
  })
  const openPaveFile = useOpenPaveFile()
  const go = (to: string) => () => void navigate({ to })

  const commands: Command[] = [
    {
      id: 'palette.open',
      title: 'Search',
      group: 'Navigate',
      icon: Search,
      shortcut: 'mod+k',
      hidden: true,
      run: () => useUI.getState().setPaletteOpen(true),
    },
    {
      id: 'assistant.toggle',
      title: 'Toggle assistant',
      group: 'Assistant',
      icon: Sparkles,
      shortcut: 'mod+j',
      keywords: ['ai', 'chat'],
      run: assistant.toggle,
    },
    {
      id: 'sidebar.toggle',
      title: 'Toggle sidebar',
      group: 'View',
      icon: PanelLeft,
      shortcut: 'mod+\\',
      run: () => useUI.getState().toggleSidebar(),
    },
    {
      id: 'piece.new',
      title: 'New piece',
      group: 'Create',
      icon: Plus,
      shortcut: 'mod+n',
      keywords: ['create', 'ring', 'pendant'],
      run: () => createPiece.mutate({}),
    },
    {
      id: 'board.new',
      title: 'New moodboard',
      group: 'Create',
      icon: Lightbulb,
      keywords: ['idea', 'board', 'references'],
      run: () => createBoard.mutate({ title: 'Untitled board', pieceId }),
    },
    {
      id: 'file.openPave',
      title: 'Open Pavé file…',
      group: 'Create',
      icon: FileUp,
      shortcut: 'mod+o',
      keywords: ['open', 'import', '.pave', 'file'],
      run: openPaveFile,
    },
    {
      id: 'collection.new',
      title: 'New collection',
      group: 'Create',
      icon: FolderPlus,
      run: () => createCollection.mutate({ name: 'New collection' }),
    },
    { id: 'nav.home', title: 'Home', group: 'Navigate', icon: Home, run: go('/') },
    { id: 'nav.pieces', title: 'Pieces', group: 'Navigate', icon: Gem, run: go('/pieces') },
    ...(pieceId
      ? PROJECT_AREAS.map(({ to, icon, title }) => ({
          id: 'project.tool.' + title,
          title,
          icon,
          group: 'Navigate' as const,
          run: () => void navigate({ to, params: { id: pieceId }, search: {} }),
        }))
      : ([
          {
            id: 'nav.ideas',
            title: 'Ideas',
            group: 'Navigate',
            icon: Lightbulb,
            keywords: ['boards', 'moodboards'],
            run: go('/ideas'),
          },
          {
            id: 'nav.renders',
            title: 'Renders',
            group: 'Navigate',
            icon: Image,
            run: go('/renders'),
          },
          {
            id: 'nav.models',
            title: 'Models',
            group: 'Navigate',
            icon: User,
            keywords: ['brand models', 'on-model'],
            run: go('/models'),
          },
          {
            id: 'nav.sourcing',
            title: 'Sourcing',
            group: 'Navigate',
            icon: Truck,
            keywords: ['stones', 'diamonds', 'suppliers'],
            run: go('/sourcing'),
          },
        ] satisfies Command[])),
    {
      id: 'nav.library',
      title: 'Library',
      group: 'Navigate',
      icon: BookOpen,
      keywords: ['metals', 'stones', 'ring sizes', 'templates'],
      run: go('/library'),
    },
    {
      id: 'nav.settings',
      title: 'Settings',
      group: 'Navigate',
      icon: Settings,
      run: go('/settings/general'),
    },
    {
      id: 'nav.usage',
      title: 'Usage & spend',
      group: 'Navigate',
      icon: Activity,
      keywords: ['billing', 'cost'],
      run: go('/settings/usage'),
    },
    {
      id: 'nav.traces',
      title: 'Assistant traces',
      group: 'Navigate',
      icon: Box,
      keywords: ['runs', 'tokens'],
      run: go('/settings/traces'),
    },
    {
      id: 'theme.light',
      title: 'Use light theme',
      group: 'Preferences',
      icon: Sun,
      run: () => setTheme('light'),
    },
    {
      id: 'theme.dark',
      title: 'Use dark theme',
      group: 'Preferences',
      icon: Moon,
      run: () => setTheme('dark'),
    },
    {
      id: 'theme.system',
      title: 'Match system theme',
      group: 'Preferences',
      icon: Laptop,
      run: () => setTheme('system'),
    },
    {
      id: 'assistant.open',
      title: 'Ask the assistant…',
      group: 'Assistant',
      icon: PanelRight,
      run: () => assistant.open(),
    },
  ]
  useRegisterCommands(commands)
}
