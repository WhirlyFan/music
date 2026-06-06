import { createFileRoute } from '@tanstack/react-router'

import { AccountSection } from '@/components/account/settings-sections'

export const Route = createFileRoute('/settings/account')({
  component: AccountSection,
  head: () => ({ meta: [{ title: 'Account — Settings — music' }] }),
})
