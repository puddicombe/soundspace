'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { PresetConfig } from '@/lib/validations/preset'

interface Preset {
  id: string
  name: string
  config: PresetConfig
  shareSlug: string | null
  isPublic: boolean
}

interface Props {
  currentConfig: PresetConfig
  onLoad: (config: PresetConfig) => void
  onClose: () => void
  mode: 'list' | 'save'
}

export function PresetManager({ currentConfig, onLoad, onClose, mode }: Props) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [saveName, setSaveName] = useState('')
  const [shareInfo, setShareInfo] = useState<{ id: string; url: string } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then(setPresets)
      .catch(console.error)
  }, [])

  async function handleSave() {
    if (!saveName.trim()) return
    setLoading(true)
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: saveName.trim(), config: currentConfig }),
    })
    if (res.ok) {
      const newPreset = await res.json()
      setPresets((prev) => [newPreset, ...prev])
    }
    setSaveName('')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    if (res.ok || res.status === 404) {
      setPresets((prev) => prev.filter((p) => p.id !== id))
    }
  }

  async function handleShare(id: string) {
    setShareInfo(null)
    const res = await fetch(`/api/presets/${id}/share`, { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    setShareInfo({ id, url: data.url })
  }

  if (mode === 'save') {
    return (
      <Modal title="Save preset" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Input
            label="Preset name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="My awesome preset"
            maxLength={80}
          />
          <Button onClick={handleSave} disabled={loading || !saveName.trim()}>
            {loading ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="My presets" onClose={onClose}>
      <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
        {presets.length === 0 && <p className="text-gray-400 text-sm text-center">No presets yet.</p>}
        {presets.map((preset) => (
          <div key={preset.id} className="flex flex-col bg-white/5 rounded px-3 py-2 gap-1">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-white text-sm truncate">{preset.name}</span>
              <button onClick={() => { onLoad(preset.config); onClose() }} className="text-cyan-400 hover:text-cyan-300 text-xs">Load</button>
              <button onClick={() => handleShare(preset.id)} className="text-gray-400 hover:text-white text-xs">Share</button>
              <button onClick={() => handleDelete(preset.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
            </div>
            {shareInfo?.id === preset.id && (
              <p className="text-cyan-400 text-xs break-all">{shareInfo.url}</p>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
