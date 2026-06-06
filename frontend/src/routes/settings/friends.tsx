import { createFileRoute } from '@tanstack/react-router'

import { FriendsPanel, type FriendsView } from '@/components/social/friends-panel'

const VIEWS: FriendsView[] = ['friends', 'requests', 'add']

export const Route = createFileRoute('/settings/friends')({
  // Persist the active sub-tab in the URL (?tab=…) so it survives refresh and Back.
  validateSearch: (search): { tab: FriendsView } => {
    const tab = search.tab as FriendsView
    return { tab: VIEWS.includes(tab) ? tab : 'friends' }
  },
  component: FriendsRoute,
  head: () => ({ meta: [{ title: 'Friends — Settings — music' }] }),
})

function FriendsRoute() {
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <FriendsPanel
      view={tab}
      // Replace (don't push) so switching tabs never stacks Back-button history.
      onViewChange={(v) => navigate({ search: { tab: v }, replace: true })}
    />
  )
}
