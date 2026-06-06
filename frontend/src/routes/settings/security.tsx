import { createFileRoute } from '@tanstack/react-router'

import { SecuritySection } from '@/components/account/settings-sections'

export const Route = createFileRoute('/settings/security')({
  component: SecuritySection,
  head: () => ({ meta: [{ title: 'Security — Settings — music' }] }),
})
