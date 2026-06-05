import { Link } from '@tanstack/react-router'
import { MoreVertical, Music, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Ripples, useRipple } from '@/components/ui/ripple'
import { Skeleton, SkeletonZone, useSkeletonZone } from '@/components/ui/skeleton'
import { TiltCard } from '@/components/ui/tilt-card'

export type CoverItem = {
  id: string
  title: string
  artwork_url?: string
  track_count: number
}

const FRICTION = 0.92
const TAP_THRESHOLD = 6 // px of movement below which a press counts as a tap
// Golden angle — the sunflower/phyllotaxis spacing that fills a disc evenly with no
// preferred axis, so the cluster looks organic rather than like rings or spokes.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
// Radius grows as STEP*sqrt(i): even areal density (sunflower). 0.62*card packs them
// into a tight overlapping cluster at the centre that fans outward.
const STEP_FACTOR = 0.62
const cardFor = (width: number) => (width < 640 ? 116 : 148)

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * A finite, click-and-drag cluster of playlist covers laid out on a golden-angle
 * spiral — one tile per playlist (no repeating/tiling). The covers bunch around the
 * centre and fan outward; drag to pan with inertia, tap a cover to open it.
 *
 * Positions are static (computed from the cover count + size); only a drag `offset` is
 * mutated in a rAF loop and written to each tile's `transform: translate3d`, so tiles
 * never re-render per frame. The visual cluster is `aria-hidden`; an `sr-only` list of
 * real links is rendered alongside so keyboard / screen-reader users get every playlist.
 *
 * While `loading`, renders a static grid of skeletons (the drag machinery no-ops without
 * a container).
 */
export function CoverSpiral({
  items,
  onOpen,
  onDelete,
  loading = false,
}: {
  items: CoverItem[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  loading?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tileEls = useRef<(HTMLDivElement | null)[]>([])
  const [card, setCard] = useState(148)
  // Precomputed spiral offsets (relative to centre) + the container centre, in a ref so
  // the rAF draw reads them without re-rendering.
  const layout = useRef({ cx: 0, cy: 0, pos: [] as { x: number; y: number }[] })

  const offset = useRef({ x: 0, y: 0 })
  const vel = useRef({ x: 0, y: 0 })
  const last = useRef({ x: 0, y: 0 })
  const moved = useRef(0)
  const dragging = useRef(false)
  const tapId = useRef<string | null>(null)
  const raf = useRef<number | null>(null)

  const draw = useCallback(() => {
    const { cx, cy, pos } = layout.current
    const { x: ox, y: oy } = offset.current
    for (let i = 0; i < pos.length; i++) {
      const el = tileEls.current[i]
      if (!el) continue
      el.style.transform = `translate3d(${cx + pos[i].x + ox}px, ${cy + pos[i].y + oy}px, 0)`
    }
  }, [])

  // Recompute the spiral whenever the container size, card size, or item count changes.
  const relayout = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const c = cardFor(el.clientWidth)
    const step = c * STEP_FACTOR
    const pos = items.map((_, i) => {
      const r = step * Math.sqrt(i)
      const a = i * GOLDEN_ANGLE
      return { x: r * Math.cos(a), y: r * Math.sin(a) }
    })
    layout.current = {
      cx: (el.clientWidth - c) / 2,
      cy: (el.clientHeight - c) / 2,
      pos,
    }
    if (c !== card) setCard(c)
    draw()
  }, [items, card, draw])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(relayout)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-run when `loading` flips (the interactive container only mounts once loaded)
    // and when the layout inputs change.
  }, [relayout, loading])

  useEffect(() => {
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [])

  // Inertia loop — hoisted so it can self-schedule without a TDZ self-reference.
  function step() {
    const v = vel.current
    offset.current.x += v.x
    offset.current.y += v.y
    v.x *= FRICTION
    v.y *= FRICTION
    draw()
    if (Math.hypot(v.x, v.y) < 0.15) {
      raf.current = null
      return
    }
    raf.current = requestAnimationFrame(step)
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    moved.current = 0
    vel.current = { x: 0, y: 0 }
    last.current = { x: e.clientX, y: e.clientY }
    tapId.current =
      (e.target as HTMLElement).closest<HTMLElement>('[data-pid]')?.dataset.pid ?? null
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    const dx = e.clientX - last.current.x
    const dy = e.clientY - last.current.y
    last.current = { x: e.clientX, y: e.clientY }
    offset.current.x += dx
    offset.current.y += dy
    vel.current = { x: dx, y: dy }
    moved.current += Math.abs(dx) + Math.abs(dy)
    draw()
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture already gone */
    }
    if (moved.current < TAP_THRESHOLD && tapId.current) {
      onOpen(tapId.current)
      return
    }
    if (!reducedMotion() && Math.hypot(vel.current.x, vel.current.y) > 0.5) {
      raf.current = requestAnimationFrame(step)
    }
  }

  // Loading: a static grid of skeleton tiles (same CoverTile, zone-driven).
  if (loading) {
    return (
      <SkeletonZone>
        <div
          role="status"
          aria-busy
          aria-label="Loading playlists"
          className="grid size-full [grid-template-columns:repeat(auto-fill,minmax(116px,1fr))] gap-5 overflow-hidden p-4 sm:[grid-template-columns:repeat(auto-fill,minmax(148px,1fr))]"
        >
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className="aspect-square">
              <CoverTile />
            </div>
          ))}
        </div>
      </SkeletonZone>
    )
  }

  return (
    <>
      <div
        ref={containerRef}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="size-full cursor-grab touch-none select-none active:cursor-grabbing"
      >
        {/* Centre tiles render last so they sit on top of the outer ones they overlap. */}
        {items.map((item, i) => (
          <div
            key={item.id}
            ref={(el) => {
              tileEls.current[i] = el
            }}
            data-pid={item.id}
            style={{ width: card, height: card, zIndex: items.length - i, willChange: 'transform' }}
            className="absolute top-0 left-0 hover:z-[999]"
          >
            <CoverTile item={item} onDelete={onDelete} />
          </div>
        ))}
      </div>

      {/* Accessible equivalent: every playlist once, as real links. */}
      <ul className="sr-only">
        {items.map((item) => (
          <li key={item.id}>
            <Link to="/playlists/$playlistId" params={{ playlistId: item.id }}>
              {item.title} — {item.track_count} tracks
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

function CoverTile({ item, onDelete }: { item?: CoverItem; onDelete?: (id: string) => void }) {
  const ripple = useRipple()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const skeleton = useSkeletonZone()

  // Zone-driven (or item-less) skeleton: same square footprint as the real cover.
  if (skeleton || !item) return <Skeleton className="size-full rounded-md" />

  return (
    // Ripple host (transparent, same size); the whole TiltCard tilts as one card.
    <div className="group relative size-full" onPointerDown={ripple.onPointerDown}>
      <TiltCard className="overflow-hidden rounded-md shadow-md">
        {item.artwork_url ? (
          <img src={item.artwork_url} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <div className="bg-muted text-muted-foreground grid size-full place-items-center">
            <Music className="size-8" aria-hidden />
          </div>
        )}

        {/* Title, revealed on hover. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-sm font-medium text-white">{item.title}</p>
        </div>

        {/* Per-cover actions — never starts a pan (stopPropagation on pointer-down). */}
        <div
          className="absolute top-1 right-1 opacity-0 transition-opacity group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Actions for ${item.title}`}
                className="size-7 bg-black/40 text-white hover:bg-black/60 hover:text-white"
              >
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to="/playlists/$playlistId" params={{ playlistId: item.id }}>
                  Open / edit
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setConfirmOpen(true)}
              >
                <Trash2 className="mr-2 size-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete “{item.title}”?</AlertDialogTitle>
                <AlertDialogDescription>
                  The playlist is removed. The songs stay in your catalog, so re-importing them
                  later is instant.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete?.(item.id)}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Ripples ripples={ripple.ripples} onDone={ripple.remove} />
      </TiltCard>
    </div>
  )
}
