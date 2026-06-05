import type * as React from 'react'

/**
 * The shared shell for every auth surface (login, signup, the social callback,
 * MFA, invite interstitial). Matches the app's vibe — a `bg-card` panel with the
 * same `rounded-2xl border shadow-xl` as our modals, a spring-y slide-up entrance,
 * and a soft brand-tinted glow behind it for depth. Pages pass a title, optional
 * description, the form/body as children, and an optional footer (e.g. the
 * "Don't have an account? Sign up" line) that sits just below the card.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    // No outer full-screen padding — the shared <main> already centers content
    // (max-w-5xl, mx-auto, py-8). We just constrain to a comfortable auth width
    // (not skinny) and center it. `relative` anchors the brand glow.
    <div className="relative mx-auto w-full max-w-md">
      {/* Soft brand glow — echoes the indigo/violet palette without shouting. */}
      <div
        aria-hidden
        className="bg-primary/15 pointer-events-none absolute -top-12 left-1/2 -z-10 size-64 -translate-x-1/2 rounded-full blur-3xl"
      />
      {/* Named view-transition region → opens/closes like a modal across
          navigations, including the Back button. Enter + exit are driven by
          `::view-transition-*(auth-card)` in index.css. */}
      <div className="space-y-4 [view-transition-name:auth-card]">
        <div className="bg-card/95 border-border space-y-6 rounded-2xl border p-8 shadow-xl backdrop-blur">
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description ? <p className="text-muted-foreground text-sm">{description}</p> : null}
          </div>
          {children}
        </div>
        {footer ? <p className="text-muted-foreground text-center text-sm">{footer}</p> : null}
      </div>
    </div>
  )
}
