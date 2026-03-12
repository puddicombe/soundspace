'use client'
import { useState } from 'react'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import type { PresetConfig } from '@/lib/validations/preset'

const DEFAULT_CONFIG: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.2,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: true,
}

export default function VisualizerPage() {
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_CONFIG)
  return <VisualizerCanvas config={config} onConfigChange={setConfig} />
}
