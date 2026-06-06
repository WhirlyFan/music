import { createFileRoute } from '@tanstack/react-router'

import { ProfileBanner } from '@/components/account/settings-sections'

export const Route = createFileRoute('/settings/profile')({
  component: ProfileBanner,
  head: () => ({ meta: [{ title: 'Profile — Settings — music' }] }),
})
