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

const GAP = 20
const FRICTION = 0.92
const TAP_THRESHOLD = 6 // px of movement below which a press counts as a tap
// Smaller covers on phones so a ~360px screen still shows a few per row.
const cardFor = (width: number) => (width < 640 ? 120 : 160)

const mod = (n: number, m: number) => ((n % m) + m) % m
const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Infinite, draggable wall of playlist covers. A fixed tile pool is laid out on
 * a torus and wrapped via modulo on a drag offset, so a handful of covers tile
 * endlessly in every direction (annnimate `infinite_draggable_grid` style).
 * Tiles are positioned purely with `transform: translate3d` mutated in a rAF
 * loop — they never re-render per frame.
 *
 * The visual wall is `aria-hidden`; an `sr-only` list of real links is rendered
 * alongside so keyboard / screen-reader users still get every playlist.
 *
 * While `loading`, it renders a static grid of skeleton tiles via the same
 * (zone-aware) `CoverTile` — no separate skeleton component to keep in sync.
 */
export function CoverWall({
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
  const [grid, setGrid] = useState({ cols: 0, rows: 0, card: 160, pitch: 180 })
  const gridRef = useRef(grid)

  const offset = useRef({ x: 0, y: 0 })
  const vel = useRef({ x: 0, y: 0 })
  const last = useRef({ x: 0, y: 0 })
  const moved = useRef(0)
  const dragging = useRef(false)
  const tapId = useRef<string | null>(null)
  const raf = useRef<number | null>(null)

  const draw = useCallback(() => {
    const { cols, rows, pitch } = gridRef.current
    if (!cols || !rows) return
    const worldW = cols * pitch
    const worldH = rows * pitch
    const { x: ox, y: oy } = offset.current
    for (let i = 0; i < cols * rows; i++) {
      const el = tileEls.current[i]
      if (!el) continue
      const c = i % cols
      const r = Math.floor(i / cols)
      const x = mod(c * pitch + ox, worldW) - pitch
      const y = mod(r * pitch + oy, worldH) - pitch
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
  }, [])

  // Inertia loop. A hoisted function so it can schedule itself without a
  // const TDZ self-reference; only reads refs, so a fresh closure is harmless.
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

  // Size the tile pool to the container (+ a one-cell ring for wrapping).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const card = cardFor(el.clientWidth)
      const pitch = card + GAP
      const cols = Math.ceil(el.clientWidth / pitch) + 2
      const rows = Math.ceil(el.clientHeight / pitch) + 2
      setGrid((prev) =>
        prev.cols === cols && prev.rows === rows && prev.card === card
          ? prev
          : { cols, rows, card, pitch },
      )
    })
    ro.observe(el)
    return () => ro.disconnect()
    // Re-run when `loading` flips: while loading we render the skeleton grid (no
    // container), so the observer must (re)attach once the interactive tree —
    // and its containerRef — actually mounts. Without this, a cold load directly
    // on /playlists never measures and the wall stays empty.
  }, [loading])

  // Redraw whenever the grid or the item pool changes.
  useEffect(() => {
    gridRef.current = grid
    draw()
  }, [grid, items, draw])

  useEffect(() => {
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [])

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

  const tileCount = grid.cols * grid.rows

  // Loading: a static grid of skeleton tiles (same CoverTile, zone-driven) —
  // no torus/drag machinery (the ResizeObserver effect no-ops without a container).
  if (loading) {
    return (
      <SkeletonZone>
        <div
          role="status"
          aria-busy
          aria-label="Loading playlists"
          className="grid size-full [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))] gap-5 overflow-hidden p-4 sm:[grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]"
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
        {Array.from({ length: tileCount }, (_, i) => {
          const item = items[i % items.length]
          return (
            <div
              key={i}
              ref={(el) => {
                tileEls.current[i] = el
              }}
              data-pid={item.id}
              style={{ width: grid.card, height: grid.card, willChange: 'transform' }}
              className="absolute top-0 left-0 hover:z-10"
            >
              <CoverTile item={item} onDelete={onDelete} />
            </div>
          )
        })}
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

  // Zone-driven skeleton: the same square footprint as the real cover, so the
  // placeholder can't drift. (No separate skeleton component.)
  if (skeleton || !item) return <Skeleton className="size-full rounded-md" />

  return (
    // Ripple host (transparent, same size); the whole TiltCard tilts as one card.
    <div className="group relative size-full" onPointerDown={ripple.onPointerDown}>
      <TiltCard className="overflow-hidden rounded-md shadow-sm">
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
