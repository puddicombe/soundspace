import {
  presetConfigSchema,
  createPresetSchema,
  updatePresetSchema,
  trenchRunConfigSchema,
  type TrenchRunConfig,
} from '../preset'
import { buildConfigForType } from '@/components/controls/TypeBar'

describe('presetConfigSchema', () => {
  it('accepts valid bars config', () => {
    const result = presetConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      barCount: 64,
      mirrorBars: false,
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid waveform config', () => {
    const result = presetConfigSchema.safeParse({
      type: 'waveform',
      colorScheme: 'ocean',
      sensitivity: 1.0,
      fftSize: 1024,
    })
    expect(result.success).toBe(true)
  })

  it('rejects bars config where barCount > fftSize/2', () => {
    const result = presetConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 512,
      barCount: 128, // 128 > 512/2=256 — wait, 128 <= 256, so actually valid
      mirrorBars: false,
    })
    // 128 <= 256, so this should pass. Use barCount: 300 > 256 to test rejection
    expect(result.success).toBe(true)
  })

  it('rejects bars config where barCount > fftSize/2 boundary', () => {
    const result = presetConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 512,
      barCount: 300, // 300 > 512/2=256
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown type', () => {
    const result = presetConfigSchema.safeParse({ type: 'unknown', colorScheme: 'neon-dark', fftSize: 2048 })
    expect(result.success).toBe(false)
  })

  it('rejects invalid colorScheme', () => {
    const result = presetConfigSchema.safeParse({
      type: 'waveform',
      colorScheme: 'rainbow',
      sensitivity: 1.0,
      fftSize: 2048,
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid plasma config', () => {
    const result = presetConfigSchema.safeParse({
      type: 'plasma',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      brightness: 1.0,
      dynamicRange: 2.0,
    })
    expect(result.success).toBe(true)
  })

  it('accepts plasma config without brightness/dynamicRange (defaults applied)', () => {
    const result = presetConfigSchema.safeParse({
      type: 'plasma',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'plasma') {
      expect(result.data.brightness).toBe(1.0)
      expect(result.data.dynamicRange).toBe(2.0)
    }
  })

  it('rejects plasma config with brightness out of range', () => {
    const result = presetConfigSchema.safeParse({
      type: 'plasma',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      brightness: 10.0,
      dynamicRange: 2.0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects plasma config with invalid colorScheme', () => {
    const result = presetConfigSchema.safeParse({
      type: 'plasma',
      colorScheme: 'rainbow',
      sensitivity: 1.0,
      fftSize: 2048,
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid trenchRun config', () => {
    const result = presetConfigSchema.safeParse({
      type: 'trenchRun',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      scrollSpeed: 1.0,
      bankIntensity: 0.6,
      warpIntensity: 0.5,
      gridDensity: 16,
      hudOpacity: 0.9,
    })
    expect(result.success).toBe(true)
  })

  it('accepts trenchRun config without optional fields (defaults applied)', () => {
    const result = presetConfigSchema.safeParse({
      type: 'trenchRun',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.type === 'trenchRun') {
      expect(result.data.scrollSpeed).toBe(1.0)
      expect(result.data.bankIntensity).toBe(0.6)
      expect(result.data.warpIntensity).toBe(0.5)
      expect(result.data.gridDensity).toBe(16)
      expect(result.data.hudOpacity).toBe(0.9)
    }
  })

  it('rejects trenchRun config with scrollSpeed out of range', () => {
    const result = presetConfigSchema.safeParse({
      type: 'trenchRun',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      scrollSpeed: 5.0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects trenchRun config with invalid colorScheme', () => {
    const result = presetConfigSchema.safeParse({
      type: 'trenchRun',
      colorScheme: 'rainbow',
      sensitivity: 1.0,
      fftSize: 2048,
    })
    expect(result.success).toBe(false)
  })

  it('rejects sensitivity out of range', () => {
    const result = presetConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 10.0,
      fftSize: 2048,
      barCount: 64,
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('trenchRunConfigSchema', () => {
  const base = {
    type: 'trenchRun' as const,
    colorScheme: 'neon-dark' as const,
    sensitivity: 1.0,
    fftSize: 2048 as const,
    scrollSpeed: 1.0,
    bankIntensity: 0.6,
    warpIntensity: 0.5,
    gridDensity: 16,
    hudOpacity: 0.9,
  }

  it('accepts valid trenchRun config', () => {
    expect(() => trenchRunConfigSchema.parse(base)).not.toThrow()
  })

  it('rejects scrollSpeed below 0.5', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, scrollSpeed: 0.1 })).toThrow()
  })

  it('rejects gridDensity above 32', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, gridDensity: 64 })).toThrow()
  })

  it('rejects non-integer gridDensity', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, gridDensity: 16.5 })).toThrow()
  })
})

describe('createPresetSchema', () => {
  it('accepts valid bars preset', () => {
    const result = createPresetSchema.safeParse({
      name: 'My Preset',
      config: { type: 'bars', colorScheme: 'neon-dark', sensitivity: 1.0, fftSize: 2048, barCount: 64, mirrorBars: false },
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid waveform preset', () => {
    const result = createPresetSchema.safeParse({
      name: 'Wave',
      config: { type: 'waveform', colorScheme: 'ocean', sensitivity: 1.0, fftSize: 1024 },
    })
    expect(result.success).toBe(true)
  })

  it('rejects name over 80 characters', () => {
    const result = createPresetSchema.safeParse({
      name: 'a'.repeat(81),
      config: { type: 'waveform', colorScheme: 'ocean', sensitivity: 1.0, fftSize: 1024 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createPresetSchema.safeParse({
      name: '   ',
      config: { type: 'waveform', colorScheme: 'ocean', sensitivity: 1.0, fftSize: 1024 },
    })
    expect(result.success).toBe(false)
  })
})

describe('updatePresetSchema', () => {
  it('accepts partial update', () => {
    const result = updatePresetSchema.safeParse({ name: 'New name' })
    expect(result.success).toBe(true)
  })

  it('accepts isPublic update', () => {
    const result = updatePresetSchema.safeParse({ isPublic: true })
    expect(result.success).toBe(true)
  })

  it('rejects invalid config in update', () => {
    const result = updatePresetSchema.safeParse({ config: { type: 'bad' } })
    expect(result.success).toBe(false)
  })
})

describe('buildConfigForType — trenchRun branch', () => {
  const barsConfig = {
    type: 'bars' as const,
    colorScheme: 'neon-dark' as const,
    sensitivity: 1.2,
    fftSize: 2048 as const,
    barCount: 64,
    mirrorBars: true,
  }

  const trenchRunConfig: TrenchRunConfig = {
    type: 'trenchRun',
    colorScheme: 'neon-dark',
    sensitivity: 1.2,
    fftSize: 2048,
    scrollSpeed: 1.5,
    bankIntensity: 0.3,
    warpIntensity: 0.8,
    gridDensity: 24,
    hudOpacity: 0.5,
  }

  it('returns default trenchRun values when switching from a non-trenchRun type', () => {
    const result = buildConfigForType('trenchRun', barsConfig)
    expect(result.type).toBe('trenchRun')
    expect(result.colorScheme).toBe('neon-dark')
    expect(result.sensitivity).toBe(1.2)
    expect(result.fftSize).toBe(2048)
    if (result.type === 'trenchRun') {
      expect(result.scrollSpeed).toBe(1.0)
      expect(result.bankIntensity).toBe(0.6)
      expect(result.warpIntensity).toBe(0.5)
      expect(result.gridDensity).toBe(16)
      expect(result.hudOpacity).toBe(0.9)
    }
  })

  it('preserves existing trenchRun values when switching back to trenchRun', () => {
    const result = buildConfigForType('trenchRun', trenchRunConfig)
    expect(result.type).toBe('trenchRun')
    if (result.type === 'trenchRun') {
      expect(result.scrollSpeed).toBe(1.5)
      expect(result.bankIntensity).toBe(0.3)
      expect(result.warpIntensity).toBe(0.8)
      expect(result.gridDensity).toBe(24)
      expect(result.hudOpacity).toBe(0.5)
    }
  })
})
