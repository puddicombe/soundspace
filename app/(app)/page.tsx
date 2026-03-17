'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import { ControlPanel } from '@/components/controls/ControlPanel'
import { TypeBar, buildConfigForType, type VisualizerType } from '@/components/controls/TypeBar'
import { PresetManager, type HotkeyEntry, type HotkeyMap } from '@/components/controls/PresetManager'
import { presetConfigSchema, type PresetConfig } from '@/lib/validations/preset'

const DEFAULT_CONFIG: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.2,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: true,
}

const VISUALIZER_TYPES: VisualizerType[] = ['bars', 'waveform', 'spectrum', 'features', 'chords', 'plasma', 'trenchRun']
const HOTKEY_STORAGE_KEY = 'soundspace-preset-hotkeys'

type ModalMode = null | 'list' | 'save'

function loadHotkeyMap(): HotkeyMap {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(HOTKEY_STORAGE_KEY) ?? '{}') } catch { return {} }
}

export default function VisualizerPage() {
  const searchParams = useSearchParams()
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_CONFIG)
  const [modal, setModal] = useState<ModalMode>(null)
  const [hotkeyMap, setHotkeyMap] = useState<HotkeyMap>(loadHotkeyMap)

  // Load config from ?config= param (set by presets page Load button)
  useEffect(() => {
    const raw = searchParams.get('config')
    if (!raw) return
    try {
      const parsed = presetConfigSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
      if (parsed.success) setConfig(parsed.data)
    } catch { /* ignore malformed param */ }
  }, [searchParams])

  const handleTypeChange = useCallback((type: VisualizerType) => {
    setConfig(curr => buildConfigForType(type, curr))
  }, [])

  const handleSetHotkey = useCallback((key: string, entry: HotkeyEntry | null) => {
    setHotkeyMap(prev => {
      const next: HotkeyMap = {}
      // Remove any existing assignment of this preset or key slot
      for (const [k, v] of Object.entries(prev)) {
        if (k !== key && (!entry || v.presetId !== entry.presetId)) next[k] = v
      }
      if (entry) next[key] = entry
      localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // Global keyboard shortcuts: 1–5 for type, 6–9 for preset hotkeys
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const idx = parseInt(e.key) - 1
      if (idx >= 0 && idx < VISUALIZER_TYPES.length) {
        e.preventDefault()
        handleTypeChange(VISUALIZER_TYPES[idx])
      } else if (e.key >= '6' && e.key <= '9') {
        const entry = hotkeyMap[e.key]
        if (entry) { e.preventDefault(); setConfig(entry.config) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleTypeChange, hotkeyMap])

  return (
    <>
      <VisualizerCanvas config={config} />
      <TypeBar activeType={config.type as VisualizerType} onTypeChange={handleTypeChange} />
      <ControlPanel
        config={config}
        onConfigChange={setConfig}
        onSavePreset={() => setModal('save')}
        onOpenPresets={() => setModal('list')}
      />
      {modal && (
        <PresetManager
          currentConfig={config}
          onLoad={setConfig}
          onClose={() => setModal(null)}
          mode={modal}
          hotkeyMap={hotkeyMap}
          onSetHotkey={handleSetHotkey}
        />
      )}
    </>
  )
}
