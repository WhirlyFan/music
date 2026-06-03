import { useEffect, useRef } from 'react'

// All geometry is in canvas-buffer units; the canvas scales to fill its parent.
const BUFFER = 600
const POINTS = 140 // perimeter samples (35 per edge) the wave is drawn through
const HALF = BUFFER * 0.25 // artwork half-size — must match the <img> size in the layout
const BASE = BUFFER * 0.03 // resting ring offset (peaks point out, valleys tuck behind)
const WAVES = 8 // distinct humps around the perimeter
const WAVES2 = 5 // a second traveling harmonic, for organic (non-mechanical) motion
const WAVE_MIN = BUFFER * 0.022 // wave size at silence (always visibly rippling)
const WAVE_EXTRA = BUFFER * 0.055 // extra wave size driven by the music
const TAU = Math.PI * 2

type Pt = { px: number; py: number; nx: number; ny: number }
type Sampled = { colors: string[]; glow: string }

/** Evenly-spaced points around the square cover's perimeter (perimeter order so
 * the wave flows continuously), each with its outward edge normal. Constant. */
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

/** Sample one artwork color per perimeter point (just inside the edge), plus an
 *  average for the glow. Returns null if the image is cross-origin without CORS
 *  (canvas tainted) — caller falls back to the accent color. */
function sampleColors(img: HTMLImageElement): Sampled | null {
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
  const c = BUFFER / 2
  const inset = HALF * 0.14
  let sr = 0
  let sg = 0
  let sb = 0
  const colors = PERIM.map((p) => {
    const sx = p.px - p.nx * inset
    const sy = p.py - p.ny * inset
    const ix = Math.round(((sx - (c - HALF)) / (2 * HALF)) * W)
    const iy = Math.round(((sy - (c - HALF)) / (2 * HALF)) * W)
    const cx = Math.min(W - 1, Math.max(0, ix))
    const cy = Math.min(W - 1, Math.max(0, iy))
    const o = (cy * W + cx) * 4
    sr += px[o]
    sg += px[o + 1]
    sb += px[o + 2]
    return `rgb(${px[o]}, ${px[o + 1]}, ${px[o + 2]})`
  })
  const n = colors.length
  return { colors, glow: `rgb(${(sr / n) | 0}, ${(sg / n) | 0}, ${(sb / n) | 0})` }
}

/**
 * A filled halo around the square cover that PULSES with the music. We read the
 * frequency spectrum (smoothed by the analyser) and drive a uniform breathing
 * motion from the bass — fast attack, slow release, so it pumps on the beat and
 * settles — plus a little per-edge frequency texture. Filled with a conic
 * gradient sampled from the cover's colors; a CSS drop-shadow glow pulses with
 * the same beat. The cover (on top) hides the inner fill, leaving the halo.
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
      const s = sampleColors(img)
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
    const lowCount = Math.max(2, Math.floor(bins * 0.22)) // bass + low-mid → the swell
    let env = 0 // smoothed energy, 0..1 → how big the waves get
    let phase = 0 // advances each frame → the waves travel around the cover
    let gradient: CanvasGradient | null = null
    let gradientFor: Sampled | null = null
    let raf = 0

    const conicGradient = () => {
      const s = sampledRef.current
      if (!s || typeof ctx.createConicGradient !== 'function') return null
      if (gradient && gradientFor === s) return gradient
      const g = ctx.createConicGradient(-Math.PI / 2, c, c)
      const stops = 36
      for (let i = 0; i <= stops; i++) {
        g.addColorStop(i / stops, s.colors[Math.floor((i / stops) * (s.colors.length - 1))])
      }
      gradient = g
      gradientFor = s
      return g
    }

    const draw = () => {
      analyser.getByteFrequencyData(data)

      // Energy (bass + low-mid) → how big the waves swell. Fast attack, slow release.
      let e = 0
      for (let i = 1; i <= lowCount; i++) e += data[i]
      e = e / lowCount / 255
      env += (e - env) * (e > env ? 0.4 : 0.08)
      phase += 0.018 + env * 0.05 // travels faster when louder
      const amp = WAVE_MIN + env * WAVE_EXTRA

      ctx.clearRect(0, 0, BUFFER, BUFFER)
      ctx.globalAlpha = 1
      ctx.fillStyle = conicGradient() ?? fallback
      ctx.beginPath()
      const ox = new Float32Array(POINTS)
      const oy = new Float32Array(POINTS)
      for (let i = 0; i < POINTS; i++) {
        const t = i / POINTS
        // Two traveling sine waves → distinct, organic, seamless humps that ripple.
        const w =
          0.6 * Math.sin(WAVES * t * TAU + phase) + 0.4 * Math.sin(WAVES2 * t * TAU - phase * 0.8)
        const off = BASE + w * amp
        ox[i] = PERIM[i].px + PERIM[i].nx * off
        oy[i] = PERIM[i].py + PERIM[i].ny * off
      }
      // Smooth closed curve through the points (quadratic via segment midpoints).
      ctx.moveTo((ox[POINTS - 1] + ox[0]) / 2, (oy[POINTS - 1] + oy[0]) / 2)
      for (let i = 0; i < POINTS; i++) {
        const n = (i + 1) % POINTS
        ctx.quadraticCurveTo(ox[i], oy[i], (ox[i] + ox[n]) / 2, (oy[i] + oy[n]) / 2)
      }
      ctx.closePath()
      ctx.fill()

      // Glow swells with the music (cheap GPU drop-shadow, set imperatively).
      canvas.style.filter = `drop-shadow(0 0 ${12 + env * 24}px ${glowRef.current ?? fallback})`
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
