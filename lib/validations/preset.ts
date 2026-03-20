import { z } from 'zod'

export const COLOR_SCHEMES = ['neon-dark', 'sunset', 'mono', 'ocean'] as const
export const FFT_SIZES = [512, 1024, 2048, 4096] as const

const colorSchemeSchema = z.enum(COLOR_SCHEMES)

const baseConfigSchema = z.object({
  colorScheme: colorSchemeSchema,
  sensitivity: z.number().min(0.5).max(3.0),
  fftSize: z.union([z.literal(512), z.literal(1024), z.literal(2048), z.literal(4096)]),
})

export const barsConfigSchema = baseConfigSchema.extend({
  type: z.literal('bars'),
  barCount: z.number().int().min(32).max(128),
  mirrorBars: z.boolean(),
}).refine(
  (d) => d.barCount <= d.fftSize / 2,
  { message: 'barCount must not exceed fftSize / 2' }
)

export const waveformConfigSchema = baseConfigSchema.extend({
  type: z.literal('waveform'),
})

export const spectrumConfigSchema = baseConfigSchema.extend({
  type: z.literal('spectrum'),
})

export const featuresConfigSchema = baseConfigSchema.extend({
  type: z.literal('features'),
})

export const chordsConfigSchema = baseConfigSchema.extend({
  type: z.literal('chords'),
})

export const plasmaConfigSchema = baseConfigSchema.extend({
  type: z.literal('plasma'),
  brightness: z.number().min(0.2).max(3.0).default(1.0),
  dynamicRange: z.number().min(0.1).max(3.0).default(2.0),
})

export const trenchRunConfigSchema = baseConfigSchema.extend({
  type: z.literal('trenchRun'),
  scrollSpeed:      z.number().min(0.5).max(2.0).default(1.0),
  bankIntensity:    z.number().min(0.0).max(1.0).default(0.6),
  warpIntensity:    z.number().min(0.0).max(1.0).default(0.5),
  gridDensity:      z.number().int().min(8).max(32).default(16),
  hudOpacity:       z.number().min(0.0).max(1.0).default(0.9),
  scanRange:        z.number().min(10).max(120).default(50),
  bankLateral:      z.number().min(0.0).max(1.0).default(0.7),
  missileRate:      z.number().min(0.0).max(2.0).default(1.0),
  skyIntensity:     z.number().min(0.0).max(1.0).default(1.0),
  battleIntensity:  z.number().min(0.0).max(1.0).default(1.0),
})

export const presetConfigSchema = z.discriminatedUnion('type', [
  barsConfigSchema,
  waveformConfigSchema,
  spectrumConfigSchema,
  featuresConfigSchema,
  chordsConfigSchema,
  plasmaConfigSchema,
  trenchRunConfigSchema,
])

export const createPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: presetConfigSchema,
})

export const updatePresetSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: presetConfigSchema.optional(),
  isPublic: z.boolean().optional(),
})

// TypeScript types derived from schemas
export type BarsConfig = z.infer<typeof barsConfigSchema>
export type WaveformConfig = z.infer<typeof waveformConfigSchema>
export type SpectrumConfig = z.infer<typeof spectrumConfigSchema>
export type FeaturesConfig = z.infer<typeof featuresConfigSchema>
export type ChordsConfig = z.infer<typeof chordsConfigSchema>
export type PlasmaConfig = z.infer<typeof plasmaConfigSchema>
export type TrenchRunConfig = z.infer<typeof trenchRunConfigSchema>
export type PresetConfig = z.infer<typeof presetConfigSchema>
