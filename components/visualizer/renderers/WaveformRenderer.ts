import type { BaseRenderer } from './BaseRenderer'
import type { WaveformConfig } from '@/lib/validations/preset'

const COLOR_MAP: Record<WaveformConfig['colorScheme'], string> = {
  'neon-dark': '#00f5ff',
  'sunset': '#ff6b35',
  'mono': '#ffffff',
  'ocean': '#0077b6',
}

export class WaveformRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: WaveformConfig

  constructor(canvas: HTMLCanvasElement, config: WaveformConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  render(_fftData: Float32Array, waveData: Float32Array): void {
    const { ctx, width, height, config } = this
    ctx.clearRect(0, 0, width, height)

    ctx.lineWidth = 2
    ctx.strokeStyle = COLOR_MAP[config.colorScheme]
    ctx.beginPath()

    const sliceWidth = width / waveData.length

    for (let i = 0; i < waveData.length; i++) {
      // waveData values from getFloatTimeDomainData are in range [-1, 1]
      const v = waveData[i] ?? 0
      const y = (v + 1) / 2 * height
      const x = i * sliceWidth
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    ctx.stroke()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  destroy(): void {}
}
