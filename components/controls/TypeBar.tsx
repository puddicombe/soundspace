'use client'
import type { PresetConfig } from '@/lib/validations/preset'

const TYPES = ['bars', 'waveform', 'spectrum', 'features', 'chords', 'plasma', 'trenchRun'] as const
export type VisualizerType = typeof TYPES[number]

interface Props {
  activeType: VisualizerType
  onTypeChange: (type: VisualizerType) => void
}

export function TypeBar({ activeType, onTypeChange }: Props) {
  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-30 flex rounded overflow-hidden
                 border border-white/10 bg-black/70 backdrop-blur-sm select-none pointer-events-auto"
      style={{ fontFamily: '"Courier New", Courier, monospace' }}
    >
      {TYPES.map((t, i) => (
        <button
          key={t}
          onClick={() => onTypeChange(t)}
          className={`px-3 py-1.5 text-xs transition-colors border-r border-white/10 last:border-r-0 ${
            activeType === t
              ? 'bg-cyan-500/20 text-cyan-400'
              : 'text-white/35 hover:text-white/65 hover:bg-white/5'
          }`}
        >
          <span className="opacity-40 mr-1">[{i + 1}]</span>{t}
        </button>
      ))}
    </div>
  )
}

/** Build a valid PresetConfig when switching to a new type, preserving shared fields. */
export function buildConfigForType(type: VisualizerType, current: PresetConfig): PresetConfig {
  const base = { colorScheme: current.colorScheme, sensitivity: current.sensitivity }
  if (type === 'waveform') return { ...base, type: 'waveform', fftSize: current.fftSize }
  if (type === 'spectrum') {
    const fftSize = current.fftSize < 4096 ? 4096 : current.fftSize
    return { ...base, type: 'spectrum', fftSize } as PresetConfig
  }
  if (type === 'features' || type === 'chords') {
    const fftSize = current.fftSize < 2048 ? 2048 : current.fftSize
    return { ...base, type, fftSize } as PresetConfig
  }
  if (type === 'plasma') {
    const brightness   = current.type === 'plasma' ? current.brightness   : 1.0
    const dynamicRange = current.type === 'plasma' ? current.dynamicRange : 2.0
    return { ...base, type: 'plasma', fftSize: current.fftSize, brightness, dynamicRange } as PresetConfig
  }
  if (type === 'trenchRun') {
    const scrollSpeed      = current.type === 'trenchRun' ? current.scrollSpeed      : 1.0
    const bankIntensity    = current.type === 'trenchRun' ? current.bankIntensity    : 0.6
    const warpIntensity    = current.type === 'trenchRun' ? current.warpIntensity    : 0.5
    const gridDensity      = current.type === 'trenchRun' ? current.gridDensity      : 16
    const hudOpacity       = current.type === 'trenchRun' ? current.hudOpacity       : 0.9
    const scanRange        = current.type === 'trenchRun' ? current.scanRange        : 50
    const bankLateral      = current.type === 'trenchRun' ? current.bankLateral      : 0.7
    const missileRate      = current.type === 'trenchRun' ? current.missileRate      : 1.0
    const skyIntensity     = current.type === 'trenchRun' ? current.skyIntensity     : 1.0
    const battleIntensity  = current.type === 'trenchRun' ? current.battleIntensity  : 1.0
    return { ...base, type: 'trenchRun', fftSize: current.fftSize,
             scrollSpeed, bankIntensity, warpIntensity, gridDensity, hudOpacity, scanRange, bankLateral,
             missileRate, skyIntensity, battleIntensity } as PresetConfig
  }
  // bars
  return { ...base, type: 'bars', fftSize: current.fftSize, barCount: 64, mirrorBars: true }
}
