import { useLocation, useRouter } from '@tanstack/react-router'

/** Check whether the history entry that started an asynchronous action is still open. */
export function useCurrentView() {
  const router = useRouter()
  const key = useLocation({ select: (location) => location.state.__TSR_key })
  return () => router.history.location.state.__TSR_key === key
}
