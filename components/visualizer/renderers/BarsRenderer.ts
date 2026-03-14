import type { BaseRenderer } from './BaseRenderer'
import type { BarsConfig } from '@/lib/validations/preset'

const COLOR_MAP: Record<BarsConfig['colorScheme'], [string, string]> = {
  'neon-dark': ['#00f5ff', '#ff00ff'],
  'sunset': ['#ff6b35', '#f7c59f'],
  'mono': ['#ffffff', '#888888'],
  'ocean': ['#0077b6', '#90e0ef'],
}

export class BarsRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: BarsConfig
  private gradient: CanvasGradient | null = null
  private gradientScheme: string = ''
  private gradientHeight: number = 0

  constructor(canvas: HTMLCanvasElement, config: BarsConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(fftData: Float32Array, _waveData: Float32Array): void {
    const { ctx, width, height, config } = this
    const { barCount, mirrorBars, colorScheme } = config
    const [colorA, colorB] = COLOR_MAP[colorScheme]

    ctx.clearRect(0, 0, width, height)

    const totalBars = mirrorBars ? barCount * 2 : barCount
    const barWidth = width / totalBars
    const gap = Math.max(1, barWidth * 0.1)

    if (!this.gradient || colorScheme !== this.gradientScheme || height !== this.gradientHeight) {
      this.gradient = ctx.createLinearGradient(0, height, 0, 0)
      this.gradient.addColorStop(0, colorA)
      this.gradient.addColorStop(1, colorB)
      this.gradientScheme = colorScheme
      this.gradientHeight = height
    }
    ctx.fillStyle = this.gradient

    for (let i = 0; i < barCount; i++) {
      const value = fftData[i] ?? 0
      const barHeight = value * height

      if (mirrorBars) {
        // Left half: mirrored
        const x = (barCount - 1 - i) * barWidth
        ctx.fillRect(x + gap / 2, height - barHeight, barWidth - gap, barHeight)
        // Right half: forward
        const xRight = (barCount + i) * barWidth
        ctx.fillRect(xRight + gap / 2, height - barHeight, barWidth - gap, barHeight)
      } else {
        const x = i * barWidth
        ctx.fillRect(x + gap / 2, height - barHeight, barWidth - gap, barHeight)
      }
    }
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.gradient = null
  }

  destroy(): void {
    // No resources to clean up for Canvas 2D
  }
}
