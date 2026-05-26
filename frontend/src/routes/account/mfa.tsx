import { createFileRoute, Outlet } from '@tanstack/react-router'

// Pass-through layout for /account/mfa/*. Children — the overview at
// `mfa/index.tsx`, plus TOTP / WebAuthn / recovery-codes enrollment pages —
// render through `<Outlet />`. Without this, navigating to a child URL
// would match the parent route but the child component never mounts.
export const Route = createFileRoute('/account/mfa')({
  component: MfaLayout,
})

function MfaLayout() {
  return <Outlet />
}
