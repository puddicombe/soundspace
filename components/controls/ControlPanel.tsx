'use client'
import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig } from '@/lib/validations/preset'
import { COLOR_SCHEMES, FFT_SIZES } from '@/lib/validations/preset'

interface Props {
  config: PresetConfig
  onConfigChange: (config: PresetConfig) => void
  onSavePreset: () => void
  onOpenPresets: () => void
}

export function ControlPanel({ config, onConfigChange, onSavePreset, onOpenPresets }: Props) {
  const { data: session } = useSession()
  const [visible, setVisible] = useState(false)

  const isBars = config.type === 'bars'
  const barsConfig = config as BarsConfig

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setVisible((v) => !v)}
        className="fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
                   text-white flex items-center justify-center transition-opacity"
        title="Controls"
      >
        ⚙
      </button>

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-72 bg-black/90 border-l border-white/10 z-20
                   transform transition-transform duration-300 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-4 flex flex-col gap-5 overflow-y-auto h-full">
          <div className="flex items-center justify-between pt-2">
            <span className="text-white/60 text-sm">{session?.user.email}</span>
            <button onClick={() => signOut({ callbackUrl: '/signin' })} className="text-gray-400 hover:text-white text-sm">Sign out</button>
          </div>

          {/* Visualiser type */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">Type</label>
            <div className="flex gap-2">
              {(['bars', 'waveform', 'spectrum', 'features', 'chords'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    if (t === 'waveform') {
                      onConfigChange({ type: 'waveform', colorScheme: config.colorScheme, fftSize: config.fftSize, sensitivity: config.sensitivity })
                    } else if (t === 'spectrum') {
                      // Spectrum needs high FFT resolution for smooth log-scale display; use at least 4096
                      const fftSize = config.fftSize < 4096 ? 4096 : config.fftSize
                      onConfigChange({ type: 'spectrum', colorScheme: config.colorScheme, fftSize, sensitivity: config.sensitivity } as SpectrumConfig)
                    } else if (t === 'features') {
                      const fftSize = config.fftSize < 2048 ? 2048 : config.fftSize
                      onConfigChange({ type: 'features', colorScheme: config.colorScheme, fftSize, sensitivity: config.sensitivity } as FeaturesConfig)
                    } else if (t === 'chords') {
                      const fftSize = config.fftSize < 2048 ? 2048 : config.fftSize
                      onConfigChange({ type: 'chords', colorScheme: config.colorScheme, fftSize, sensitivity: config.sensitivity } as ChordsConfig)
                    } else {
                      onConfigChange({
                        type: 'bars', colorScheme: config.colorScheme, fftSize: config.fftSize,
                        barCount: 64, mirrorBars: true, sensitivity: config.sensitivity,
                      })
                    }
                  }}
                  className={`flex-1 py-1 rounded text-sm transition-colors ${
                    config.type === t ? 'bg-cyan-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Color scheme */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">Colour</label>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_SCHEMES.map((cs) => (
                <button
                  key={cs}
                  onClick={() => onConfigChange({ ...config, colorScheme: cs } as PresetConfig)}
                  className={`py-1 rounded text-sm transition-colors ${
                    config.colorScheme === cs ? 'bg-cyan-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {cs}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity — bars only */}
          {isBars && (
            <div className="flex flex-col gap-2">
              <label className="text-gray-400 text-xs uppercase tracking-wider">
                Sensitivity: {barsConfig.sensitivity.toFixed(1)}
              </label>
              <input
                type="range" min={0.5} max={3.0} step={0.1}
                value={barsConfig.sensitivity}
                onChange={(e) => onConfigChange({ ...barsConfig, sensitivity: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </div>
          )}

          {/* Bar count — bars only */}
          {isBars && (
            <div className="flex flex-col gap-2">
              <label className="text-gray-400 text-xs uppercase tracking-wider">
                Bars: {barsConfig.barCount}
              </label>
              <input
                type="range" min={32} max={128} step={8}
                value={barsConfig.barCount}
                onChange={(e) => onConfigChange({ ...barsConfig, barCount: parseInt(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </div>
          )}

          {/* Mirror — bars only */}
          {isBars && (
            <div className="flex items-center justify-between">
              <label className="text-gray-400 text-xs uppercase tracking-wider">Mirror</label>
              <button
                onClick={() => onConfigChange({ ...barsConfig, mirrorBars: !barsConfig.mirrorBars })}
                className={`w-10 h-5 rounded-full transition-colors ${
                  barsConfig.mirrorBars ? 'bg-cyan-500' : 'bg-white/20'
                }`}
              />
            </div>
          )}

          {/* FFT size */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">FFT Size</label>
            <select
              value={config.fftSize}
              onChange={(e) => onConfigChange({ ...config, fftSize: parseInt(e.target.value) as 512 | 1024 | 2048 | 4096 } as PresetConfig)}
              className="bg-white/10 text-white rounded px-2 py-1 text-sm"
            >
              {FFT_SIZES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Preset actions */}
          <div className="flex flex-col gap-2 mt-auto pb-4">
            <button onClick={onSavePreset} className="bg-cyan-500 hover:bg-cyan-400 text-black rounded py-2 text-sm font-medium">
              Save as preset
            </button>
            <button onClick={onOpenPresets} className="bg-white/10 hover:bg-white/20 text-white rounded py-2 text-sm">
              My presets
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
