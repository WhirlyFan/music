import { useEffect, useRef } from 'react'

const BUFFER = 600 // canvas drawing buffer; radii below are fractions of it
const BARS = 80
const INNER = 0.4 // ring starts here (just outside the artwork)
const MAX_LEN = 0.085 // max bar length, fraction of buffer

/**
 * A circular audio-reactive ring drawn around the artwork from live frequency
 * data. Absolutely positioned to fill its (relative) parent, behind the cover.
 * Animates only while mounted (full-screen open) and respects reduced motion.
 */
export function AudioVisualizer({ analyser }: { analyser: AnalyserNode | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !analyser) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const bins = analyser.frequencyBinCount
    const data = new Uint8Array(bins)
    const color = getComputedStyle(canvas).color // resolves text-primary → rgb()
    const c = BUFFER / 2
    let raf = 0

    const draw = () => {
      analyser.getByteFrequencyData(data)
      ctx.clearRect(0, 0, BUFFER, BUFFER)
      ctx.strokeStyle = color
      ctx.lineCap = 'round'
      ctx.lineWidth = BUFFER * 0.007
      for (let i = 0; i < BARS; i++) {
        // Sample the lower ~70% of bins (where musical energy lives).
        const amp = data[Math.floor((i / BARS) * bins * 0.7)] / 255
        const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const r1 = BUFFER * INNER
        const r2 = r1 + BUFFER * MAX_LEN * amp
        ctx.globalAlpha = 0.35 + amp * 0.65
        ctx.beginPath()
        ctx.moveTo(c + cos * r1, c + sin * r1)
        ctx.lineTo(c + cos * r2, c + sin * r2)
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
