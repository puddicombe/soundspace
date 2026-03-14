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

export const presetConfigSchema = z.discriminatedUnion('type', [
  barsConfigSchema,
  waveformConfigSchema,
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
export type PresetConfig = z.infer<typeof presetConfigSchema>
