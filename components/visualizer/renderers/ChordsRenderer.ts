import type { BaseRenderer } from './BaseRenderer'
import type { ChordsConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

const COLOR_ACCENT: Record<ChordsConfig['colorScheme'], {
  primary: string; dim: string; bg: string; faded: string
}> = {
  'neon-dark': { primary: '#00ffaa', dim: '#00ff6640', bg: '#001a0e', faded: '#00ffaa18' },
  'sunset':    { primary: '#ffaa00', dim: '#ff880040', bg: '#1a0800', faded: '#ffaa0018' },
  'mono':      { primary: '#cccccc', dim: '#88888840', bg: '#111111', faded: '#cccccc18' },
  'ocean':     { primary: '#00ccff', dim: '#0088ff40', bg: '#00101a', faded: '#00ccff18' },
}

const FONT = '"Courier New", Courier, monospace'

// Chords per row — determines wrapping point
const CHORDS_PER_ROW = 8

// How many rows to show (current + history)
const MAX_ROWS = 9

interface ChordEntry {
  chord: string
}

export class ChordsRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: ChordsConfig

  // Row-based chord history: rows[0]=oldest visible, rows[last]=current
  private rows: ChordEntry[][] = [[]]
  private lastChord: string | null = null

  // Beat pulse
  private onsetFlash = 0

  constructor(canvas: HTMLCanvasElement, config: ChordsConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  render(_fftData: Float32Array, _waveData: Float32Array, features: AudioFeatures): void {
    const { ctx, width, height, config } = this
    const accent = COLOR_ACCENT[config.colorScheme]

    // ── Track chord changes ───────────────────────────────────────
    if (features.chord && features.chord !== this.lastChord) {
      const currentRow = this.rows[this.rows.length - 1]
      if (currentRow.length >= CHORDS_PER_ROW) {
        // Start a new row
        this.rows.push([{ chord: features.chord }])
        if (this.rows.length > MAX_ROWS) this.rows.shift()
      } else {
        currentRow.push({ chord: features.chord })
      }
      this.lastChord = features.chord
    }

    // ── Onset flash ───────────────────────────────────────────────
    if (features.isOnset) this.onsetFlash = 1
    else this.onsetFlash = Math.max(0, this.onsetFlash - 0.06)

    // ── Clear ─────────────────────────────────────────────────────
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // ── Layout constants ──────────────────────────────────────────
    const HEADER_H = 38
    const FOOTER_H = 28
    const availH = height - HEADER_H - FOOTER_H
    const rowH = Math.floor(availH / MAX_ROWS)
    const cellW = Math.floor(width / CHORDS_PER_ROW)

    const numRows = this.rows.length
    // Bottom row = current, drawn at the bottom of the available area
    // Rows stack upward

    for (let ri = 0; ri < numRows; ri++) {
      const row = this.rows[ri]
      // ri=0 is oldest, ri=numRows-1 is newest (current)
      const rowFromBottom = numRows - 1 - ri  // 0 = current row
      const rowY = HEADER_H + availH - (rowFromBottom + 1) * rowH

      // Alpha: current row is full brightness, older rows fade
      const rowAlpha = Math.max(0.08, 1 - rowFromBottom * 0.18)
      const isCurrent = rowFromBottom === 0

      // Row separator line
      if (ri < numRows - 1) {
        ctx.strokeStyle = `${accent.primary}${Math.floor(rowAlpha * 0.3 * 255).toString(16).padStart(2, '0')}`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, rowY + rowH - 1)
        ctx.lineTo(width, rowY + rowH - 1)
        ctx.stroke()
      }

      // Draw each chord in this row
      for (let ci = 0; ci < row.length; ci++) {
        const entry = row[ci]
        const cx = ci * cellW + cellW / 2
        const cy = rowY + rowH / 2

        const isCurrentChord = isCurrent && ci === row.length - 1

        this.drawChord(cx, cy, entry.chord, isCurrentChord, isCurrent, rowAlpha, features.beatPhase, accent)
      }

      // Show cursor (empty slot outline) after last chord in current row if not full
      if (isCurrent && row.length < CHORDS_PER_ROW) {
        const cx = row.length * cellW + cellW / 2
        const cy = rowY + rowH / 2
        const cursorH = Math.min(rowH - 12, 48)
        const cursorW = Math.min(cellW - 16, 52)
        ctx.strokeStyle = `${accent.primary}22`
        ctx.lineWidth = 1
        ctx.strokeRect(cx - cursorW / 2, cy - cursorH / 2, cursorW, cursorH)
      }
    }

    // Empty state
    if (this.rows.length === 1 && this.rows[0].length === 0) {
      ctx.font = `12px ${FONT}`
      ctx.fillStyle = `${accent.primary}44`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('play music to detect chords', width / 2, height / 2)
    }

    // ── Header ────────────────────────────────────────────────────
    const PAD = 14
    ctx.font = `bold 10px ${FONT}`
    ctx.textBaseline = 'top'
    ctx.fillStyle = accent.primary
    ctx.textAlign = 'left'
    ctx.fillText('CHORD SHEET', PAD, 10)

    if (features.key) {
      ctx.font = `9px ${FONT}`
      ctx.fillStyle = `${accent.primary}99`
      ctx.fillText(`KEY: ${features.key.toUpperCase()}`, PAD + 90, 12)
    }

    ctx.textAlign = 'right'
    if (features.bpm) {
      ctx.font = `9px ${FONT}`
      ctx.fillStyle = `${accent.primary}99`
      ctx.fillText(`${features.bpm} BPM`, width - PAD, 10)
    }

    // Header separator
    ctx.strokeStyle = `${accent.primary}22`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, HEADER_H)
    ctx.lineTo(width, HEADER_H)
    ctx.stroke()

    // ── Footer: beat pulse bar ─────────────────────────────────────
    const footerY = height - FOOTER_H
    ctx.strokeStyle = `${accent.primary}22`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, footerY)
    ctx.lineTo(width, footerY)
    ctx.stroke()

    // Beat phase progress bar
    const barW = width * features.beatPhase
    ctx.fillStyle = `${accent.primary}33`
    ctx.fillRect(0, footerY + 4, barW, FOOTER_H - 8)

    // Onset dot
    if (this.onsetFlash > 0) {
      const dotR = 4 + this.onsetFlash * 3
      ctx.beginPath()
      ctx.arc(PAD + 6, footerY + FOOTER_H / 2, dotR, 0, Math.PI * 2)
      ctx.fillStyle = this.onsetFlash > 0.5
        ? accent.primary
        : `${accent.primary}${Math.floor(this.onsetFlash * 255).toString(16).padStart(2, '0')}`
      ctx.shadowColor = accent.primary
      ctx.shadowBlur = this.onsetFlash * 10
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }

  private drawChord(
    cx: number, cy: number,
    chord: string,
    isCurrent: boolean,
    isCurrentRow: boolean,
    rowAlpha: number,
    beatPhase: number,
    accent: { primary: string; dim: string; bg: string }
  ) {
    const { ctx } = this
    const isMinor = chord.endsWith('m')
    const root = isMinor ? chord.slice(0, -1) : chord
    const quality = isMinor ? 'm' : ''

    // Beat pulse on current chord
    const pulse = isCurrent ? (1 + 0.12 * Math.cos(beatPhase * Math.PI * 2)) : 1

    const textAlpha = Math.floor(rowAlpha * (isCurrent ? 1 : 0.85) * 255).toString(16).padStart(2, '0')

    // Card background for current chord
    if (isCurrent) {
      const cardH = 48
      const cardW = 60
      ctx.fillStyle = `${accent.primary}15`
      ctx.fillRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH)
      ctx.strokeStyle = `${accent.primary}55`
      ctx.lineWidth = 1
      ctx.shadowColor = accent.primary
      ctx.shadowBlur = 10
      ctx.strokeRect(cx - cardW / 2 + 0.5, cy - cardH / 2 + 0.5, cardW - 1, cardH - 1)
      ctx.shadowBlur = 0
    }

    // Font size scales: current chord large, current row medium, history small
    const fontSize = isCurrent ? Math.round(28 * pulse) : isCurrentRow ? 22 : Math.max(10, 14 * rowAlpha + 8)

    ctx.font = `bold ${fontSize}px ${FONT}`
    ctx.fillStyle = `${accent.primary}${textAlpha}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    if (isCurrent) {
      ctx.shadowColor = accent.primary
      ctx.shadowBlur = 8
    }

    // Root + quality as a single string for centering
    const label = root + quality
    ctx.fillText(label, cx, cy)
    ctx.shadowBlur = 0

    // Minor/Major tag below current chord
    if (isCurrent) {
      ctx.font = `7px ${FONT}`
      ctx.fillStyle = `${accent.primary}55`
      ctx.textBaseline = 'top'
      ctx.fillText(isMinor ? 'min' : 'maj', cx, cy + 16)
    }
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  destroy(): void {}
}
