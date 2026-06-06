import { createFileRoute, Outlet } from '@tanstack/react-router'
import { KeyRound, ShieldCheck, UserRound, Users } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { SectionSidebar, type SidebarItem } from '@/components/layout/section-sidebar'

export const Route = createFileRoute('/settings')({
  component: SettingsLayout,
})

const TABS: SidebarItem[] = [
  { to: '/settings/profile', label: 'Profile', icon: UserRound },
  { to: '/settings/friends', label: 'Friends', icon: Users },
  { to: '/settings/account', label: 'Account', icon: KeyRound },
  { to: '/settings/security', label: 'Security', icon: ShieldCheck },
]

/** Two-pane settings shell. Each section is its own route (`/settings/<section>`);
 *  the sidebar links between them and the active section renders through `<Outlet />`. */
function SettingsLayout() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your profile, friends, account, and security."
      />
      <div className="flex flex-col gap-6 sm:flex-row">
        <aside className="sm:w-52 sm:shrink-0">
          <SectionSidebar items={TABS} />
        </aside>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
