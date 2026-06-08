import { useEffect, useRef } from 'react'

import { prefersReducedMotion } from '@/lib/reduced-motion'

// All geometry is in canvas-buffer units; the canvas scales to fill its parent.
const BUFFER = 600
const POINTS = 160 // perimeter samples the wave is drawn through
const HALF = BUFFER * 0.25 // artwork half-size — must match the <img> size in the layout
// BASE == AMP: valleys glide smoothly down to the border (offset 0) via the tanh
// curve instead of slamming into a hard floor, and peaks soft-limit at 2·AMP via
// tanh — so neither end ever forms a flat plateau that "tears" against the curve.
const BASE = BUFFER * 0.08 // resting ring offset (= AMP)
const AMP = BUFFER * 0.08 // half the border→peak span
const MAX = BUFFER * 0.18 // safety ceiling only; tanh already soft-limits well below this
const GAIN = 2.0 // pre-emphasis before a soft clip → peaks pop, quiet stays calm
// Attack/release envelope (NOT a spring — no momentum, so it can't overshoot or
// wobble). Peaks/valleys form quickly (attack); they relax slowly (release) so the
// whole thing moves like something thick and viscous.
const PRE = 0.28 // temporal low-pass on the input → de-crunch the scrolling waveform
const ATTACK = 0.18 // how fast it reaches a new peak/valley (lower = smoother)
const RELEASE = 0.045 // how slowly it settles back → thickness
const BANDS = 5 // colors sampled top→bottom for the artwork gradient

type Pt = { px: number; py: number; nx: number; ny: number }
type Sampled = { palette: string[]; glow: string }

/** Evenly-spaced points around the square cover's perimeter (perimeter order),
 * each with its outward edge normal. Constant. */
const PERIM: Pt[] = (() => {
  const c = BUFFER / 2
  const per = POINTS / 4
  const pts: Pt[] = []
  const at = (k: number) => -HALF + 2 * HALF * ((k + 0.5) / per)
  for (let k = 0; k < per; k++) pts.push({ px: c + at(k), py: c - HALF, nx: 0, ny: -1 }) // top
  for (let k = 0; k < per; k++) pts.push({ px: c + HALF, py: c + at(k), nx: 1, ny: 0 }) // right
  for (let k = 0; k < per; k++) pts.push({ px: c - at(k), py: c + HALF, nx: 0, ny: 1 }) // bottom
  for (let k = 0; k < per; k++) pts.push({ px: c - HALF, py: c - at(k), nx: -1, ny: 0 }) // left
  return pts
})()

/** Derive a vertical color palette + an average (for the glow) from the artwork.
 *  Returns null if the image is cross-origin without CORS (canvas tainted). */
function sampleArtwork(img: HTMLImageElement): Sampled | null {
  const W = 120
  const off = document.createElement('canvas')
  off.width = W
  off.height = W
  const octx = off.getContext('2d', { willReadFrequently: true })
  if (!octx) return null
  octx.drawImage(img, 0, 0, W, W)
  let px: Uint8ClampedArray
  try {
    px = octx.getImageData(0, 0, W, W).data
  } catch {
    return null // tainted — no CORS
  }
  const palette: string[] = []
  let tr = 0
  let tg = 0
  let tb = 0
  let tn = 0
  for (let b = 0; b < BANDS; b++) {
    const y0 = Math.floor((b / BANDS) * W)
    const y1 = Math.floor(((b + 1) / BANDS) * W)
    let r = 0
    let g = 0
    let bl = 0
    let n = 0
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x += 3) {
        const o = (y * W + x) * 4
        r += px[o]
        g += px[o + 1]
        bl += px[o + 2]
        n++
      }
    }
    palette.push(`rgb(${(r / n) | 0}, ${(g / n) | 0}, ${(bl / n) | 0})`)
    tr += r
    tg += g
    tb += bl
    tn += n
  }
  return { palette, glow: `rgb(${(tr / tn) | 0}, ${(tg / tn) | 0}, ${(tb / tn) | 0})` }
}

/**
 * A filled halo around the square cover that reacts to the music. The shape is
 * the live BASS waveform (the analyser is low-passed) wrapped around the ring —
 * peaks/valleys land where the music puts them, not at assigned positions —
 * smoothed spatially + over time so it undulates rather than jitters. The halo is
 * filled with a single linear gradient derived from the artwork (a vertical
 * palette), and a CSS drop-shadow glow swells with loudness. The cover (on top)
 * hides the inner edge, leaving the halo. Animates only while mounted; respects
 * reduced motion; falls back to the accent color.
 */
export function AudioVisualizer({
  analyser,
  artworkUrl,
}: {
  analyser: AnalyserNode | null
  artworkUrl?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampledRef = useRef<Sampled | null>(null)
  const glowRef = useRef<string | null>(null)

  useEffect(() => {
    sampledRef.current = null
    glowRef.current = null
    if (!artworkUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const s = sampleArtwork(img)
      sampledRef.current = s
      glowRef.current = s?.glow ?? null
    }
    img.src = artworkUrl
    return () => {
      img.onload = null
    }
  }, [artworkUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser) return
    if (prefersReducedMotion()) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const c = BUFFER / 2
    const samples = analyser.fftSize
    const data = new Uint8Array(samples)
    const fallback = getComputedStyle(canvas).color // text-primary → rgb()
    const buf = new Float32Array(POINTS) // current offset per point
    const pre = new Float32Array(POINTS) // temporally pre-smoothed input
    const raw = new Float32Array(POINTS)
    let gradient: CanvasGradient | null = null
    let gradientFor: Sampled | null = null
    let raf = 0

    // One cohesive vertical gradient built from the artwork palette (fills the
    // whole halo — not the cover's literal edge pixels).
    const artGradient = () => {
      const s = sampledRef.current
      if (!s) return null
      if (gradient && gradientFor === s) return gradient
      const span = HALF + MAX
      const g = ctx.createLinearGradient(0, c - span, 0, c + span)
      s.palette.forEach((col, i) => g.addColorStop(i / (s.palette.length - 1), col))
      gradient = g
      gradientFor = s
      return g
    }

    const draw = () => {
      // The bass waveform itself IS the shape — peaks/valleys land where the music
      // puts them, not at assigned positions. Flat (a thin ring) when silent.
      analyser.getByteTimeDomainData(data)
      for (let i = 0; i < POINTS; i++) {
        raw[i] = (data[Math.floor((i / POINTS) * samples)] - 128) / 128 // -1..1
      }

      let energy = 0
      const ox = new Float32Array(POINTS)
      const oy = new Float32Array(POINTS)
      for (let i = 0; i < POINTS; i++) {
        // 7-tap spatial smoothing (wrapped) + temporal easing → undulates, not jitters
        const sm =
          (raw[(i - 3 + POINTS) % POINTS] +
            raw[(i - 2 + POINTS) % POINTS] +
            raw[(i - 1 + POINTS) % POINTS] +
            raw[i] +
            raw[(i + 1) % POINTS] +
            raw[(i + 2) % POINTS] +
            raw[(i + 3) % POINTS]) /
          7
        pre[i] += (sm - pre[i]) * PRE // temporal low-pass → smooth, not crunchy
        const target = Math.tanh(pre[i] * GAIN) // pre-emphasis → expressive, soft-clipped peaks
        // Move toward the target with no momentum (so it can't overshoot/wobble):
        // fast when growing a peak/valley, slow when relaxing → thick + viscous.
        const rate = Math.abs(target) > Math.abs(buf[i]) ? ATTACK : RELEASE
        buf[i] += (target - buf[i]) * rate
        energy += Math.abs(buf[i])
        // Clamp: never dip past the cover's border (≥ 0), and cap the stretch (≤ MAX).
        const off = Math.max(0, Math.min(MAX, BASE + buf[i] * AMP))
        ox[i] = PERIM[i].px + PERIM[i].nx * off
        oy[i] = PERIM[i].py + PERIM[i].ny * off
      }
      energy /= POINTS

      ctx.clearRect(0, 0, BUFFER, BUFFER)
      ctx.globalAlpha = 1
      ctx.fillStyle = artGradient() ?? fallback
      ctx.beginPath()
      // Smooth closed curve through the points (quadratic via segment midpoints).
      ctx.moveTo((ox[POINTS - 1] + ox[0]) / 2, (oy[POINTS - 1] + oy[0]) / 2)
      for (let i = 0; i < POINTS; i++) {
        const n = (i + 1) % POINTS
        ctx.quadraticCurveTo(ox[i], oy[i], (ox[i] + ox[n]) / 2, (oy[i] + oy[n]) / 2)
      }
      ctx.closePath()
      ctx.fill()

      // Glow swells with overall energy (cheap GPU drop-shadow, set imperatively).
      canvas.style.filter = `drop-shadow(0 0 ${10 + energy * 70}px ${glowRef.current ?? fallback})`
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [analyser])

  return (
    <canvas
      ref={canvasRef}
      width={BUFFER}
      height={BUFFER}
      aria-hidden
      className="text-primary pointer-events-none absolute inset-0 size-full"
    />
  )
}
