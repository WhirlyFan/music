import { createContext, useContext } from 'react'

import { cn } from '@/lib/utils'

/**
 * Colocated loading skeletons (the "SkeletonZone" pattern). The rule: a
 * component that has a loading state exports a `ComponentNameSkeleton` (or
 * branches on a `loading` flag) IN THE SAME FILE, reusing the real shell's
 * dimensions so the placeholder can't drift from the content.
 *
 * Two ways to drive it:
 *   1. Local flag — `const show = useSkeletonZone() || isLoading`.
 *   2. Zone — wrap a subtree in `<SkeletonZone>` to force every skeleton-aware
 *      child on (e.g. a section placeholder), without threading a prop down.
 *
 * Every primitive bakes in `motion-reduce:animate-none`. Put
 * `role="status" aria-busy` on the grouping container; leaves are `aria-hidden`.
 */
const SKELETON_BASE = 'bg-muted animate-pulse rounded-md motion-reduce:animate-none'

const SkeletonZoneContext = createContext(false)

export function useSkeletonZone() {
  return useContext(SkeletonZoneContext)
}

export function SkeletonZone({
  active = true,
  children,
}: {
  active?: boolean
  children: React.ReactNode
}) {
  return <SkeletonZoneContext.Provider value={active}>{children}</SkeletonZoneContext.Provider>
}

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Wrap mode only: render the placeholder instead of children while true. */
  loading?: boolean
}

export function Skeleton({ loading, className, children, style, ...props }: SkeletonProps) {
  const showSkeleton = useSkeletonZone() || loading

  // Wrap mode: render children invisibly to reserve their exact footprint, then
  // overlay a skeleton — so the placeholder matches the real element's size.
  if (children != null) {
    if (!showSkeleton) return <>{children}</>
    return (
      <span aria-hidden className="relative inline-block align-middle">
        <span className="invisible">{children}</span>
        <span className={cn(SKELETON_BASE, 'absolute inset-0', className)} style={style} />
      </span>
    )
  }

  // Leaf mode: a fixed placeholder box sized by className (e.g. "h-8 w-20").
  return <div aria-hidden className={cn(SKELETON_BASE, className)} style={style} {...props} />
}

interface SkeletonTextProps extends React.ComponentProps<'span'> {
  lines?: number
  lastLineWidth?: string
}

/**
 * Text placeholder that inherits height from the surrounding font-size (via a
 * zero-width char + `leading-none`), so it auto-matches the text it stands in
 * for — drop it straight inside an `<h1>`/`<p>`.
 */
export function SkeletonText({
  lines = 1,
  lastLineWidth = '60%',
  className,
  ...props
}: SkeletonTextProps) {
  return (
    <span aria-hidden className="flex w-full flex-col gap-1.5" {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className={cn(SKELETON_BASE, 'block leading-none', className)}
          style={lines > 1 && i === lines - 1 ? { width: lastLineWidth } : undefined}
        >
          {'‌'}
        </span>
      ))}
    </span>
  )
}

interface SkeletonCircleProps extends React.ComponentProps<'div'> {
  size?: number | string
}

export function SkeletonCircle({ size = '2rem', className, style, ...props }: SkeletonCircleProps) {
  const dimension = typeof size === 'number' ? `${size}px` : size
  return (
    <div
      aria-hidden
      className={cn(SKELETON_BASE, 'shrink-0 rounded-full', className)}
      style={{ width: dimension, height: dimension, ...style }}
      {...props}
    />
  )
}
