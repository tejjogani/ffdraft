import { useRouter } from '@tanstack/react-router'
import { useUI } from '../../stores/ui'

interface NewProjectOptions {
  collectionId?: string
  templateId?: string
}

export interface ProjectIntakeDraft {
  title: string
  collectionId: string | null
}

declare module '@tanstack/react-router' {
  interface HistoryState {
    newProject?: NewProjectOptions & { requestId: string }
    projectIntake?: ProjectIntakeDraft
  }
}

/** Give the dialog its own history entry so the browser Back action cancels it. */
export function useOpenNewProject() {
  const router = useRouter()
  return (options: NewProjectOptions = {}) => {
    if (router.history.location.state.newProject) return
    useUI.getState().setMobileNav(false)
    void router.navigate({
      to: router.state.location.pathname,
      search: true,
      hash: true,
      state: (prev) => ({
        ...prev,
        newProject: { ...options, requestId: crypto.randomUUID() },
      }),
      resetScroll: false,
    })
  }
}
