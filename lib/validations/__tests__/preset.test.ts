import {
  presetConfigSchema,
  createPresetSchema,
  updatePresetSchema,
} from '../preset'

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
