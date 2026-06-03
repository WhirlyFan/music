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
    if (connectedRef.current === el) {
      void ctx.resume()
      return // this element is already wired
    }
    // Capture the element into the graph ONLY once the context is actually running.
    // Capturing into a suspended context routes playback into silence — so if it
    // can't resume we leave the element alone (it plays directly) and just skip the
    // visualizer. Playback is never sacrificed for the visualizer.
    void ctx.resume().then(() => {
      if (ctx.state !== 'running' || connectedRef.current === el) return
      try {
        const source = ctx.createMediaElementSource(el)
        source.connect(ctx.destination) // audible output: full-range, unaffected by the filter
        // Separate analysis branch, low-passed to the bass so the waveform tracks the
        // kick/bassline (slow, smooth) instead of jittery treble. The analyser needs
        // no onward connection to analyse.
        const lowpass = ctx.createBiquadFilter()
        lowpass.type = 'lowpass'
        lowpass.frequency.value = 150
        const node = ctx.createAnalyser()
        node.fftSize = 1024 // time-domain resolution for a smooth waveform
        source.connect(lowpass)
        lowpass.connect(node)
        connectedRef.current = el
        setAnalyser(node)
      } catch {
        // already connected / unsupported — leave the visualizer off, audio is fine
      }
    })
  }, [audioRef])

  return { analyser, connect }
}
