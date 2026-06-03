import { useEffect, useRef } from 'react'

// All geometry is in canvas-buffer units; the canvas scales to fill its parent.
const BUFFER = 600
const POINTS = 200 // perimeter samples (50 per edge) — the wave is drawn through these
const HALF = BUFFER * 0.3 // artwork half-size — must match the <img> size in the layout
const AMP = BUFFER * 0.06 // peak wave height (out) / valley depth (in, behind the cover)

type Pt = { px: number; py: number; nx: number; ny: number }

/** Evenly-spaced points around the square cover's perimeter (in perimeter order
 * so the wave flows continuously), each with its outward edge normal. Constant. */
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

/** Sample one artwork color per perimeter point (just inside the edge). Returns
 *  null if the image is cross-origin without CORS (canvas tainted) — caller falls back. */
function sampleColors(img: HTMLImageElement): string[] | null {
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
  return PERIM.map((p) => {
    const sx = p.px - p.nx * AMP * 0.4 // step inward to land on the cover
    const sy = p.py - p.ny * AMP * 0.4
    const ix = Math.round(((sx - (c - HALF)) / (2 * HALF)) * W)
    const iy = Math.round(((sy - (c - HALF)) / (2 * HALF)) * W)
    const cx = Math.min(W - 1, Math.max(0, ix))
    const cy = Math.min(W - 1, Math.max(0, iy))
    const o = (cy * W + cx) * 4
    return `rgb(${px[o]}, ${px[o + 1]}, ${px[o + 2]})`
  })
}

/**
 * An audio-reactive WAVE hugging the square artwork's outline: the live time-
 * domain waveform (a real oscilloscope signal) is wrapped around the perimeter,
 * peaking outward and dipping behind the cover. Tinted by the cover's own edge
 * colors so it looks like the art rippling outward. Animates only while mounted
 * (full-screen open); respects reduced motion; falls back to the accent color
 * when the artwork can't be sampled (cross-origin without CORS).
 */
export function AudioVisualizer({
  analyser,
  artworkUrl,
}: {
  analyser: AnalyserNode | null
  artworkUrl?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const colorsRef = useRef<string[] | null>(null)

  // Sample the cover's colors once it loads (CORS-permitting).
  useEffect(() => {
    colorsRef.current = null
    if (!artworkUrl) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      colorsRef.current = sampleColors(img)
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

    const samples = analyser.fftSize // time-domain length
    const data = new Uint8Array(samples)
    const fallback = getComputedStyle(canvas).color // text-primary → rgb()
    let raf = 0

    const draw = () => {
      analyser.getByteTimeDomainData(data) // 0..255, centered on 128 (silence)
      ctx.clearRect(0, 0, BUFFER, BUFFER)
      ctx.lineWidth = BUFFER * 0.01
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = 0.9
      const colors = colorsRef.current

      // Offset each perimeter point outward by the waveform's deflection there.
      const ox = new Float32Array(POINTS)
      const oy = new Float32Array(POINTS)
      for (let i = 0; i < POINTS; i++) {
        const v = (data[Math.floor((i / POINTS) * samples)] - 128) / 128 // -1..1
        const off = v * AMP
        ox[i] = PERIM[i].px + PERIM[i].nx * off
        oy[i] = PERIM[i].py + PERIM[i].ny * off
      }
      // Draw as short colored segments so the stroke carries the cover's gradient.
      for (let i = 0; i < POINTS; i++) {
        const j = (i + 1) % POINTS
        ctx.strokeStyle = colors ? colors[i] : fallback
        ctx.beginPath()
        ctx.moveTo(ox[i], oy[i])
        ctx.lineTo(ox[j], oy[j])
        ctx.stroke()
      }
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
