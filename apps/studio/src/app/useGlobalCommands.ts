import { setTheme } from '@pave/ui'
import { useNavigate } from '@tanstack/react-router'
import {
  Activity,
  BookOpen,
  Box,
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
import { type Command, useRegisterCommands } from '../lib/commands'
import { useCreatePiece } from '../lib/pieces'
import { useRpcMutation } from '../lib/query'
import { assistant } from '../stores/assistant'
import { useUI } from '../stores/ui'

/** The app-wide commands. Pages register their own contextual ones with useRegisterCommands. */
export function useGlobalCommands(): void {
  const navigate = useNavigate()
  const createPiece = useCreatePiece()
  const createBoard = useRpcMutation('boards.create', {
    onSuccess: (b) => void navigate({ to: '/ideas/$boardId', params: { boardId: b.id } }),
  })
  const createCollection = useRpcMutation('collections.create', {
    onSuccess: (c) => void navigate({ to: '/collections/$id', params: { id: c.id } }),
  })
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
      run: () => createBoard.mutate({ title: 'Untitled board' }),
    },
    {
      id: 'collection.new',
      title: 'New collection',
      group: 'Create',
      icon: FolderPlus,
      run: () => createCollection.mutate({ name: 'New collection' }),
    },
    { id: 'nav.home', title: 'Home', group: 'Navigate', icon: Home, run: go('/') },
    {
      id: 'nav.ideas',
      title: 'Ideas',
      group: 'Navigate',
      icon: Lightbulb,
      keywords: ['boards', 'moodboards'],
      run: go('/ideas'),
    },
    { id: 'nav.pieces', title: 'Pieces', group: 'Navigate', icon: Gem, run: go('/pieces') },
    { id: 'nav.renders', title: 'Renders', group: 'Navigate', icon: Image, run: go('/renders') },
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
