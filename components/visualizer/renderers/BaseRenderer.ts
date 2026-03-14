import type { AudioFeatures } from '../AudioFeatures'

export interface BaseRenderer {
  render(fftData: Float32Array, waveData: Float32Array, features: AudioFeatures): void
  resize(width: number, height: number): void
  destroy(): void
}
