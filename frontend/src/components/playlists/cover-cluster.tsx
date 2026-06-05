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

// ── physics tuning ───────────────────────────────────────────────────────────
const SPRING = 0.006 // gentle centre pull → a slow, viscous drift/snapback
const DAMP = 0.84 // heavy velocity damping = thick, no glidey overshoot
const DAMP_CALM = 0.5 // snappier settle under prefers-reduced-motion
const COLLIDE_SOFT = 0.5 // ease overlaps apart over a few frames (no popping)
const SCALE_K = 0.18 // pop-in/out scale spring stiffness
const SCALE_DAMP = 0.62 // pop spring damping (a little overshoot = a "pop")
const CURRENT = 0.00015 // tangential "current" → a barely-there slow orbit of the cluster
const RADIUS_FACTOR = 0.7 // collision circle as a fraction of the card; min spacing 1.4×
// the card so even diagonal neighbours don't overlap
const TAP_THRESHOLD = 6 // px of pointer travel below which a press is a tap, not a drag
const REST_SPEED = 0.04 // below this (and nothing scaling/dragging) the loop idle-stops
const cardFor = (w: number) => (w < 640 ? 112 : 144)

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Integer (col,row) cells of a square spiral out from the centre (run lengths 1,1,2,2,3,3…
// turning right→down→left→up). Used as the *static* packed layout under reduced motion,
// where the physics is bypassed so nothing has to settle.
function spiralCells(n: number): { x: number; y: number }[] {
  const cells = [{ x: 0, y: 0 }]
  const dirs = [
    [1, 0],
    [0, 1],
    [-1, 0],
    [0, -1],
  ]
  let x = 0
  let y = 0
  let d = 0
  let run = 1
  while (cells.length < n) {
    for (let twice = 0; twice < 2; twice++) {
      for (let s = 0; s < run && cells.length < n; s++) {
        x += dirs[d][0]
        y += dirs[d][1]
        cells.push({ x, y })
      }
      d = (d + 1) % 4
    }
    run++
  }
  return cells
}

type Body = {
  id: string
  item: CoverItem
  x: number
  y: number
  vx: number
  vy: number
  scale: number // current render scale (0 = gone)
  sv: number // scale velocity (the pop spring)
  exiting: boolean // scaling out, then pruned
}

/**
 * A floating cluster of playlist covers under a centre-seeking "gravity" (à la Google
 * Gravity, but pulled to the middle and always upright). Each cover is a circular body:
 * a soft spring draws it to the centre, heavy damping makes the motion viscous, and
 * pairwise overlap resolution (positional + inelastic velocity) packs them without a
 * grid and without buzzing. Covers pop in (scale spring) on arrival and pop out on a
 * search filter / delete; the survivors re-settle toward the centre. Drag a cover to
 * fling it (slow viscous snapback); tap to open.
 *
 * Imperative by nature (like the audio visualizer): bodies live in refs, integrated in a
 * rAF loop defined inside an effect that writes each tile's transform directly. The only
 * React state is the render list, which the loop updates (async) when membership changes
 * — so nothing reads refs during render and no effect sets state synchronously. The loop
 * idle-stops at rest and re-arms (`wake`) on interaction / list change / resize.
 */
export function CoverCluster({
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
  const bodies = useRef(new Map<string, Body>())
  const els = useRef(new Map<string, HTMLDivElement>())
  const geom = useRef({ cx: 0, cy: 0, card: 144, r: 100, w: 0, h: 0 })
  const drag = useRef({ id: null as string | null, px: 0, py: 0, vx: 0, vy: 0, moved: 0 })
  const wakeRef = useRef<() => void>(() => {})
  const sigRef = useRef('') // signature of the currently-rendered body set
  const calm = useRef(reducedMotion())
  const [card, setCard] = useState(144)
  const [renderList, setRenderList] = useState<CoverItem[]>(() => items)

  const measure = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const c = cardFor(el.clientWidth)
    geom.current = {
      cx: el.clientWidth / 2,
      cy: el.clientHeight / 2,
      card: c,
      r: c * RADIUS_FACTOR,
      w: el.clientWidth,
      h: el.clientHeight,
    }
  }, [])

  // Physics loop — local closures inside the effect (self-reference is fine here, and
  // none of this runs during render). Reads/writes refs; only touches React state via the
  // membership sync below (async, so not a synchronous effect setState).
  useEffect(() => {
    let raf: number | null = null

    const stepOnce = () => {
      const g = geom.current
      const b = bodies.current
      const d = drag.current
      const arr = Array.from(b.values())
      const damp = calm.current ? DAMP_CALM : DAMP
      let maxSpeed = 0
      let busy = false // anything still scaling in/out
      // A slight current: with >1 cover, add a tangential nudge so the cluster slowly
      // orbits its centre (the covers rotate around each other). Off under reduced-motion.
      const swirl = !calm.current && arr.filter((x) => !x.exiting).length > 1

      // Forces: pop-scale spring (always) + centre spring + current (free, non-exiting).
      for (const body of arr) {
        const target = body.exiting ? 0 : 1
        if (calm.current) {
          // Reduced motion: snap scale (no pop), no bounce.
          body.scale = target
          body.sv = 0
        } else {
          body.sv += (target - body.scale) * SCALE_K
          body.sv *= SCALE_DAMP
          body.scale += body.sv
          if (Math.abs(target - body.scale) > 0.01 || Math.abs(body.sv) > 0.01) busy = true
        }

        if (body.id === d.id || body.exiting || calm.current) continue
        // (Reduced motion: positions are static slots set in reconcile — no spring,
        // current, or integration, so there's nothing to settle.)
        const dx = body.x - g.cx
        const dy = body.y - g.cy
        body.vx += -dx * SPRING
        body.vy += -dy * SPRING
        if (swirl) {
          body.vx += -dy * CURRENT // tangential (perpendicular to the radius) → gentle orbit
          body.vy += dx * CURRENT
        }
        body.vx *= damp
        body.vy *= damp
        body.x += body.vx
        body.y += body.vy
        maxSpeed = Math.max(maxSpeed, Math.abs(body.vx) + Math.abs(body.vy))
      }
      if (d.id) {
        const db = b.get(d.id)
        if (db) {
          db.x = d.px
          db.y = d.py
        }
      }

      // Overlap resolution: soft positional separation + an inelastic velocity response so
      // contacts absorb the spring's energy (this is what stops the buzzing). A pointer-
      // held body is immovable; it shoves the others. Radius scales with the pop so
      // entering/leaving covers don't fight for space.
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const A = arr[i]
            const B = arr[j]
            const minDist = g.r * (A.scale + B.scale)
            if (minDist <= 0) continue
            const dx = B.x - A.x
            const dy = B.y - A.y
            const dist = Math.hypot(dx, dy) || 0.01
            const overlap = minDist - dist
            if (overlap <= 0) continue
            const nx = dx / dist
            const ny = dy / dist
            const aFixed = A.id === d.id
            const bFixed = B.id === d.id
            const push = overlap * COLLIDE_SOFT
            if (aFixed && !bFixed) {
              B.x += nx * push
              B.y += ny * push
            } else if (bFixed && !aFixed) {
              A.x -= nx * push
              A.y -= ny * push
            } else if (!aFixed && !bFixed) {
              const h = push / 2
              A.x -= nx * h
              A.y -= ny * h
              B.x += nx * h
              B.y += ny * h
            }
            if (iter === 0) {
              const rvn = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny
              if (rvn < 0) {
                if (aFixed && !bFixed) {
                  B.vx -= rvn * nx
                  B.vy -= rvn * ny
                } else if (bFixed && !aFixed) {
                  A.vx += rvn * nx
                  A.vy += rvn * ny
                } else if (!aFixed && !bFixed) {
                  const k = rvn * 0.5
                  A.vx += k * nx
                  A.vy += k * ny
                  B.vx -= k * nx
                  B.vy -= k * ny
                }
              }
            }
          }
        }
      }

      // Keep everyone inside the viewport.
      for (const body of arr) {
        body.x = Math.max(g.r, Math.min(g.w - g.r, body.x))
        body.y = Math.max(g.r, Math.min(g.h - g.r, body.y))
      }

      // Prune fully-exited bodies.
      for (const body of arr) if (body.exiting && body.scale < 0.02) b.delete(body.id)

      // Sync the render list only when membership actually changes.
      const sig = Array.from(b.keys()).join(',')
      if (sig !== sigRef.current) {
        sigRef.current = sig
        setRenderList(Array.from(b.values()).map((x) => x.item))
      }

      // Write transforms (translate + pop scale).
      const half = g.card / 2
      for (const body of arr) {
        const el = els.current.get(body.id)
        if (el) {
          el.style.transform = `translate3d(${body.x - half}px, ${body.y - half}px, 0) scale(${body.scale})`
        }
      }
      return maxSpeed > REST_SPEED || busy || d.id !== null
    }

    const loop = () => {
      raf = stepOnce() ? requestAnimationFrame(loop) : null
    }
    const wake = () => {
      if (raf === null) raf = requestAnimationFrame(loop)
    }
    wakeRef.current = wake
    wake()
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  // Reconcile bodies to the item list: spawn newcomers near the centre at scale 0 (they
  // pop in + bloom out via collisions); flag departed ones to pop out (pruned by the loop
  // when their scale hits 0). No setState here — the loop owns the render list.
  useEffect(() => {
    measure()
    const g = geom.current
    const b = bodies.current
    const reduce = calm.current
    const want = new Set(items.map((i) => i.id))
    // Under reduced motion: a static packed layout (spiral slots) snapped into place — no
    // spawn-from-centre + settle. Otherwise: spawn near the centre and bloom out.
    const cells = reduce ? spiralCells(items.length) : []
    const pitch = g.r * 2
    items.forEach((it, i) => {
      let sx: number
      let sy: number
      if (reduce) {
        sx = g.cx + cells[i].x * pitch
        sy = g.cy + cells[i].y * pitch
      } else {
        const a = Math.random() * Math.PI * 2
        const rad = g.card * 0.3 * Math.random()
        sx = g.cx + Math.cos(a) * rad
        sy = g.cy + Math.sin(a) * rad
      }
      const ex = b.get(it.id)
      if (ex) {
        ex.item = it
        ex.exiting = false
        if (reduce) {
          // Snap to the static slot (no settling animation).
          ex.x = sx
          ex.y = sy
          ex.vx = 0
          ex.vy = 0
        }
      } else {
        b.set(it.id, {
          id: it.id,
          item: it,
          x: sx,
          y: sy,
          vx: 0,
          vy: 0,
          scale: reduce ? 1 : 0, // no pop-in under reduced motion
          sv: 0,
          exiting: false,
        })
      }
    })
    for (const body of Array.from(b.values())) if (!want.has(body.id)) body.exiting = true
    wakeRef.current()
  }, [items, measure])

  // Resize → re-measure, re-arm, and (async) update the rendered card size.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setCard(cardFor(el.clientWidth))
      measure()
      wakeRef.current()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, loading])

  // Keep the reduced-motion flag live (the OS setting can change at runtime).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      calm.current = mq.matches
      wakeRef.current()
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  function pointFromEvent(e: React.PointerEvent) {
    const el = containerRef.current
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const p = pointFromEvent(e)
    if (!p) return
    e.currentTarget.setPointerCapture(e.pointerId)
    let best: Body | null = null
    let bestD = Infinity
    for (const body of bodies.current.values()) {
      if (body.exiting) continue
      const dd = Math.hypot(body.x - p.x, body.y - p.y)
      if (dd < bestD) {
        bestD = dd
        best = body
      }
    }
    drag.current =
      best && bestD <= geom.current.r
        ? { id: best.id, px: p.x, py: p.y, vx: 0, vy: 0, moved: 0 }
        : { id: null, px: p.x, py: p.y, vx: 0, vy: 0, moved: 0 }
    wakeRef.current()
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d.id) return
    const p = pointFromEvent(e)
    if (!p) return
    d.vx = p.x - d.px
    d.vy = p.y - d.py
    d.moved += Math.abs(d.vx) + Math.abs(d.vy)
    d.px = p.x
    d.py = p.y
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    const d = drag.current
    if (d.id) {
      if (d.moved < TAP_THRESHOLD) {
        onOpen(d.id)
      } else if (!calm.current) {
        const body = bodies.current.get(d.id)
        if (body) {
          body.vx = d.vx
          body.vy = d.vy
        }
      }
    }
    drag.current = { id: null, px: 0, py: 0, vx: 0, vy: 0, moved: 0 }
    wakeRef.current()
  }

  if (loading) {
    return (
      <SkeletonZone>
        <div
          role="status"
          aria-busy
          aria-label="Loading playlists"
          className="grid size-full [grid-template-columns:repeat(auto-fill,minmax(112px,1fr))] gap-5 overflow-hidden p-4 sm:[grid-template-columns:repeat(auto-fill,minmax(144px,1fr))]"
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
        {renderList.map((item) => (
          <div
            key={item.id}
            ref={(el) => {
              if (el) els.current.set(item.id, el)
              else els.current.delete(item.id)
            }}
            // Start offscreen at scale 0; the loop positions + pops it in on the next frame.
            style={{
              width: card,
              height: card,
              transform: 'translate3d(-9999px,0,0) scale(0)',
              willChange: 'transform',
            }}
            className="absolute top-0 left-0 hover:z-10"
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

  if (skeleton || !item) return <Skeleton className="size-full rounded-md" />

  return (
    <div className="group relative size-full" onPointerDown={ripple.onPointerDown}>
      <TiltCard className="overflow-hidden rounded-md shadow-md">
        {item.artwork_url ? (
          <img src={item.artwork_url} alt="" draggable={false} className="size-full object-cover" />
        ) : (
          <div className="bg-muted text-muted-foreground grid size-full place-items-center">
            <Music className="size-8" aria-hidden />
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
          <p className="truncate text-sm font-medium text-white">{item.title}</p>
        </div>

        {/* Per-cover actions — stops the pointer so it never starts a drag. */}
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
