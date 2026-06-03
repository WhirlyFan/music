import { useEffect, useRef } from 'react'

// All geometry is in canvas-buffer units; the canvas scales to fill its parent.
const BUFFER = 600
const POINTS = 160 // perimeter samples the wave is drawn through
const HALF = BUFFER * 0.25 // artwork half-size — must match the <img> size in the layout
const BASE = BUFFER * 0.025 // thin resting ring (stays still when there's no sound)
const AMP = BUFFER * 0.11 // how far a hump pushes out at full energy
const LOBES = 6 // humps spread around the ring, each driven by a different frequency band
const SPEC = 0.6 // fraction of the spectrum used (skip the empty highs)
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
 * A filled halo around the square cover that reacts to the music. The spectrum is
 * split into LOBES bands; each band drives one smooth hump, spread around the
 * ring — so different regions move to different parts of the music (no autonomous
 * animation; still when silent). The halo is filled with a single linear gradient
 * derived from the artwork (a vertical palette), and a CSS drop-shadow glow swells
 * with loudness. The cover (on top) hides the inner fill, leaving the halo.
 * Animates only while mounted; respects reduced motion; falls back to the accent.
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
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const c = BUFFER / 2
    const bins = analyser.frequencyBinCount
    const data = new Uint8Array(bins)
    const fallback = getComputedStyle(canvas).color // text-primary → rgb()
    const useBins = Math.max(LOBES * 2, Math.floor(bins * SPEC))
    const lobe = new Float32Array(LOBES) // eased per-band amplitude (temporal smoothing)
    let gradient: CanvasGradient | null = null
    let gradientFor: Sampled | null = null
    let raf = 0

    // A vertical linear gradient built from the artwork palette — one cohesive
    // gradient across the whole halo (not the cover's literal edge pixels).
    const artGradient = () => {
      const s = sampledRef.current
      if (!s) return null
      if (gradient && gradientFor === s) return gradient
      const span = HALF + BASE + AMP
      const g = ctx.createLinearGradient(0, c - span, 0, c + span)
      s.palette.forEach((col, i) => g.addColorStop(i / (s.palette.length - 1), col))
      gradient = g
      gradientFor = s
      return g
    }

    const draw = () => {
      analyser.getByteFrequencyData(data)

      // Each lobe = one frequency band; weight up the highs (which carry less
      // energy) so lobes move comparably rather than all following the bass.
      for (let j = 0; j < LOBES; j++) {
        const b0 = 1 + Math.floor((j / LOBES) * useBins)
        const b1 = 1 + Math.floor(((j + 1) / LOBES) * useBins)
        let e = 0
        for (let b = b0; b < b1; b++) e += data[b]
        e = e / Math.max(1, b1 - b0) / 255
        const weight = 1 + 1.5 * (j / (LOBES - 1))
        const target = Math.min(1, e * weight)
        lobe[j] += (target - lobe[j]) * 0.25 // temporal easing
      }

      let energy = 0
      const ox = new Float32Array(POINTS)
      const oy = new Float32Array(POINTS)
      for (let i = 0; i < POINTS; i++) {
        const t = (i / POINTS) * LOBES
        const which = Math.floor(t) % LOBES
        const bump = Math.sin((t % 1) * Math.PI) // 0..1..0 smooth hump within the lobe
        const a = bump * lobe[which]
        energy += a
        const off = BASE + a * AMP
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
