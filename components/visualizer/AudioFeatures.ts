export interface AudioFeatures {
  // --- Tier 1: Per-frame energy & dynamics ---
  rms: number                              // 0–1 RMS loudness
  signalPresence: number                   // 0–1 smoothed gate (fast rise α=0.1, slow fall α=0.02) — 0 during silence/fade
  crest: number                            // 0–1 peak/RMS punchiness
  zcr: number                              // 0–1 zero-crossing rate

  // --- Tier 1: Band energies (sub-bass / bass / mid / high) ---
  bandEnergy: [number, number, number, number]  // each 0–1

  // --- Tier 1: Spectral character ---
  spectralCentroid: number                 // Hz — "brightness"
  spectralFlux: number                     // 0–1 — frame-to-frame change
  spectralRolloff: number                  // Hz — 85% energy threshold
  spectralFlatness: number                 // 0 = tonal, 1 = noise

  // --- Tier 1: Harmonic / Percussive proxy ---
  harmonicRatio: number                    // 0–1 tonal/harmonic content (low chroma entropy + low flatness)
  percussiveRatio: number                  // 0–1 transient/percussive content (high flux × crest)

  // --- Tier 1: Rhythm ---
  onsetStrength: number                    // 0–1
  isOnset: boolean                         // significant musical event this frame

  // --- Tier 2: Chroma (12 pitch classes C–B) ---
  chroma: Float32Array                     // length 12, each 0–1
  chromaNovelty: number                    // 0–1 frame-to-frame L2 distance — chord change signal

  // --- Tier 2: Pitch ---
  predominantPitch: number | null          // Hz — monophonic fundamental (null if silent or noisy)

  // --- Tier 3: Windowed ---
  bpm: number | null                       // null until enough onset history
  beatPhase: number                        // 0–1 position within beat period
  dynamicComplexity: number               // 0–1 loudness variability (3s window)
  onsetDensity: number                     // 0–1 onsets-per-second rate (EMA, ~4 onsets/s = 1.0)
  energyTrend: number                      // -1 to +1 getting softer → louder vs slow baseline
  spectralCentroidTrend: number            // -1 to +1 getting darker → brighter vs slow baseline
  pitchStability: number                   // 0–1 how steady the pitch has been over ~1s (0 = jumping around)
  buildupIntensity: number                 // 0–1 composite "pre-drop" signal (rising energy + density + brightness)
  key: string | null                       // e.g. "C major", "A minor" — updated every ~4s
  chord: string | null                     // e.g. "C", "Am" — updated on onset or every ~500ms
  chordDuration: number                    // seconds since last chord change
  /** Top 5 chord candidates sorted by Pearson correlation. Best = 1.0, others proportional.
   *  Empty until first detection. Use for accuracy testing and confidence display. */
  chordCandidates: ReadonlyArray<{ chord: string; score: number }>

  // --- Tier 4: Affective proxies ---
  arousal: number                          // 0–1 calm → excited
  warmth: number                           // 0–1 cold → warm
  valence: number                          // 0–1 sad → happy (key + chord quality weighted)
  tension: number                          // 0–1 resolved → tense (pairwise interval dissonance)
}

/** Zero-valued defaults — pass when engine is not running. */
export const NULL_FEATURES: AudioFeatures = {
  rms: 0,
  signalPresence: 0,
  crest: 0,
  zcr: 0,
  bandEnergy: [0, 0, 0, 0],
  spectralCentroid: 0,
  spectralFlux: 0,
  spectralRolloff: 0,
  spectralFlatness: 0,
  harmonicRatio: 0,
  percussiveRatio: 0,
  onsetStrength: 0,
  isOnset: false,
  chroma: new Float32Array(12),
  chromaNovelty: 0,
  predominantPitch: null,
  bpm: null,
  beatPhase: 0,
  dynamicComplexity: 0,
  onsetDensity: 0,
  energyTrend: 0,
  spectralCentroidTrend: 0,
  pitchStability: 0,
  buildupIntensity: 0,
  key: null,
  chord: null,
  chordDuration: 0,
  chordCandidates: [],
  arousal: 0,
  warmth: 0,
  valence: 0.5,
  tension: 0,
}
