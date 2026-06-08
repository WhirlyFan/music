import { IS_DESKTOP } from '@/lib/api/client'

/**
 * Whether to honor "reduce motion". On the desktop app this is forced FALSE: its
 * WKWebView mis-reports `prefers-reduced-motion: reduce` even when the OS setting is
 * off, which silently kills animations the user does want (the now-playing screen,
 * the audio visualizer, the gooey FAB, tilt/physics). Web is dead, so the real query
 * isn't needed there. On a normal browser it reflects the OS setting.
 *
 * The CSS side of this is handled in index.css (the motion-safe/motion-reduce
 * variants are redefined and the reduced-motion guards removed).
 */
export function prefersReducedMotion(): boolean {
  if (IS_DESKTOP) return false
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
