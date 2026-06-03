import { useCallback, useRef, useState } from 'react'

/**
 * Wire a Web Audio AnalyserNode onto the player's <audio> element so the
 * visualizer can read live frequency data. Call `connect()` on play (a user
 * gesture, so the AudioContext can resume).
 *
 * Safety: a MediaElementSource built from a CROSS-ORIGIN stream without CORS
 * headers routes silence through the graph — it would mute playback. So we only
 * tap same-origin audio and otherwise leave the analyser null (no visualizer,
 * audio untouched). One shared AudioContext is reused across tracks; a new source
 * is created per <audio> element (it remounts per track).
 */
export function useAudioAnalyser(audioRef: React.RefObject<HTMLAudioElement | null>) {
  const ctxRef = useRef<AudioContext | null>(null)
  const connectedRef = useRef<HTMLMediaElement | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)

  const connect = useCallback(() => {
    const el = audioRef.current
    if (!el || !el.currentSrc) return
    try {
      if (new URL(el.currentSrc).origin !== window.location.origin) return // cross-origin → skip
    } catch {
      return
    }
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    const ctx = ctxRef.current
    void ctx.resume()
    if (connectedRef.current === el) return // this element is already wired
    try {
      const source = ctx.createMediaElementSource(el)
      const node = ctx.createAnalyser()
      node.fftSize = 1024 // time-domain resolution for a smooth waveform
      source.connect(node)
      node.connect(ctx.destination) // keep audio audible
      connectedRef.current = el
      setAnalyser(node)
    } catch {
      // already connected / unsupported — leave the visualizer off, audio is fine
    }
  }, [audioRef])

  return { analyser, connect }
}
