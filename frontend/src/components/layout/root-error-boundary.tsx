import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'

type Props = { children: ReactNode }
type State = { error: Error | null }

/**
 * Top-level error boundary. Catches render-time errors anywhere in the
 * router subtree (including lazy chunk-load failures) and shows a
 * recoverable UI instead of a white screen.
 *
 * Per-route boundaries belong in route components — this one is the
 * last-resort net.
 */
export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log the error so Sentry / browser console / log shipper picks it up.
    // Sentry's React integration patches console.error too, so this suffices
    // without a direct Sentry import in the boundary. The no-console rule
    // is enforced elsewhere; error boundaries are the canonical exception.
    // eslint-disable-next-line no-console
    console.error('[RootErrorBoundary]', error, info)
  }

  private reset = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="bg-background flex min-h-screen items-center justify-center px-6">
          <div className="max-w-md space-y-4 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">Something went wrong.</h1>
            <p className="text-muted-foreground text-sm">
              {this.state.error.message || 'An unexpected error occurred.'}
            </p>
            <div className="flex justify-center gap-3">
              <Button onClick={this.reset} variant="outline">
                Try again
              </Button>
              <Button onClick={() => window.location.reload()}>Reload</Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
