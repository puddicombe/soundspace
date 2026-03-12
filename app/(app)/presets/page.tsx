'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import type { PresetConfig } from '@/lib/validations/preset'

interface Preset {
  id: string
  name: string
  config: PresetConfig
  shareSlug: string | null
  createdAt: string
}

export default function PresetsPage() {
  const router = useRouter()
  const [presets, setPresets] = useState<Preset[]>([])

  useEffect(() => {
    fetch('/api/presets').then((r) => r.json()).then(setPresets).catch(console.error)
  }, [])

  async function handleDelete(id: string) {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  // Pass the preset's config to the visualiser via URL search param.
  // The main page reads ?config=<encoded-json> on mount to apply it.
  function handleLoad(preset: Preset) {
    const encoded = encodeURIComponent(JSON.stringify(preset.config))
    router.push(`/?config=${encoded}`)
  }

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">My Presets</h1>
          <Link href="/">
            <Button variant="ghost">← Visualiser</Button>
          </Link>
        </div>
        {presets.length === 0 && (
          <p className="text-gray-400 text-center py-16">No presets saved yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
              <div className="flex-1">
                <p className="text-white font-medium">{preset.name}</p>
                <p className="text-gray-500 text-xs">{preset.config.type} · {preset.config.colorScheme}</p>
              </div>
              <Button variant="ghost" onClick={() => handleLoad(preset)}>Load</Button>
              <Button variant="ghost" onClick={() => handleDelete(preset.id)} className="text-red-400">Delete</Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
