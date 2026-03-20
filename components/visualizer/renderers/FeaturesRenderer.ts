import type { BaseRenderer } from './BaseRenderer'
import type { FeaturesConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'
import { PITCH_CLASS_NAMES } from '../FeatureExtractor'

const COLOR_ACCENT: Record<FeaturesConfig['colorScheme'], { primary: string; dim: string; grid: string; bg: string }> = {
  'neon-dark': { primary: '#00ffaa', dim: '#00ff6644', grid: '#00ff2218', bg: '#001a0e' },
  'sunset':    { primary: '#ffaa00', dim: '#ff880044', grid: '#ff440018', bg: '#1a0800' },
  'mono':      { primary: '#cccccc', dim: '#88888844', grid: '#44444418', bg: '#111111' },
  'ocean':     { primary: '#00ccff', dim: '#0088ff44', grid: '#003cff18', bg: '#00101a' },
}

const FONT = '"Courier New", Courier, monospace'

function hzToNoteName(hz: number): string {
  const midi = Math.round(12 * Math.log2(hz / 440) + 69)
  const octave = Math.floor(midi / 12) - 1
  return PITCH_CLASS_NAMES[((midi % 12) + 12) % 12] + octave
}

export class FeaturesRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: FeaturesConfig
  // Flash state for isOnset
  private onsetFlash = 0

  constructor(canvas: HTMLCanvasElement, config: FeaturesConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  render(_fftData: Float32Array, _waveData: Float32Array, features: AudioFeatures): void {
    const { ctx, width, height, config } = this
    const accent = COLOR_ACCENT[config.colorScheme]

    ctx.clearRect(0, 0, width, height)

    // Background
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // Update onset flash
    if (features.isOnset) this.onsetFlash = 1
    else this.onsetFlash = Math.max(0, this.onsetFlash - 0.08)

    const PAD = 16
    const panelW = (width - PAD * 3) / 2
    const panelH = (height - PAD * 4) / 3

    // 6 panels in a 2×3 grid
    const panels: Array<{ col: number; row: number; title: typeof _SECTION_TITLES[number] }> = [
      { col: 0, row: 0, title: 'ENERGY' },
      { col: 1, row: 0, title: 'BAND ENERGY' },
      { col: 0, row: 1, title: 'TIMBRE' },
      { col: 1, row: 1, title: 'CHROMA' },
      { col: 0, row: 2, title: 'RHYTHM' },
      { col: 1, row: 2, title: 'AFFECT' },
    ]

    panels.forEach(({ col, row, title }) => {
      const x = PAD + col * (panelW + PAD)
      const y = PAD + row * (panelH + PAD)
      this.drawPanel(x, y, panelW, panelH, title, features, accent)
    })

    // Header bar
    const bpmText = features.bpm ? `BPM: ${features.bpm}` : 'BPM: —'
    const beatDot = this.onsetFlash > 0
    ctx.font = `bold 11px ${FONT}`
    ctx.fillStyle = accent.primary
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText('AUDIO FEATURES', PAD, 4)
    ctx.textAlign = 'right'
    ctx.fillText(bpmText, width - PAD - (beatDot ? 18 : 0), 4)
    if (beatDot) {
      ctx.beginPath()
      ctx.arc(width - PAD - 6, 9, 5, 0, Math.PI * 2)
      ctx.fillStyle = this.onsetFlash > 0.5
        ? accent.primary
        : `${accent.primary}${Math.floor(this.onsetFlash * 255).toString(16).padStart(2, '0')}`
      ctx.shadowColor = accent.primary
      ctx.shadowBlur = 8
      ctx.fill()
      ctx.shadowBlur = 0
    }
  }

  private drawPanel(
    x: number, y: number, w: number, h: number,
    title: typeof _SECTION_TITLES[number],
    f: AudioFeatures,
    accent: { primary: string; dim: string; grid: string; bg: string }
  ) {
    const { ctx } = this
    const TITLE_H = 18
    const INNER_PAD = 8

    // Panel background
    ctx.fillStyle = accent.bg
    ctx.fillRect(x, y, w, h)

    // Border
    ctx.strokeStyle = `${accent.primary}44`
    ctx.lineWidth = 1
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1)

    // Title bar
    ctx.fillStyle = `${accent.primary}18`
    ctx.fillRect(x, y, w, TITLE_H)
    ctx.font = `bold 9px ${FONT}`
    ctx.fillStyle = `${accent.primary}cc`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(`[ ${title} ]`, x + INNER_PAD, y + TITLE_H / 2)

    const contentX = x + INNER_PAD
    const contentY = y + TITLE_H + INNER_PAD
    const contentW = w - INNER_PAD * 2
    const contentH = h - TITLE_H - INNER_PAD * 2

    switch (title) {
      case 'ENERGY':      this.drawEnergy(contentX, contentY, contentW, contentH, f, accent); break
      case 'BAND ENERGY': this.drawBandEnergy(contentX, contentY, contentW, contentH, f, accent); break
      case 'TIMBRE':      this.drawTimbre(contentX, contentY, contentW, contentH, f, accent); break
      case 'CHROMA':      this.drawChroma(contentX, contentY, contentW, contentH, f, accent); break
      case 'RHYTHM':      this.drawRhythm(contentX, contentY, contentW, contentH, f, accent); break
      case 'AFFECT':      this.drawAffect(contentX, contentY, contentW, contentH, f, accent); break
    }
  }

  private drawBar(
    label: string, value: number, unit: string,
    x: number, y: number, w: number, rowH: number,
    accent: { primary: string; dim: string; grid: string },
    glow = false,
    bipolar = false,  // if true, value is [-1,+1] and bar grows left/right from centre
    point = false,    // if true, draw a diamond pointer at the value position instead of a fill
    ticks = 0,        // if > 0, draw that many evenly-spaced dividers on the track
    tickLabels: string[] = []  // optional labels for the ticks (drawn below track)
  ) {
    const { ctx } = this
    const LABEL_W = 72
    const VALUE_W = 52
    const barX = x + LABEL_W
    const barW = w - LABEL_W - VALUE_W
    const barH = Math.max(4, rowH - 6)
    const barY = y + (rowH - barH) / 2

    // Label
    ctx.font = `9px ${FONT}`
    ctx.fillStyle = `${accent.primary}99`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(label.toUpperCase(), x, y + rowH / 2)

    // Track
    ctx.fillStyle = accent.dim
    ctx.fillRect(barX, barY, barW, barH)

    // Optional tick marks
    if (ticks > 1) {
      ctx.fillStyle = `${accent.primary}55`
      for (let t = 0; t < ticks; t++) {
        const tx = barX + (t / (ticks - 1)) * barW
        ctx.fillRect(tx - 0.5, barY, 1, barH)
      }
      if (tickLabels.length > 0) {
        ctx.font = `7px ${FONT}`
        ctx.textBaseline = 'top'
        ctx.fillStyle = `${accent.primary}55`
        for (let t = 0; t < tickLabels.length; t++) {
          const lbl = tickLabels[t]
          if (!lbl) continue
          const tx = barX + (t / (ticks - 1)) * barW
          ctx.textAlign = t === ticks - 1 ? 'right' : t === 0 ? 'left' : 'center'
          ctx.fillText(lbl, tx, barY + barH + 1)
        }
      }
    }

    if (point) {
      // Diamond pointer sliding along the track; value in [0,1]
      const dotX = barX + Math.max(0, Math.min(barW, value * barW))
      const dotR = barH / 2 + 1
      ctx.fillStyle = accent.primary
      if (glow) { ctx.shadowColor = accent.primary; ctx.shadowBlur = 6 }
      ctx.beginPath()
      ctx.moveTo(dotX, barY - 1)
      ctx.lineTo(dotX + dotR, barY + barH / 2)
      ctx.lineTo(dotX, barY + barH + 1)
      ctx.lineTo(dotX - dotR, barY + barH / 2)
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
    } else if (bipolar) {
      // Centre-origin bar: value in [-1,+1]
      const midX = barX + barW / 2
      const fillW = Math.abs(value) * (barW / 2)
      if (fillW > 0) {
        ctx.fillStyle = accent.primary
        if (glow) { ctx.shadowColor = accent.primary; ctx.shadowBlur = 6 }
        ctx.fillRect(value < 0 ? midX - fillW : midX, barY, fillW, barH)
        ctx.shadowBlur = 0
      }
      // Centre tick
      ctx.fillStyle = `${accent.primary}88`
      ctx.fillRect(midX - 0.5, barY, 1, barH)
    } else {
      // Standard left-to-right bar: value in [0,1]
      const fillW = Math.max(0, Math.min(barW, value * barW))
      if (fillW > 0) {
        ctx.fillStyle = accent.primary
        if (glow) { ctx.shadowColor = accent.primary; ctx.shadowBlur = 6 }
        ctx.fillRect(barX, barY, fillW, barH)
        ctx.shadowBlur = 0
      }
    }

    // Value text
    ctx.font = `9px ${FONT}`
    ctx.fillStyle = `${accent.primary}bb`
    ctx.textAlign = 'right'
    ctx.fillText(unit, x + w, y + rowH / 2)
  }

  private drawEnergy(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const rows = [
      { label: 'RMS', value: f.rms, unit: f.rms.toFixed(3) },
      { label: 'Presence', value: f.signalPresence, unit: f.signalPresence.toFixed(3) },
      { label: 'Crest', value: f.crest, unit: f.crest.toFixed(3) },
      { label: 'Dyn.Cmplx', value: f.dynamicComplexity, unit: f.dynamicComplexity.toFixed(3) },
      { label: 'Harmonic', value: f.harmonicRatio, unit: f.harmonicRatio.toFixed(3) },
      { label: 'Percussive', value: f.percussiveRatio, unit: f.percussiveRatio.toFixed(3) },
    ]
    const rowH = h / rows.length
    rows.forEach((r, i) => this.drawBar(r.label, r.value, r.unit, x, y + i * rowH, w, rowH, accent, r.value > 0.7))
  }

  private drawBandEnergy(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const labels = ['Sub-bass', 'Bass', 'Mid', 'High']
    const rowH = h / 4
    f.bandEnergy.forEach((v, i) =>
      this.drawBar(labels[i], v, v.toFixed(3), x, y + i * rowH, w, rowH, accent, v > 0.7)
    )
  }

  private drawTimbre(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const maxCentroid = 8000
    const maxRolloff = 20000
    // Pitch class: C=0 → B=11, normalised to [0,1] for the pointer position
    const pitchMidi = f.predominantPitch !== null
      ? Math.round(12 * Math.log2(f.predominantPitch / 440) + 69)
      : null
    const pitchClass = pitchMidi !== null ? ((pitchMidi % 12) + 12) % 12 : 0
    const pitchClassValue = pitchClass / 11
    const pitchUnit = f.predominantPitch !== null
      ? `${hzToNoteName(f.predominantPitch)} ${Math.round(f.predominantPitch)}`
      : '—'
    // Label landmarks on the chromatic scale: C E G A# B (C=0, E=4, G=7, A#=10, B=11)
    const CHROMA_TICKS = 12
    const chromaTickLabels = ['C','','','','E','','','G','','','','B']

    const ctTrendUnit = (f.spectralCentroidTrend >= 0 ? '+' : '') + f.spectralCentroidTrend.toFixed(2)
    const rows = [
      { label: 'Centroid', value: Math.min(1, f.spectralCentroid / maxCentroid), unit: `${Math.round(f.spectralCentroid)}Hz`, bipolar: false },
      { label: 'C.Trend', value: f.spectralCentroidTrend, unit: ctTrendUnit, bipolar: true },
      { label: 'Flux', value: f.spectralFlux, unit: f.spectralFlux.toFixed(3) },
      { label: 'Rolloff', value: Math.min(1, f.spectralRolloff / maxRolloff), unit: `${Math.round(f.spectralRolloff)}Hz` },
      { label: 'Flatness', value: f.spectralFlatness, unit: f.spectralFlatness.toFixed(3) },
      { label: 'ZCR', value: f.zcr, unit: f.zcr.toFixed(3) },
      { label: 'Pitch', value: pitchClassValue, unit: pitchUnit, point: f.predominantPitch !== null, ticks: CHROMA_TICKS, tickLabels: chromaTickLabels },
      { label: 'P.Stab', value: f.pitchStability, unit: f.pitchStability.toFixed(3) },
    ]
    const rowH = h / rows.length
    rows.forEach((r, i) => this.drawBar(
      r.label, r.value, r.unit, x, y + i * rowH, w, rowH, accent,
      false, r.bipolar ?? false, r.point ?? false, r.ticks ?? 0, r.tickLabels ?? []
    ))
  }

  private drawChroma(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const { ctx } = this
    // Split panel: chroma bars upper ~55%, chord candidates lower ~45%
    const CAND_H = Math.floor(h * 0.44)
    const BARS_H = h - CAND_H
    const barW = (w - 2) / 12
    const maxVal = Math.max(...Array.from(f.chroma), 0.001)

    // Find dominant pitch class
    let domIdx = 0
    for (let i = 1; i < 12; i++) if (f.chroma[i] > f.chroma[domIdx]) domIdx = i

    // ── Chroma bars ───────────────────────────────────────────────
    for (let i = 0; i < 12; i++) {
      const bx = x + i * barW
      const norm = f.chroma[i] / maxVal
      const bh = norm * (BARS_H - 14)

      ctx.fillStyle = accent.dim
      ctx.fillRect(bx + 1, y, barW - 2, BARS_H - 14)

      ctx.fillStyle = i === domIdx ? accent.primary : `${accent.primary}88`
      if (i === domIdx) { ctx.shadowColor = accent.primary; ctx.shadowBlur = 6 }
      ctx.fillRect(bx + 1, y + (BARS_H - 14) - bh, barW - 2, bh)
      ctx.shadowBlur = 0

      ctx.font = `8px ${FONT}`
      ctx.fillStyle = i === domIdx ? accent.primary : `${accent.primary}77`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(PITCH_CLASS_NAMES[i], bx + barW / 2, y + BARS_H - 12)
    }

    // ── Chord candidates ──────────────────────────────────────────
    // Shows top 4 chord matches with Pearson correlation scores so you can
    // see whether the right chord is in the list even when it's not #1
    const cY = y + BARS_H + 2
    const candidates = f.chordCandidates.slice(0, 4)

    if (candidates.length === 0) {
      ctx.font = `8px ${FONT}`
      ctx.fillStyle = `${accent.primary}44`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('— awaiting chord —', x + w / 2, cY + CAND_H / 2)
    } else {
      const rowH = (CAND_H - 2) / candidates.length
      const LABEL_W = 30
      candidates.forEach(({ chord, score }, ri) => {
        const ry = cY + ri * rowH
        const isTop = ri === 0
        const trackX = x + LABEL_W
        const trackW = w - LABEL_W - 24
        const fillW = Math.max(0, score * trackW)

        ctx.fillStyle = accent.dim
        ctx.fillRect(trackX, ry + 2, trackW, rowH - 4)

        ctx.fillStyle = isTop ? accent.primary : `${accent.primary}77`
        if (isTop) { ctx.shadowColor = accent.primary; ctx.shadowBlur = 4 }
        ctx.fillRect(trackX, ry + 2, fillW, rowH - 4)
        ctx.shadowBlur = 0

        ctx.font = `${isTop ? 'bold ' : ''}8px ${FONT}`
        ctx.fillStyle = isTop ? accent.primary : `${accent.primary}88`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(chord, x, ry + rowH / 2)

        ctx.textAlign = 'right'
        ctx.fillText(`${Math.round(score * 100)}`, x + w, ry + rowH / 2)
      })
    }
  }

  private drawRhythm(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const { ctx } = this
    // Rows: onset strength, beat phase, onset density, chroma novelty
    const ROW_COUNT = 4
    const rowH = h / (ROW_COUNT + 1)  // +1 for the isOnset dot row

    this.drawBar('Onset', f.onsetStrength, f.onsetStrength.toFixed(3), x, y, w, rowH, accent, f.isOnset)
    this.drawBar('Beat phase', f.beatPhase, f.beatPhase.toFixed(2), x, y + rowH, w, rowH, accent)
    this.drawBar('Onset/s', f.onsetDensity, f.onsetDensity.toFixed(3), x, y + rowH * 2, w, rowH, accent)
    this.drawBar('Chord nov.', f.chromaNovelty, f.chromaNovelty.toFixed(3), x, y + rowH * 3, w, rowH, accent, f.chromaNovelty > 0.4)

    // isOnset indicator + chord duration
    const dotY = y + rowH * 4 + rowH / 2
    ctx.font = `9px ${FONT}`
    ctx.fillStyle = `${accent.primary}99`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('ONSET', x, dotY)

    ctx.beginPath()
    const dotX = x + 72 + 12
    ctx.arc(dotX, dotY, 6, 0, Math.PI * 2)
    ctx.fillStyle = f.isOnset || this.onsetFlash > 0.3
      ? accent.primary
      : `${accent.primary}33`
    if (f.isOnset || this.onsetFlash > 0.5) {
      ctx.shadowColor = accent.primary
      ctx.shadowBlur = 12
    }
    ctx.fill()
    ctx.shadowBlur = 0

    // Chord duration + BPM on the right
    ctx.font = `9px ${FONT}`
    ctx.fillStyle = `${accent.primary}bb`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    const chordDurStr = `${f.chordDuration.toFixed(1)}s`
    const bpmStr = f.bpm ? `  ${f.bpm}bpm` : ''
    ctx.fillText(chordDurStr + bpmStr, x + w, dotY)
  }

  private drawAffect(x: number, y: number, w: number, h: number, f: AudioFeatures, accent: { primary: string; dim: string; grid: string }) {
    const trendUnit = (f.energyTrend >= 0 ? '+' : '') + f.energyTrend.toFixed(2)
    const rows = [
      { label: 'Arousal', value: f.arousal, unit: f.arousal.toFixed(3), glow: f.arousal > 0.6, bipolar: false },
      { label: 'Warmth', value: f.warmth, unit: f.warmth.toFixed(3), glow: false, bipolar: false },
      { label: 'Valence', value: f.valence, unit: f.valence.toFixed(3), glow: false, bipolar: false },
      { label: 'Tension', value: f.tension, unit: f.tension.toFixed(3), glow: f.tension > 0.6, bipolar: false },
      { label: 'E.Trend', value: f.energyTrend, unit: trendUnit, glow: false, bipolar: true },
      { label: 'Buildup', value: f.buildupIntensity, unit: f.buildupIntensity.toFixed(3), glow: f.buildupIntensity > 0.7, bipolar: false },
    ]
    const rowH = h / rows.length
    rows.forEach((r, i) => this.drawBar(r.label, r.value, r.unit, x, y + i * rowH, w, rowH, accent, r.glow, r.bipolar))
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  destroy(): void {}
}
