'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import { ControlPanel } from '@/components/controls/ControlPanel'
import { PresetManager } from '@/components/controls/PresetManager'
import { presetConfigSchema, type PresetConfig } from '@/lib/validations/preset'

const DEFAULT_CONFIG: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.2,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: true,
}

type ModalMode = null | 'list' | 'save'

export default function VisualizerPage() {
  const searchParams = useSearchParams()
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_CONFIG)
  const [modal, setModal] = useState<ModalMode>(null)

  // Load config from ?config= param (set by presets page Load button)
  useEffect(() => {
    const raw = searchParams.get('config')
    if (!raw) return
    try {
      const parsed = presetConfigSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
      if (parsed.success) setConfig(parsed.data)
    } catch {
      // Ignore malformed param
    }
  }, [searchParams])

  return (
    <>
      <VisualizerCanvas config={config} />
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
        />
      )}
    </>
  )
}
