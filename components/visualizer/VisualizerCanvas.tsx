'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from './AudioEngine'
import { BarsRenderer } from './renderers/BarsRenderer'
import { WaveformRenderer } from './renderers/WaveformRenderer'
import { SpectrumRenderer } from './renderers/SpectrumRenderer'
import { FeaturesRenderer } from './renderers/FeaturesRenderer'
import { ChordsRenderer } from './renderers/ChordsRenderer'
import { PlasmaRenderer } from './renderers/PlasmaRenderer'
import { TrenchRunRenderer } from './renderers/TrenchRunRenderer'
import { ChordTestOverlay } from './ChordTestOverlay'
import type { BaseRenderer } from './renderers/BaseRenderer'
import type { AudioFeatures } from './AudioFeatures'
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig, PlasmaConfig, TrenchRunConfig } from '@/lib/validations/preset'

interface Props {
  config: PresetConfig
}

export function VisualizerCanvas({ config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glCanvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const rendererRef = useRef<BaseRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const [started, setStarted] = useState(false)
  const [micError, setMicError] = useState('')

  // Chord test overlay state — only updates React state when chord changes (~500ms intervals)
  const [chordTestVisible, setChordTestVisible] = useState(false)
  const [chordTestData, setChordTestData] = useState<{
    chord: string | null
    candidates: AudioFeatures['chordCandidates']
  }>({ chord: null, candidates: [] })
  const prevChordRef = useRef<string | null | undefined>(undefined)

  // Build renderer from config — WebGL renderers use a dedicated canvas to avoid
  // context-type conflicts (a canvas locked to '2d' cannot later serve 'webgl2')
  const buildRenderer = useCallback((cfg: PresetConfig): BaseRenderer => {
    const canvas = canvasRef.current!
    const glCanvas = glCanvasRef.current!
    if (cfg.type === 'bars') return new BarsRenderer(canvas, cfg)
    if (cfg.type === 'spectrum') return new SpectrumRenderer(canvas, cfg as SpectrumConfig)
    if (cfg.type === 'features') return new FeaturesRenderer(canvas, cfg as FeaturesConfig)
    if (cfg.type === 'chords') return new ChordsRenderer(canvas, cfg as ChordsConfig)
    if (cfg.type === 'plasma') return new PlasmaRenderer(glCanvas, cfg as PlasmaConfig)
    if (cfg.type === 'trenchRun') return new TrenchRunRenderer(glCanvas, cfg as TrenchRunConfig)
    return new WaveformRenderer(canvas, cfg)
  }, [])

  // Resize both canvases to fill window
  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      const glCanvas = glCanvasRef.current
      if (!canvas || !glCanvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      glCanvas.width = window.innerWidth
      glCanvas.height = window.innerHeight
      rendererRef.current?.resize(canvas.width, canvas.height)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Re-build renderer when config type, colorScheme, or bars-specific params change
  const barCount = config.type === 'bars' ? (config as BarsConfig).barCount : 0
  const mirrorBars = config.type === 'bars' ? (config as BarsConfig).mirrorBars : false
  const trenchGridDensity = config.type === 'trenchRun' ? (config as TrenchRunConfig).gridDensity : 0

  // Update trenchRun slider values in-place — no rebuild needed
  // MUST be declared before the rebuild effect (React runs effects in declaration order)
  useEffect(() => {
    if (config.type !== 'trenchRun') return
    const r = rendererRef.current as TrenchRunRenderer | null
    if (!r) return
    r.scrollSpeed     = (config as TrenchRunConfig).scrollSpeed
    r.bankIntensity   = (config as TrenchRunConfig).bankIntensity
    r.warpIntensity   = (config as TrenchRunConfig).warpIntensity
    r.hudOpacity      = (config as TrenchRunConfig).hudOpacity
    r.scanRange       = (config as TrenchRunConfig).scanRange ?? 50
    r.bankLateral     = (config as TrenchRunConfig).bankLateral ?? 0.7
    r.missileRate     = (config as TrenchRunConfig).missileRate ?? 1.0
    r.skyIntensity    = (config as TrenchRunConfig).skyIntensity ?? 1.0
    r.battleIntensity = (config as TrenchRunConfig).battleIntensity ?? 1.0
  }, [config])

  // Update plasma slider values in-place — no rebuild needed
  // MUST be declared before the rebuild effect (React runs effects in declaration order)
  useEffect(() => {
    if (config.type !== 'plasma') return
    const r = rendererRef.current as PlasmaRenderer | null
    if (!r) return
    r.brightness   = (config as PlasmaConfig).brightness
    r.dynamicRange = (config as PlasmaConfig).dynamicRange
  }, [config])

  useEffect(() => {
    if (!started || !canvasRef.current || !glCanvasRef.current) return
    rendererRef.current?.destroy()
    try {
      rendererRef.current = buildRenderer(config)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMicError(
        msg.includes('WebGL2')
          ? 'WebGL2 is not supported in this browser. Try Chrome or Firefox.'
          : `Failed to build renderer: ${msg}`
      )
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, config.colorScheme, barCount, mirrorBars, trenchGridDensity, started, buildRenderer])

  // Render loop
  useEffect(() => {
    if (!started) return
    function loop() {
      const engine = engineRef.current
      const renderer = rendererRef.current
      if (engine && renderer) {
        const fft = engine.getProcessedFFT()
        const wave = engine.getRawWaveform()
        const features = engine.getFeatures()
        renderer.render(fft, wave, features)
        // Feed chord test overlay — only trigger setState when chord changes
        if (features.chord !== prevChordRef.current) {
          prevChordRef.current = features.chord
          setChordTestData({ chord: features.chord, candidates: features.chordCandidates })
        }
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [started])

  // Restart engine when fftSize changes (requires full AudioContext teardown)
  useEffect(() => {
    if (!started || !engineRef.current) return
    engineRef.current.restart(config).catch(() => {
      setMicError('Microphone access lost after FFT size change.')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.fftSize])

  // Toggle chord test with 'T' key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 't' || e.key === 'T') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        setChordTestVisible(v => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function handleStart() {
    if (!canvasRef.current || !glCanvasRef.current) return
    try {
      const engine = new AudioEngine(config)
      await engine.start()
      engineRef.current = engine
      rendererRef.current = buildRenderer(config)
      setStarted(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setMicError(
        msg.includes('WebGL2')
          ? 'WebGL2 is not supported in this browser. Try Chrome or Firefox.'
          : 'Microphone access denied. Please allow mic access and refresh.'
      )
    }
  }

  const usesGl = config.type === 'plasma' || config.type === 'trenchRun'

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef}   className="absolute inset-0" style={{ display: usesGl ? 'none' : 'block' }} />
      <canvas ref={glCanvasRef} className="absolute inset-0" style={{ display: usesGl ? 'block' : 'none' }} />

      {!started && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer z-10"
          onClick={handleStart}
        >
          {micError ? (
            <p className="text-red-400 text-center px-8">{micError}</p>
          ) : (
            <>
              <div className="text-6xl mb-4 opacity-60">◉</div>
              <p className="text-white/60 text-lg">Click to start</p>
            </>
          )}
        </div>
      )}

      {/* Chord accuracy test — toggle with T key */}
      {chordTestVisible && started && (
        <ChordTestOverlay
          chord={chordTestData.chord}
          candidates={chordTestData.candidates}
          onClose={() => setChordTestVisible(false)}
        />
      )}

      {/* Hint shown briefly when audio starts */}
      {started && !chordTestVisible && (
        <div className="fixed bottom-4 left-4 text-white/20 text-xs pointer-events-none"
             style={{ fontFamily: '"Courier New", Courier, monospace' }}>
          press T for chord accuracy test
        </div>
      )}
    </div>
  )
}
