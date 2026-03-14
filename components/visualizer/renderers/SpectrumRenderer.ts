import type { BaseRenderer } from './BaseRenderer'
import type { SpectrumConfig } from '@/lib/validations/preset'

// Assumed sample rate — standard Web Audio API default
const SAMPLE_RATE = 44100
const MIN_FREQ = 20
const MAX_FREQ = 20000
const LOG_MIN = Math.log10(MIN_FREQ)
const LOG_MAX = Math.log10(MAX_FREQ)

const FREQ_MARKERS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const FREQ_LABELS: Record<number, string> = {
  20: '20', 50: '50', 100: '100', 200: '200', 500: '500',
  1000: '1k', 2000: '2k', 5000: '5k', 10000: '10k', 20000: '20k',
}

const BANDS = [
  { label: 'SUB',      from: 20,   to: 60   },
  { label: 'BASS',     from: 60,   to: 250  },
  { label: 'LOW MID',  from: 250,  to: 500  },
  { label: 'MID',      from: 500,  to: 2000 },
  { label: 'HI MID',   from: 2000, to: 4000 },
  { label: 'PRESENCE', from: 4000, to: 8000 },
  { label: 'AIR',      from: 8000, to: 20000 },
]

const COLOR_ACCENT: Record<SpectrumConfig['colorScheme'], [string, string, string]> = {
  'neon-dark': ['#003300', '#00ff88', '#00ffff'],
  'sunset':    ['#330800', '#ff6b35', '#ffdd00'],
  'mono':      ['#111111', '#aaaaaa', '#ffffff'],
  'ocean':     ['#001133', '#0077b6', '#90e0ef'],
}

function freqToX(freq: number, plotW: number): number {
  return plotW * (Math.log10(Math.max(MIN_FREQ, freq)) - LOG_MIN) / (LOG_MAX - LOG_MIN)
}

const MARGIN = { top: 24, right: 24, bottom: 64, left: 44 }

export class SpectrumRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: SpectrumConfig
  private peaks: Float32Array = new Float32Array(0)

  constructor(canvas: HTMLCanvasElement, config: SpectrumConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(fftData: Float32Array, _waveData: Float32Array, _features: import('../AudioFeatures').AudioFeatures): void {
    const { ctx, width, height, config } = this
    const binCount = fftData.length
    const [colorLow, colorMid, colorHigh] = COLOR_ACCENT[config.colorScheme]

    const plotW = width - MARGIN.left - MARGIN.right
    const plotH = height - MARGIN.top - MARGIN.bottom

    if (this.peaks.length !== plotW) {
      this.peaks = new Float32Array(plotW)
    }

    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.translate(MARGIN.left, MARGIN.top)

    // --- Band shading ---
    BANDS.forEach((band, i) => {
      const x1 = freqToX(band.from, plotW)
      const x2 = freqToX(band.to, plotW)
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0)'
      ctx.fillRect(x1, 0, x2 - x1, plotH)
    })

    // --- Horizontal grid lines ---
    ctx.strokeStyle = `${colorMid}22`
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const y = plotH * i / 4
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(plotW, y)
      ctx.stroke()
    }

    // --- Vertical grid lines at frequency markers ---
    FREQ_MARKERS.forEach((freq) => {
      const x = freqToX(freq, plotW)
      ctx.strokeStyle = freq === 1000 ? `${colorMid}40` : `${colorMid}20`
      ctx.lineWidth = freq === 1000 ? 1.5 : 0.8
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, plotH)
      ctx.stroke()
    })

    // --- Spectrum bars + peak tracking ---
    const barGradient = ctx.createLinearGradient(0, plotH, 0, 0)
    barGradient.addColorStop(0,    colorLow)
    barGradient.addColorStop(0.45, colorMid)
    barGradient.addColorStop(0.85, colorHigh)
    barGradient.addColorStop(1,    '#ffffff')

    ctx.fillStyle = barGradient
    ctx.shadowColor = colorMid
    ctx.shadowBlur = 6

    for (let px = 0; px < plotW; px++) {
      const freq1 = Math.pow(10, LOG_MIN + (px / plotW) * (LOG_MAX - LOG_MIN))
      const freq2 = Math.pow(10, LOG_MIN + ((px + 1) / plotW) * (LOG_MAX - LOG_MIN))
      const bin1 = Math.floor(freq1 * binCount * 2 / SAMPLE_RATE)
      const bin2 = Math.min(Math.ceil(freq2 * binCount * 2 / SAMPLE_RATE), binCount - 1)

      let maxVal = 0
      for (let b = bin1; b <= bin2; b++) {
        const v = fftData[b] ?? 0
        if (v > maxVal) maxVal = v
      }

      if (maxVal > this.peaks[px]) {
        this.peaks[px] = maxVal
      } else {
        this.peaks[px] = Math.max(0, this.peaks[px] - 0.004)
      }

      if (maxVal > 0) {
        ctx.fillRect(px, plotH - maxVal * plotH, 1, maxVal * plotH)
      }
    }

    ctx.shadowBlur = 0

    // --- Peak hold line ---
    ctx.beginPath()
    ctx.strokeStyle = colorHigh
    ctx.shadowColor = colorHigh
    ctx.shadowBlur = 8
    ctx.lineWidth = 1
    for (let px = 0; px < plotW; px++) {
      const y = plotH - this.peaks[px] * plotH
      if (px === 0) ctx.moveTo(px, y)
      else ctx.lineTo(px, y)
    }
    ctx.stroke()
    ctx.shadowBlur = 0

    // --- X-axis: frequency labels ---
    ctx.font = '10px "Courier New", Courier, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    FREQ_MARKERS.forEach((freq) => {
      const x = freqToX(freq, plotW)
      // tick
      ctx.strokeStyle = `${colorMid}88`
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x, plotH)
      ctx.lineTo(x, plotH + 5)
      ctx.stroke()
      // label
      ctx.fillStyle = `${colorMid}cc`
      ctx.fillText(FREQ_LABELS[freq] + 'Hz', x, plotH + 8)
    })

    // --- Band name labels ---
    ctx.font = '9px "Courier New", Courier, monospace'
    ctx.textBaseline = 'top'
    BANDS.forEach((band) => {
      const x1 = freqToX(band.from, plotW)
      const x2 = freqToX(band.to, plotW)
      if (x2 - x1 > 24) {
        ctx.fillStyle = `${colorMid}66`
        ctx.textAlign = 'center'
        ctx.fillText(band.label, (x1 + x2) / 2, plotH + 32)
      }
    })

    // --- Y-axis labels ---
    ctx.font = '9px "Courier New", Courier, monospace'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ;['100%', '75%', '50%', '25%'].forEach((label, i) => {
      ctx.fillStyle = `${colorMid}88`
      ctx.fillText(label, -6, plotH * i / 4)
    })

    // --- Axes border ---
    ctx.strokeStyle = `${colorMid}44`
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, plotW, plotH)

    ctx.restore()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.peaks = new Float32Array(0) // reset — will re-init on next render
  }

  destroy(): void {}
}
