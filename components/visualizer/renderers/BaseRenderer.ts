export interface BaseRenderer {
  render(fftData: Float32Array, waveData: Float32Array): void
  resize(width: number, height: number): void
  destroy(): void
}
