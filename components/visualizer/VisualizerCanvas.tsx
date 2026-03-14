'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from './AudioEngine'
import { BarsRenderer } from './renderers/BarsRenderer'
import { WaveformRenderer } from './renderers/WaveformRenderer'
import type { BaseRenderer } from './renderers/BaseRenderer'
import type { PresetConfig } from '@/lib/validations/preset'

interface Props {
  config: PresetConfig
}

export function VisualizerCanvas({ config }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const rendererRef = useRef<BaseRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const [started, setStarted] = useState(false)
  const [micError, setMicError] = useState('')

  // Build renderer from config
  const buildRenderer = useCallback((canvas: HTMLCanvasElement, cfg: PresetConfig): BaseRenderer => {
    if (cfg.type === 'bars') return new BarsRenderer(canvas, cfg)
    return new WaveformRenderer(canvas, cfg)
  }, [])

  // Resize canvas to fill window
  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      rendererRef.current?.resize(canvas.width, canvas.height)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Re-build renderer when config type or colorScheme changes (hot-swap)
  // Only type and colorScheme changes warrant a new renderer instance.
  // barCount, mirrorBars, sensitivity are passed per-frame and need no rebuild.
  useEffect(() => {
    if (!started || !canvasRef.current) return
    const canvas = canvasRef.current
    rendererRef.current?.destroy()
    rendererRef.current = buildRenderer(canvas, config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, config.colorScheme, started, buildRenderer])

  // Render loop
  useEffect(() => {
    if (!started) return
    function loop() {
      const engine = engineRef.current
      const renderer = rendererRef.current
      if (engine && renderer) {
        renderer.render(engine.getProcessedFFT(), engine.getRawWaveform())
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

  async function handleStart() {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const engine = new AudioEngine(config)
      await engine.start()
      engineRef.current = engine
      rendererRef.current = buildRenderer(canvas, config)
      setStarted(true)
    } catch {
      setMicError('Microphone access denied. Please allow mic access and refresh.')
    }
  }

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />

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
    </div>
  )
}
