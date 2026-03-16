import type { TrenchRunConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

export function computeScrollDelta(_rms: number, _dt: number, _isOnset: boolean): number {
  throw new Error('not implemented')
}
export function computeBankAngle(_time: number, _rms: number, _bankIntensity: number): number {
  throw new Error('not implemented')
}
export function computeWarpAmount(_bass: number, _warpIntensity: number): number {
  throw new Error('not implemented')
}
export function computeReticleRadius(_rms: number, _bass: number): number {
  throw new Error('not implemented')
}

export class TrenchRunRenderer {
  constructor(_canvas: HTMLCanvasElement, _config: TrenchRunConfig) {
    throw new Error('not implemented')
  }
  render(_fft: Float32Array, _wave: Float32Array, _features: AudioFeatures): void {
    throw new Error('not implemented')
  }
  resize(_w: number, _h: number): void {
    throw new Error('not implemented')
  }
  destroy(): void {
    throw new Error('not implemented')
  }
}
