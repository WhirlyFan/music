/**
 * Toaster wrapper component — shadcn-style.
 *
 * Owning this file lets us tune positioning, duration, theme-binding, and
 * default options in one place without touching every `<Toaster />`
 * consumer. The underlying library is sonner; this file is the seam
 * between our app and that dependency (swap-out point).
 *
 * Consumers should import `toast` from sonner directly for emitting
 * toasts. This component only owns the renderer.
 */
import { Toaster as SonnerToaster } from 'sonner'

import { useThemeStore } from '@/lib/theme/store'

type Props = React.ComponentProps<typeof SonnerToaster>

export function Toaster(props: Props) {
  // Reactively read the theme so light/dark switches re-style the toaster.
  const theme = useThemeStore((s) => s.theme)

  return (
    <SonnerToaster
      theme={theme}
      position="top-right"
      richColors
      closeButton
      toastOptions={{ duration: 5000 }}
      {...props}
    />
  )
}
