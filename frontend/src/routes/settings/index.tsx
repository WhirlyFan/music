import { createFileRoute, redirect } from '@tanstack/react-router'

// /settings has no content of its own — land on the Profile section. Replace so
// /settings never sits in history (Back skips straight past it).
export const Route = createFileRoute('/settings/')({
  beforeLoad: () => {
    throw redirect({ to: '/settings/profile', replace: true })
  },
})
