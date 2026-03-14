'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import type { PresetConfig } from '@/lib/validations/preset'

interface Props {
  presetId: string
  presetName: string
  config: PresetConfig
}

export function ShareVisualizerClient({ presetId, presetName, config }: Props) {
  const { data: session } = useSession()
  const router = useRouter()

  async function handleFork() {
    if (!session) {
      router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    const res = await fetch(`/api/presets/${presetId}/fork`, { method: 'POST' })
    if (res.ok) {
      router.push('/presets')
    }
  }

  return (
    <div className="relative">
      <VisualizerCanvas config={config} />

      {/* Read-only overlay header */}
      <div className="fixed top-4 left-4 z-20 flex items-center gap-3">
        <span className="text-white/60 text-sm bg-black/50 px-3 py-1 rounded-full">
          {presetName}
        </span>
        <button
          onClick={handleFork}
          className="text-sm bg-cyan-500 hover:bg-cyan-400 text-black px-3 py-1 rounded-full font-medium"
        >
          Fork
        </button>
      </div>
    </div>
  )
}
