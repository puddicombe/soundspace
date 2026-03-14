import type { AudioFeatures } from './AudioFeatures'

// Band boundaries in Hz
const BAND_EDGES_HZ = [0, 60, 250, 2000, 20000] as const

// Spectral rolloff threshold
const ROLLOFF_THRESHOLD = 0.85

// Onset detection: adaptive threshold multiplier
const ONSET_THRESHOLD_MULTIPLIER = 1.3
const ONSET_MIN_GAP_FRAMES = 8  // debounce — ~130ms at 60fps

// Ring buffer sizes
const RMS_HISTORY_FRAMES = 180   // ~3s at 60fps
const ONSET_HISTORY_FRAMES = 360 // ~6s at 60fps for BPM autocorrelation

// BPM update cadence
const BPM_UPDATE_EVERY_FRAMES = 120  // ~2s

// Pitch classes C D♭ D E♭ E F F# G A♭ A B♭ B
const PITCH_CLASS_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const

// ── Krumhansl-Schmuckler key profiles (1990) ─────────────────────────────────
// Psychoacoustically-derived from listener experiments. Each profile describes
// how well each pitch class "fits" a given key. Two profiles: major and minor.
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88]
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17]

// Normalise profiles to zero-mean for Pearson correlation matching
function normProfile(p: number[]): number[] {
  const mean = p.reduce((a, b) => a + b, 0) / p.length
  return p.map(v => v - mean)
}
const KS_MAJOR_NORM = normProfile(KS_MAJOR)
const KS_MINOR_NORM = normProfile(KS_MINOR)

// ── Chord triad templates ─────────────────────────────────────────────────────
// Weighted triads: root is most identifying, fifth reinforces, third defines quality.
// Templates are zero-mean normalised + unit-length so that dot(zmChroma, template)
// gives the Pearson correlation — this penalises non-chord tones and is scale-invariant.
function buildChordTemplate(root: number, quality: 'maj' | 'min'): Float32Array {
  const t = new Float32Array(12)
  t[root % 12] = 1.0                                     // root — most identifying
  t[(root + (quality === 'maj' ? 4 : 3)) % 12] = 0.5    // third — defines major/minor
  t[(root + 7) % 12] = 0.7                               // fifth — reinforces root
  // Zero-mean: non-chord tones become slightly negative (penalty for dissonance)
  const mean = t.reduce((a, v) => a + v, 0) / 12
  for (let i = 0; i < 12; i++) t[i] -= mean
  // Unit-length: ensures Pearson correlation, not scale-dependent dot product
  const norm = Math.sqrt(t.reduce((a, v) => a + v * v, 0))
  for (let i = 0; i < 12; i++) t[i] /= norm
  return t
}

const CHORD_TEMPLATES: Array<{ name: string; template: Float32Array }> = []
for (let root = 0; root < 12; root++) {
  CHORD_TEMPLATES.push({ name: PITCH_CLASS_NAMES[root],       template: buildChordTemplate(root, 'maj') })
  CHORD_TEMPLATES.push({ name: PITCH_CLASS_NAMES[root] + 'm', template: buildChordTemplate(root, 'min') })
}

// Chroma update rates
const CHORD_UPDATE_FRAMES = 30    // ~500ms at 60fps (was 60/~1s)
const KEY_UPDATE_FRAMES   = 240   // ~4s at 60fps
const CHROMA_SMOOTH_ALPHA = 0.15  // EMA smoothing factor for timer-based chord detection
// Frames to wait after an onset before snapping chord (attack transient settles ~130ms)
const CHORD_SETTLE_FRAMES = 8

// Pitch detection
const PITCH_UPDATE_EVERY = 4      // update every 4 frames (~67ms) — autocorrelation is expensive

// Pairwise interval dissonance weights (semitones 0–11)
// Based on psychoacoustic consonance/dissonance rankings
const INTERVAL_DISSONANCE = [0, 1.0, 0.8, 0.3, 0.2, 0.15, 0.9, 0.1, 0.3, 0.2, 0.7, 0.9] as const

// Energy trend: slow EMA alpha for RMS baseline
const ENERGY_TREND_ALPHA = 0.02

// Spectral centroid trend: same cadence as energy trend
const CENTROID_TREND_ALPHA = 0.02

// Onset density: exponential decay per frame (1 onset/frame = ~60/s; normalise by 4 onsets/s)
const ONSET_DENSITY_DECAY = 1 - 1 / 60

// Pitch stability: rolling window size (~1s at 60fps)
const PITCH_HISTORY_FRAMES = 60

export class FeatureExtractor {
  private binCount: number
  private sampleRate: number

  // Per-frame state
  private prevFFT: Float32Array
  private prevOnsetStrength = 0
  private frameCount = 0

  // Chroma mapping: chromaMap[pc] = array of bin indices for that pitch class
  private chromaMap: number[][]

  // Band bin ranges: bandBins[i] = [startBin, endBin]
  private bandBins: [number, number][]

  // Ring buffers
  private rmsHistory: Float32Array
  private rmsHead = 0
  private rmsCount = 0

  private onsetHistory: Float32Array
  private onsetHead = 0
  private onsetCount = 0

  // Windowed outputs (lazy-updated)
  private currentBPM: number | null = null
  private currentDynamicComplexity = 0

  // Beat clock
  private beatPhase = 0
  private lastOnsetFrame = -999
  private beatsPerFrame = 0  // fractional beats per animation frame

  // Chord / key detection
  private chromaSmoothed = new Float32Array(12)
  private chromaAccum = new Float32Array(12)   // accumulates for key (longer window)
  private chromaAccumCount = 0
  private currentChord: string | null = null
  private currentChordCandidates: ReadonlyArray<{ chord: string; score: number }> = []
  private currentKey: string | null = null
  private chordFrameCount = 0
  private keyFrameCount = 0
  // Onset-triggered chord detection: count down frames after a strum
  private postOnsetSettle = 0

  // Chroma novelty: previous chroma for L2 delta
  private prevChroma = new Float32Array(12)

  // Predominant pitch (updated every PITCH_UPDATE_EVERY frames)
  private currentPredominantPitch: number | null = null
  private pitchFrameCount = 0

  // Chord duration tracking
  private prevChordForDuration: string | null | undefined = undefined  // sentinel
  private chordDurationFrames = 0

  // Onset density (EMA accumulator)
  private onsetDensityAccum = 0

  // Energy trend (slow RMS baseline)
  private rmsBaseline = 0

  // Spectral centroid trend (slow centroid baseline)
  private centroidBaseline = 0

  // Pitch stability: ring buffer of recent pitch values (0 = null/silent)
  private pitchHistory: Float32Array
  private pitchHistoryHead = 0
  private pitchHistoryCount = 0

  // Signal presence: asymmetric EMA gate (fast rise, slow fall)
  private signalPresenceAccum = 0

  constructor(binCount: number, fftSize: number, sampleRate: number) {
    this.binCount = binCount
    this.sampleRate = sampleRate

    this.prevFFT = new Float32Array(binCount)
    this.rmsHistory = new Float32Array(RMS_HISTORY_FRAMES)
    this.onsetHistory = new Float32Array(ONSET_HISTORY_FRAMES)
    this.pitchHistory = new Float32Array(PITCH_HISTORY_FRAMES)

    // Pre-compute chroma mapping
    // For each FFT bin, determine which pitch class (0–11) it maps to.
    // Range restricted to 80–2000 Hz: covers all guitar fundamental frequencies
    // (E2=82Hz to ~B5=988Hz) without being overwhelmed by the many high-frequency
    // bins (>2kHz) that at fftSize=4096/44.1kHz account for >80% of all bins
    // but carry mainly harmonics and noise rather than fundamentals.
    this.chromaMap = Array.from({ length: 12 }, () => [] as number[])
    for (let b = 1; b < binCount; b++) {
      const freq = b * sampleRate / (fftSize)
      if (freq < 80 || freq > 2000) continue
      const midi = 12 * Math.log2(freq / 440) + 69
      const pc = ((Math.round(midi) % 12) + 12) % 12
      this.chromaMap[pc].push(b)
    }

    // Pre-compute band bin ranges
    this.bandBins = BAND_EDGES_HZ.slice(0, -1).map((lo, i) => {
      const hi = BAND_EDGES_HZ[i + 1]
      const startBin = Math.max(1, Math.floor(lo * fftSize / sampleRate))
      const endBin = Math.min(binCount - 1, Math.ceil(hi * fftSize / sampleRate))
      return [startBin, endBin] as [number, number]
    })
  }

  extract(fftData: Float32Array, waveData: Float32Array): AudioFeatures {
    this.frameCount++
    const { binCount, sampleRate } = this

    // ── RMS & Crest ──────────────────────────────────────────────
    let sumSq = 0
    let peak = 0
    for (let i = 0; i < waveData.length; i++) {
      const v = Math.abs(waveData[i])
      sumSq += v * v
      if (v > peak) peak = v
    }
    const rms = Math.sqrt(sumSq / waveData.length)
    // Raw crest factor (peak/RMS, scaled so 4× = 1.0), then gated by signal power.
    // Without the gate, even near-silent audio has a high geometric peak/RMS ratio,
    // making crest meaninglessly high when nothing is playing.
    // powerGate ramps from 0→1 as rms goes 0→0.08; above that, full crest is shown.
    const rawCrest = rms > 0 ? Math.min(1, peak / (rms * 4)) : 0
    const powerGate = Math.min(1, rms / 0.08)
    const crest = rawCrest * powerGate

    // ── Signal Presence ───────────────────────────────────────────
    // Asymmetric EMA: rises fast when RMS climbs above noise floor (~0.05),
    // falls slowly so short pauses (gaps between phrases) don't cause flicker.
    // Ratio-based features (harmonicRatio, percussiveRatio, tension, chromaNovelty)
    // are gated by this value to prevent misleading readings during silence.
    const presenceTarget = Math.min(1, rms / 0.05)
    const presenceAlpha = presenceTarget > this.signalPresenceAccum ? 0.1 : 0.02
    this.signalPresenceAccum = (1 - presenceAlpha) * this.signalPresenceAccum + presenceAlpha * presenceTarget
    const signalPresence = this.signalPresenceAccum

    // Store RMS in ring buffer
    this.rmsHistory[this.rmsHead] = rms
    this.rmsHead = (this.rmsHead + 1) % RMS_HISTORY_FRAMES
    if (this.rmsCount < RMS_HISTORY_FRAMES) this.rmsCount++

    // ── Zero Crossing Rate ────────────────────────────────────────
    let crossings = 0
    for (let i = 1; i < waveData.length; i++) {
      if ((waveData[i - 1] ?? 0) * (waveData[i] ?? 0) < 0) crossings++
    }
    const zcr = Math.min(1, crossings / (waveData.length * 0.5))

    // ── Band Energies ─────────────────────────────────────────────
    const bandEnergy: [number, number, number, number] = [0, 0, 0, 0]
    for (let b = 0; b < 4; b++) {
      const [start, end] = this.bandBins[b]
      let sum = 0
      let count = 0
      for (let i = start; i <= end; i++) {
        sum += fftData[i] ?? 0
        count++
      }
      bandEnergy[b] = count > 0 ? Math.min(1, sum / count) : 0
    }

    // ── Spectral Centroid ─────────────────────────────────────────
    let weightedSum = 0
    let magSum = 0
    for (let i = 0; i < binCount; i++) {
      const mag = fftData[i] ?? 0
      const freq = i * sampleRate / (binCount * 2)
      weightedSum += freq * mag
      magSum += mag
    }
    const spectralCentroid = magSum > 0 ? weightedSum / magSum : 0

    // ── Spectral Rolloff ──────────────────────────────────────────
    const target = magSum * ROLLOFF_THRESHOLD
    let cumulative = 0
    let spectralRolloff = 0
    for (let i = 0; i < binCount; i++) {
      cumulative += fftData[i] ?? 0
      if (cumulative >= target) {
        spectralRolloff = i * sampleRate / (binCount * 2)
        break
      }
    }

    // ── Spectral Flatness ─────────────────────────────────────────
    // geometric mean / arithmetic mean of positive magnitudes
    let logSum = 0
    let arithmeticSum = 0
    let validBins = 0
    for (let i = 1; i < binCount; i++) {
      const v = fftData[i] ?? 0
      if (v > 0) {
        logSum += Math.log(v)
        arithmeticSum += v
        validBins++
      }
    }
    let spectralFlatness = 0
    if (validBins > 0 && arithmeticSum > 0) {
      const geoMean = Math.exp(logSum / validBins)
      const arithMean = arithmeticSum / validBins
      spectralFlatness = Math.min(1, geoMean / arithMean)
    }

    // ── Spectral Flux ─────────────────────────────────────────────
    let fluxSum = 0
    for (let i = 0; i < binCount; i++) {
      const diff = (fftData[i] ?? 0) - (this.prevFFT[i] ?? 0)
      if (diff > 0) fluxSum += diff
    }
    const spectralFlux = Math.min(1, fluxSum / (binCount * 0.1))

    // Update prev FFT
    this.prevFFT.set(fftData)

    // ── Onset Detection ───────────────────────────────────────────
    // Onset strength = positive spectral flux across all bands
    const onsetStrength = spectralFlux

    // Adaptive threshold: mean of recent onset history × multiplier
    let onsetMean = 0
    const windowLen = Math.min(this.onsetCount, 30)
    for (let i = 0; i < windowLen; i++) {
      const idx = (this.onsetHead - 1 - i + ONSET_HISTORY_FRAMES) % ONSET_HISTORY_FRAMES
      onsetMean += this.onsetHistory[idx]
    }
    onsetMean = windowLen > 0 ? onsetMean / windowLen : 0

    const isOnset =
      onsetStrength > onsetMean * ONSET_THRESHOLD_MULTIPLIER &&
      onsetStrength > 0.05 &&
      (this.frameCount - this.lastOnsetFrame) >= ONSET_MIN_GAP_FRAMES

    // Store onset strength in ring buffer
    this.onsetHistory[this.onsetHead] = onsetStrength
    this.onsetHead = (this.onsetHead + 1) % ONSET_HISTORY_FRAMES
    if (this.onsetCount < ONSET_HISTORY_FRAMES) this.onsetCount++

    // ── Beat Phase ────────────────────────────────────────────────
    if (isOnset) {
      const gapFrames = this.frameCount - this.lastOnsetFrame
      if (gapFrames > ONSET_MIN_GAP_FRAMES && gapFrames < ONSET_HISTORY_FRAMES) {
        // Smooth BPM from beat interval
        const newBeatsPerFrame = 1 / gapFrames
        this.beatsPerFrame = this.beatsPerFrame > 0
          ? 0.85 * this.beatsPerFrame + 0.15 * newBeatsPerFrame
          : newBeatsPerFrame
      }
      this.lastOnsetFrame = this.frameCount
      this.beatPhase = 0
    } else {
      this.beatPhase = this.beatsPerFrame > 0
        ? (this.beatPhase + this.beatsPerFrame) % 1
        : 0
    }

    // ── Chroma ───────────────────────────────────────────────────
    const chroma = new Float32Array(12)
    if (magSum > 0) {
      for (let pc = 0; pc < 12; pc++) {
        let sum = 0
        const bins = this.chromaMap[pc]
        for (const b of bins) sum += fftData[b] ?? 0
        chroma[pc] = bins.length > 0 ? sum / bins.length : 0
      }
      // Normalise chroma to [0, 1]
      let chromaMax = 0
      for (let i = 0; i < 12; i++) if (chroma[i] > chromaMax) chromaMax = chroma[i]
      if (chromaMax > 0) for (let i = 0; i < 12; i++) chroma[i] /= chromaMax
    }

    // ── Chord & Key Detection ─────────────────────────────────────
    this.chordFrameCount++
    this.keyFrameCount++

    // EMA-smooth chroma for timer-based chord detection
    for (let i = 0; i < 12; i++) {
      this.chromaSmoothed[i] =
        CHROMA_SMOOTH_ALPHA * chroma[i] + (1 - CHROMA_SMOOTH_ALPHA) * this.chromaSmoothed[i]
    }

    // Accumulate raw chroma for key estimation
    for (let i = 0; i < 12; i++) this.chromaAccum[i] += chroma[i]
    this.chromaAccumCount++

    // Onset-triggered: when a strum is detected, reset EMA and schedule
    // a chord snapshot after CHORD_SETTLE_FRAMES (~133ms) for the attack to settle
    if (isOnset) {
      this.chromaSmoothed.set(chroma)  // reset EMA — previous chord bleed cleared
      this.postOnsetSettle = CHORD_SETTLE_FRAMES
      this.chordFrameCount = 0        // stop timer double-firing shortly after onset
    }

    // Onset-triggered detection: fires once the settle countdown reaches zero
    if (this.postOnsetSettle > 0) {
      this.postOnsetSettle--
      if (this.postOnsetSettle === 0) {
        // Use raw per-frame chroma — cleanest view of the chord tone after attack
        this.matchChord(chroma, magSum)
        this.chordFrameCount = 0
      }
    }

    // Timer-based fallback: catches sustained notes and cases with no clear onset
    if (this.chordFrameCount >= CHORD_UPDATE_FRAMES) {
      this.chordFrameCount = 0
      this.matchChord(this.chromaSmoothed, magSum)
    }

    // Key: Krumhansl-Schmuckler every KEY_UPDATE_FRAMES
    if (this.keyFrameCount >= KEY_UPDATE_FRAMES && this.chromaAccumCount > 0) {
      this.keyFrameCount = 0
      // Average chroma over the accumulation window, normalise to zero-mean
      const avg = new Float32Array(12)
      let avgMean = 0
      for (let i = 0; i < 12; i++) { avg[i] = this.chromaAccum[i] / this.chromaAccumCount; avgMean += avg[i] }
      avgMean /= 12
      const avgNorm = avg.map(v => v - avgMean)
      // Reset accumulator
      this.chromaAccum.fill(0)
      this.chromaAccumCount = 0

      // Pearson correlation with each rotated KS profile
      let bestCorr = -Infinity
      let bestKey = ''
      for (let root = 0; root < 12; root++) {
        // Major
        let dotMaj = 0; let varA = 0; let varBMaj = 0
        for (let i = 0; i < 12; i++) {
          const kv = KS_MAJOR_NORM[(i - root + 12) % 12]
          dotMaj += avgNorm[i] * kv
          varA += avgNorm[i] * avgNorm[i]
          varBMaj += kv * kv
        }
        const corrMaj = (varA > 0 && varBMaj > 0) ? dotMaj / Math.sqrt(varA * varBMaj) : 0
        if (corrMaj > bestCorr) { bestCorr = corrMaj; bestKey = `${PITCH_CLASS_NAMES[root]} major` }

        // Minor
        let dotMin = 0; let varBMin = 0
        for (let i = 0; i < 12; i++) {
          const kv = KS_MINOR_NORM[(i - root + 12) % 12]
          dotMin += avgNorm[i] * kv
          varBMin += kv * kv
        }
        const corrMin = (varA > 0 && varBMin > 0) ? dotMin / Math.sqrt(varA * varBMin) : 0
        if (corrMin > bestCorr) { bestCorr = corrMin; bestKey = `${PITCH_CLASS_NAMES[root]} minor` }
      }
      if (magSum > 0) this.currentKey = bestKey
      else this.currentKey = null
    }

    // ── Windowed: Dynamic Complexity (every ~60 frames) ───────────
    if (this.frameCount % 60 === 0 && this.rmsCount >= 60) {
      let mean = 0
      const n = Math.min(this.rmsCount, RMS_HISTORY_FRAMES)
      for (let i = 0; i < n; i++) mean += this.rmsHistory[i]
      mean /= n
      let variance = 0
      for (let i = 0; i < n; i++) {
        const d = this.rmsHistory[i] - mean
        variance += d * d
      }
      this.currentDynamicComplexity = Math.min(1, Math.sqrt(variance / n) * 4)
    }

    // ── Windowed: BPM (every ~120 frames via autocorrelation) ─────
    if (this.frameCount % BPM_UPDATE_EVERY_FRAMES === 0 && this.onsetCount >= ONSET_HISTORY_FRAMES) {
      this.currentBPM = this.estimateBPM()
    }
    // Keep BPM from beat-clock as fallback estimate
    const bpmClockEstimate = this.beatsPerFrame > 0
      ? Math.round(this.beatsPerFrame * 60 * 60)  // frames×60fps×60s = bpm
      : null
    const bpm = this.currentBPM ?? bpmClockEstimate

    // ── Harmonic / Percussive Proxy ───────────────────────────────
    // Chroma entropy: how evenly spread is energy across pitch classes?
    // Low entropy + low flatness → strong single pitch class = harmonic/tonal
    let chromaEntropy = 0
    let chromaSum = 0
    for (let i = 0; i < 12; i++) chromaSum += chroma[i]
    if (chromaSum > 0) {
      for (let i = 0; i < 12; i++) {
        const p = chroma[i] / chromaSum
        if (p > 0) chromaEntropy -= p * Math.log2(p)
      }
      chromaEntropy /= Math.log2(12)  // normalise [0, 1]
    }
    const harmonicRatio = Math.min(1, (1 - chromaEntropy) * (1 - spectralFlatness))
    const percussiveRatio = Math.min(1, spectralFlux * crest * 2)

    // ── Chroma Novelty ────────────────────────────────────────────
    // L2 distance between current and previous chroma frame
    let noveltySum = 0
    for (let i = 0; i < 12; i++) {
      const d = chroma[i] - this.prevChroma[i]
      noveltySum += d * d
    }
    const chromaNovelty = Math.min(1, Math.sqrt(noveltySum))
    this.prevChroma.set(chroma)

    // ── Predominant Pitch ─────────────────────────────────────────
    // Normalised autocorrelation of waveform; updated every PITCH_UPDATE_EVERY frames
    this.pitchFrameCount++
    if (this.pitchFrameCount >= PITCH_UPDATE_EVERY) {
      this.pitchFrameCount = 0
      this.currentPredominantPitch = this.computePitch(waveData, rms)
    }

    // ── Onset Density ─────────────────────────────────────────────
    // EMA accumulator: 1 onset/s → ~0.25 (4 onset/s → 1.0)
    this.onsetDensityAccum = this.onsetDensityAccum * ONSET_DENSITY_DECAY + (isOnset ? 1 : 0)
    const onsetDensity = Math.min(1, this.onsetDensityAccum / 4)

    // ── Energy Trend ──────────────────────────────────────────────
    // Compare current RMS to a slow-moving baseline; positive = getting louder
    if (this.rmsBaseline === 0 && rms > 0) {
      this.rmsBaseline = rms
    } else {
      this.rmsBaseline = (1 - ENERGY_TREND_ALPHA) * this.rmsBaseline + ENERGY_TREND_ALPHA * rms
    }
    const rawTrend = (rms - this.rmsBaseline) / (this.rmsBaseline + 0.005)
    const energyTrend = Math.max(-1, Math.min(1, rawTrend * 3))

    // ── Spectral Centroid Trend ───────────────────────────────────
    // Same shape as energyTrend but tracking spectral brightness direction
    if (this.centroidBaseline === 0 && spectralCentroid > 0) {
      this.centroidBaseline = spectralCentroid
    } else if (spectralCentroid > 0) {
      this.centroidBaseline = (1 - CENTROID_TREND_ALPHA) * this.centroidBaseline + CENTROID_TREND_ALPHA * spectralCentroid
    }
    const rawCentroidTrend = (spectralCentroid - this.centroidBaseline) / (this.centroidBaseline + 1)
    const spectralCentroidTrend = Math.max(-1, Math.min(1, rawCentroidTrend * 3))

    // ── Pitch Stability ───────────────────────────────────────────
    // Store latest pitch in ring buffer (0 = no pitch detected)
    const pitchSample = this.currentPredominantPitch ?? 0
    this.pitchHistory[this.pitchHistoryHead] = pitchSample
    this.pitchHistoryHead = (this.pitchHistoryHead + 1) % PITCH_HISTORY_FRAMES
    if (this.pitchHistoryCount < PITCH_HISTORY_FRAMES) this.pitchHistoryCount++

    let pitchStability = 0
    const pitchN = Math.min(this.pitchHistoryCount, PITCH_HISTORY_FRAMES)
    // Only compute if we have enough non-zero samples
    let pitchSum = 0; let validPitch = 0
    for (let i = 0; i < pitchN; i++) {
      const v = this.pitchHistory[i] ?? 0
      if (v > 0) { pitchSum += v; validPitch++ }
    }
    if (validPitch >= 10) {
      const pitchMean = pitchSum / validPitch
      let pitchVar = 0
      for (let i = 0; i < pitchN; i++) {
        const v = this.pitchHistory[i] ?? 0
        if (v > 0) { const d = v - pitchMean; pitchVar += d * d }
      }
      // Coefficient of variation: std / mean; ~0.05 = very stable, ~0.3+ = jumping around
      const cv = Math.sqrt(pitchVar / validPitch) / (pitchMean + 1)
      pitchStability = Math.max(0, 1 - cv * 6)
    }

    // ── Buildup Intensity ─────────────────────────────────────────
    // Composite "pre-drop" or "rising tension" signal.
    // High when: energy is building, onset rate is climbing, spectrum is brightening.
    const buildupIntensity = Math.min(1,
      0.40 * Math.max(0, energyTrend) +
      0.35 * onsetDensity +
      0.25 * Math.max(0, spectralCentroidTrend)
    )

    // ── Chord Duration ────────────────────────────────────────────
    if (this.currentChord !== this.prevChordForDuration) {
      this.chordDurationFrames = 0
      this.prevChordForDuration = this.currentChord
    } else {
      this.chordDurationFrames++
    }
    const chordDuration = this.chordDurationFrames / 60

    // ── Valence ───────────────────────────────────────────────────
    // Major key/chord → happier (0.8), minor → sadder (0.2), unknown → neutral (0.5)
    const keyValence = this.currentKey === null ? 0.5
      : (this.currentKey.includes('minor') ? 0.2 : 0.8)
    const chordValence = this.currentChord === null ? 0.5
      : (this.currentChord.endsWith('m') ? 0.2 : 0.8)
    const valence = 0.6 * keyValence + 0.4 * chordValence

    // ── Tension ───────────────────────────────────────────────────
    // Weighted pairwise interval dissonance between active pitch classes
    let tensionSum = 0
    let tensionWeight = 0
    const CHROMA_THRESHOLD = 0.3
    for (let i = 0; i < 12; i++) {
      if (chroma[i] < CHROMA_THRESHOLD) continue
      for (let j = i + 1; j < 12; j++) {
        if (chroma[j] < CHROMA_THRESHOLD) continue
        const interval = (j - i) % 12
        const w = chroma[i] * chroma[j]
        tensionSum += INTERVAL_DISSONANCE[interval] * w
        tensionWeight += w
      }
    }
    const tension = tensionWeight > 0 ? Math.min(1, tensionSum / tensionWeight) : 0

    // ── Affective Proxies ─────────────────────────────────────────
    const centroidNorm = Math.min(1, spectralCentroid / 4000)
    const bpmNorm = bpm ? Math.min(1, (bpm - 60) / 120) : 0
    const arousal = Math.min(1,
      0.35 * rms + 0.25 * onsetStrength + 0.25 * centroidNorm + 0.15 * bpmNorm
    )
    // Warmth: dominated by low frequencies, inverse of brightness
    const warmth = Math.min(1,
      0.5 * (bandEnergy[0] + bandEnergy[1]) + 0.3 * (1 - centroidNorm) + 0.2 * rms
    )

    // ── Apply signal-presence gate to ratio-based features ────────
    // Without this, features computed from spectral ratios (chroma entropy,
    // dissonance intervals, etc.) produce artefactual non-zero readings during
    // silence or fade-outs that would mislead renderers.
    const gatedHarmonicRatio = harmonicRatio * signalPresence
    const gatedPercussiveRatio = percussiveRatio * signalPresence
    const gatedTension = tension * signalPresence
    const gatedChromaNovelty = chromaNovelty * signalPresence

    return {
      rms,
      signalPresence,
      crest,
      zcr,
      bandEnergy,
      spectralCentroid,
      spectralFlux,
      spectralRolloff,
      spectralFlatness,
      harmonicRatio: gatedHarmonicRatio,
      percussiveRatio: gatedPercussiveRatio,
      onsetStrength,
      isOnset,
      chroma,
      chromaNovelty: gatedChromaNovelty,
      predominantPitch: this.currentPredominantPitch,
      bpm,
      beatPhase: this.beatPhase,
      dynamicComplexity: this.currentDynamicComplexity,
      onsetDensity,
      energyTrend,
      spectralCentroidTrend,
      pitchStability,
      buildupIntensity,
      key: this.currentKey,
      chord: this.currentChord,
      chordDuration,
      chordCandidates: this.currentChordCandidates,
      arousal,
      warmth,
      valence,
      tension: gatedTension,
    }
  }

  // ── Chord matching: Pearson correlation of zero-mean chroma vs pre-normalised templates ──
  private matchChord(chroma: Float32Array, magSum: number): void {
    if (magSum <= 0) {
      this.currentChord = null
      this.currentChordCandidates = []
      return
    }
    // Zero-mean chroma + L2 norm (denominator of Pearson correlation)
    let mean = 0
    for (let i = 0; i < 12; i++) mean += chroma[i]
    mean /= 12
    const zmChroma = new Float32Array(12)
    let chromaL2 = 0
    for (let i = 0; i < 12; i++) {
      zmChroma[i] = chroma[i] - mean
      chromaL2 += zmChroma[i] * zmChroma[i]
    }
    const chromaNorm = Math.sqrt(chromaL2)
    if (chromaNorm === 0) {
      this.currentChord = null
      this.currentChordCandidates = []
      return
    }
    // Score = dot(zmChroma, template) / chromaNorm
    // Templates are already zero-mean + unit-length, so this is the full Pearson correlation
    const scores: Array<{ chord: string; score: number }> = []
    for (const { name, template } of CHORD_TEMPLATES) {
      let dot = 0
      for (let i = 0; i < 12; i++) dot += zmChroma[i] * template[i]
      scores.push({ chord: name, score: dot / chromaNorm })
    }
    scores.sort((a, b) => b.score - a.score)
    const best = scores[0]
    if (!best || best.score <= 0) {
      this.currentChord = null
      this.currentChordCandidates = []
      return
    }
    // Normalise so best candidate = 1.0; others proportional
    this.currentChordCandidates = scores.slice(0, 5).map(s => ({
      chord: s.chord,
      score: Math.max(0, s.score / best.score),
    }))
    this.currentChord = best.chord
  }

  // ── Normalised autocorrelation pitch detection ────────────────
  // Finds the lag that maximises waveform self-similarity → fundamental period.
  // Restricted to 80–1200Hz (guitar/vocal range). Returns null if signal is too
  // quiet (rms < 0.05) or if the best correlation is too weak (< 0.15).
  private computePitch(waveData: Float32Array, rms: number): number | null {
    if (rms < 0.05) return null
    const N = Math.min(waveData.length, 2048)
    const minLag = Math.ceil(this.sampleRate / 1200)   // ~37 samples at 44.1kHz
    const maxLag = Math.floor(Math.min(this.sampleRate / 80, N / 2))
    if (minLag >= maxLag) return null

    let sumSq = 0
    for (let i = 0; i < N; i++) sumSq += (waveData[i] ?? 0) * (waveData[i] ?? 0)
    if (sumSq === 0) return null

    let bestLag = -1
    let bestCorr = -1
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0
      const n = N - lag
      for (let i = 0; i < n; i++) corr += (waveData[i] ?? 0) * (waveData[i + lag] ?? 0)
      const normCorr = corr / sumSq
      if (normCorr > bestCorr) {
        bestCorr = normCorr
        bestLag = lag
      }
    }
    if (bestLag <= 0 || bestCorr < 0.15) return null
    return this.sampleRate / bestLag
  }

  private estimateBPM(): number | null {
    // Autocorrelation of onset history
    // BPM range 60–180 → lag range in frames at 60fps: 20–60 frames
    const MIN_LAG = 20  // 60fps / 20 frames = 3 beats/s = 180 BPM
    const MAX_LAG = 60  // 60fps / 60 frames = 1 beat/s = 60 BPM
    const n = ONSET_HISTORY_FRAMES

    let bestLag = -1
    let bestCorr = -Infinity

    for (let lag = MIN_LAG; lag <= MAX_LAG; lag++) {
      let corr = 0
      for (let i = 0; i < n - lag; i++) {
        const idx1 = (this.onsetHead - 1 - i + n) % n
        const idx2 = (this.onsetHead - 1 - i - lag + n) % n
        corr += (this.onsetHistory[idx1] ?? 0) * (this.onsetHistory[idx2] ?? 0)
      }
      if (corr > bestCorr) {
        bestCorr = corr
        bestLag = lag
      }
    }

    if (bestLag <= 0) return null
    return Math.round(60 * 60 / bestLag)  // 60fps × 60s / lag_frames
  }

  reset(): void {
    this.prevFFT.fill(0)
    this.rmsHistory.fill(0)
    this.onsetHistory.fill(0)
    this.rmsHead = 0
    this.rmsCount = 0
    this.onsetHead = 0
    this.onsetCount = 0
    this.frameCount = 0
    this.beatPhase = 0
    this.lastOnsetFrame = -999
    this.beatsPerFrame = 0
    this.currentBPM = null
    this.currentDynamicComplexity = 0
    this.prevOnsetStrength = 0
    this.chromaSmoothed.fill(0)
    this.chromaAccum.fill(0)
    this.chromaAccumCount = 0
    this.currentChord = null
    this.currentChordCandidates = []
    this.currentKey = null
    this.chordFrameCount = 0
    this.keyFrameCount = 0
    this.postOnsetSettle = 0
    this.prevChroma.fill(0)
    this.currentPredominantPitch = null
    this.pitchFrameCount = 0
    this.prevChordForDuration = undefined
    this.chordDurationFrames = 0
    this.onsetDensityAccum = 0
    this.rmsBaseline = 0
    this.centroidBaseline = 0
    this.pitchHistory.fill(0)
    this.pitchHistoryHead = 0
    this.pitchHistoryCount = 0
    this.signalPresenceAccum = 0
  }
}

export { PITCH_CLASS_NAMES }
