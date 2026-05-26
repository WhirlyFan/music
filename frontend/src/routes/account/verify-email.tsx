import { createFileRoute, Outlet } from '@tanstack/react-router'

// Pass-through layout for /account/verify-email/*. The waiting page lives at
// `verify-email/index.tsx`; the email-link landing page at `verify-email/$key.tsx`.
// Both render through `<Outlet />`. Without this, the $key page never mounts —
// so clicking the link in the email did nothing visibly.
export const Route = createFileRoute('/account/verify-email')({
  component: VerifyEmailLayout,
})

function VerifyEmailLayout() {
  return <Outlet />
}
