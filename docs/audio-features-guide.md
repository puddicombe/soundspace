# Audio Features Reference — soundspace

This document is the complete reference for every field in `AudioFeatures`. It covers the perceptual and computational science behind each dimension, its update cadence, normalisation, and practical patterns for using it in a renderer. It is intended for anyone building or extending a visualiser in this codebase.

---

## Architecture overview

Every animation frame, `VisualizerCanvas` calls:

```typescript
const fft      = engine.getProcessedFFT()   // Float32Array — normalised FFT bins [0–1]
const wave     = engine.getRawWaveform()    // Float32Array — time-domain samples [−1, +1]
const features = engine.getFeatures()       // AudioFeatures — all computed dimensions
renderer.render(fft, wave, features)
```

The raw buffers come directly from the Web Audio API `AnalyserNode`. `FeatureExtractor.extract()` processes those same buffers once per frame to produce `AudioFeatures`. The extractor is instantiated by `AudioEngine` using the actual runtime sample rate and FFT size — it does not assume 44100 Hz.

### Tiers

Features are organised by computational cost and update cadence:

| Tier | Cadence | Examples |
|---|---|---|
| **1 — Per-frame, trivial** | Every frame (~60fps) | rms, spectralCentroid, chroma, isOnset |
| **2 — Per-frame, moderate** | Every frame (4-frame gate for expensive ops) | predominantPitch, chromaNovelty |
| **3 — Windowed** | EMA or ring buffer; effectively continuous | energyTrend, onsetDensity, bpm, key, chord |
| **4 — Derived composites** | Every frame, zero extra cost | arousal, valence, buildupIntensity |

---

## Field reference

### Energy & Dynamics

---

#### `rms: number` — RMS loudness `[0–1]`

Root mean square of the time-domain waveform: `sqrt(Σ x² / N)`. The closest single number to perceived instantaneous loudness.

**Perceptual basis.** Hearing integrates energy over roughly 50–200 ms rather than responding to instantaneous amplitude. RMS over one Web Audio frame (~23 ms at 2048/44.1 kHz) is a good proxy. Typical values: near-silence <0.03, quiet guitar 0.05–0.15, loud electric guitar 0.3–0.7+.

**Academic refs.** Fastl & Zwicker, *Psychoacoustics: Facts and Models* (2007). ISO 532 loudness standards use similar energy-integration principles.

**Renderer uses.** Overall glow intensity, canvas brightness, particle emission count, scale of any pulsing element.

---

#### `crest: number` — Punchiness / transient sharpness `[0–1]`

Peak amplitude divided by RMS, scaled so that a crest factor of 4× maps to 1.0. High crest = loud spikes relative to average = percussive. Low crest = compressed or sustained = smooth.

**Perceptual basis.** Crest factor is the defining difference between a snare hit (high crest) and a bowed string (low crest). Research on loudness and dynamics (Lerch, 2012; EBU R128 loudness standard) uses crest as a measure of dynamic headroom and punch.

**Renderer uses.** Flash intensity on drum hits, particle explosion magnitude, "punch" scale effect on kick, distinguish drums from melodic content.

---

#### `dynamicComplexity: number` — Loudness variability `[0–1]`

Standard deviation of `rms` over a rolling 3-second window (~180 frames), scaled so a std of 0.25 maps to 1.0. Measures how much loudness fluctuates.

**Perceptual basis.** High dynamic complexity = music with dramatic quiet/loud contrasts (classical, folk, jazz). Low = heavily compressed pop or electronic where loudness is maximised and constant. Mierswa & Morik (2005) found dynamic complexity one of the strongest single features for genre classification.

**Update cadence.** Recomputed every 60 frames (~1s) from the RMS ring buffer.

**Renderer uses.** Modulate background texture complexity, vary colour palette shift speed, gate long-form animations, visual "breathing" rate.

---

#### `harmonicRatio: number` — Tonal content `[0–1]`

`(1 − chromaEntropy) × (1 − spectralFlatness)`. High when energy is concentrated in a small number of pitch classes and the spectrum is tonal rather than noise-like.

**Perceptual basis.** Harmonic/percussive source separation is a well-studied MIR problem (Fitzgerald, 2010; Ono et al., 2008). The proxy here avoids the full median-filter HPSS computation: chroma entropy captures pitch-class concentration (a tonal signal produces low-entropy chroma); spectral flatness captures the tonal/noise distinction at the bin level. Both are low for harmonic content, and their combination is robust to cases where one is ambiguous.

**Renderer uses.** Switch renderer style between "smooth and tonal" vs "gritty", colour saturation (saturated when harmonic), fade in harmonic-specific layers.

---

#### `percussiveRatio: number` — Transient content `[0–1]`

`clamp(spectralFlux × crest × 2, 0, 1)`. High when there is rapid spectral change *and* the waveform has strong transient peaks — the joint signature of a percussive event.

**Perceptual basis.** Percussive sounds have high attack energy concentrated in time (high crest) and cause sudden spectral change (high flux). This proxy is not as accurate as full HPSS but has essentially zero extra cost once flux and crest are computed.

**Note.** `harmonicRatio + percussiveRatio` is not constrained to sum to 1 — silence produces both near 0; a complex texture can produce intermediate values of both.

**Renderer uses.** Trigger drum-hit effects, roughen visual texture on percussion, drive separate "hit" layer independent of melody layer.

---

### Band Energies

---

#### `bandEnergy: [number, number, number, number]` — Per-register energy `[each 0–1]`

Mean normalised FFT magnitude in four perceptually motivated frequency bands.

| Index | Band | Hz range | What you hear |
|---|---|---|---|
| 0 | Sub-bass | 0–60 Hz | Synthesiser sub, kick drum body, room resonance below singing range |
| 1 | Bass | 60–250 Hz | Bass guitar, kick drum punch, male vocal chest resonance, cello body |
| 2 | Mid | 250–2000 Hz | Speech intelligibility zone, guitar body, piano, vocals — most musical information |
| 3 | High | 2000–20000 Hz | Consonants, sibilance, hi-hats, string shimmer, presence and air |

**Perceptual basis.** Zwicker's critical band theory (1961) describes cochlear frequency resolution as roughly logarithmic. The 250–2000 Hz region is where the basilar membrane has finest pitch discrimination and where speech and melodic information is most concentrated. The band boundaries here roughly align with the classic sub/bass/mid/treble divisions used in audio engineering.

**Renderer uses.** Map bands to colour channels (sub=deep purple, bass=red, mid=green, high=white), drive independent animation layers, construct a four-channel EQ display.

```typescript
const [sub, bass, mid, high] = features.bandEnergy
ctx.fillStyle = `rgba(${bass * 255}, ${mid * 128}, ${high * 255}, 0.8)`
```

---

### Spectral Character (Timbre)

Spectral features describe the *shape* of the frequency spectrum independent of overall loudness. Timbre is entirely a spectral shape phenomenon — it is what distinguishes a violin from a clarinet playing the same note at the same volume.

---

#### `spectralCentroid: number` — Brightness `[Hz]`

Centre of gravity of the spectrum: `Σ(freq × mag) / Σ(mag)`. Perceived as timbral brightness. High = bright/thin/trebly; low = dark/warm/full.

**Perceptual basis.** Brightness is one of the most consistently rated timbral dimensions across cultures and musical traditions (Grey, 1977; Schubert & Wolfe, 2006). Centroid correlates strongly with perceptual ratings of "bright", "sharp", "metallic" vs "dark", "warm", "dull". Typical ranges: whisper ~500 Hz, speech ~1500 Hz, acoustic guitar ~2000 Hz, cymbal ~8000 Hz.

**Normalise for display:** Divide by 4000–8000 Hz depending on expected content.

**Renderer uses.** Hue shift (warm→cool as brightness rises), glow colour, "air" layer opacity, height of spectral centre-of-mass indicator.

---

#### `spectralCentroidTrend: number` — Brightness direction `[−1 to +1]`

Signed deviation of current `spectralCentroid` from a slow exponential moving average baseline (α = 0.02, time constant ~50 frames / ~800 ms). Positive = spectrum is brightening relative to recent norm; negative = darkening.

**Perceptual basis.** Spectral brightening is a well-known cue for musical tension and build-up. In many styles (EDM builds, classical crescendi), producers raise the high-frequency content in the spectrum before a climactic moment. This feature captures that trajectory in real time.

**Renderer uses.** Hue drift toward blue when brightening, hue drift toward red when darkening; increase sparkle/shimmer layer when positive; input to `buildupIntensity`.

---

#### `spectralFlux: number` — Rate of spectral change `[0–1]`

Half-wave rectified sum of positive FFT differences between consecutive frames: `Σ max(0, |X_t[i]| − |X_{t−1}[i]|)`, normalised. Spikes at every note attack, drum hit, chord change, or transient.

**Perceptual basis.** Flux is the most direct computational cue for onset detection (Dixon, 2006; Böck et al., 2012). The half-wave rectification keeps only energy increases (onsets), discarding energy decreases (note releases), which matches how hearing attends to event starts more than endings.

**Renderer uses.** Trigger on-onset particle bursts, ripple effect on new note, "ripple the canvas" on hit.

---

#### `spectralRolloff: number` — Spectral weight `[Hz]`

The frequency below which 85% of total spectral energy sits. A low rolloff means most energy is bass-heavy; a high rolloff means the spectrum extends into high frequencies.

**Perceptual basis.** Rolloff captures spectral "weight" more robustly than centroid for spectrally uneven signals. Speech rolloff is typically 2–4 kHz; orchestral music 4–8 kHz; broadband noise or cymbals 10 kHz+.

**Renderer uses.** Visual heaviness — size of bass elements, depth of shadow, global visual density.

---

#### `spectralFlatness: number` — Tonal vs. noise-like `[0–1]`

Geometric mean / arithmetic mean of the FFT magnitude spectrum. Near 0 = energy concentrated at a few frequencies (tonal: chord, whistle, sine wave). Near 1 = energy spread flat across all bins (noise: white noise, heavy distortion, fricatives).

**Perceptual basis.** Based on the tonality coefficient in psychoacoustics research (Dubnov, 2004). The ratio of geometric to arithmetic mean is scale-invariant and responds to the ratio of tonal peaks to noise floor. Pitch perception requires flatness < ~0.3; above that sounds are perceived as noisy rather than pitched.

**Renderer uses.** Toggle between smooth tonal visuals and grainy/textured visuals; increase grain when flatness is high; "signal quality" indicator.

---

#### `zcr: number` — Zero-crossing rate `[0–1]`

Number of waveform sign changes per frame, normalised by frame length / 2. High ZCR = rapid oscillation = high-frequency or noisy content. Low ZCR = slow oscillation = low-pitched or sustained content.

**Perceptual basis.** ZCR is a classical speech processing feature (Davis & Mermelstein, 1980) for distinguishing voiced (low ZCR: vowels) from unvoiced (high ZCR: fricatives "s", "f", "sh") phonemes. For music, it separates noisy/high-pitched from low-pitched/smooth content.

**Renderer uses.** Add jitter to lines when ZCR is high, soften visual edges when low, rough texture for percussive/noisy moments.

---

### Pitch & Harmony

---

#### `chroma: Float32Array` — Pitch class profile `[12 values, each 0–1]`

A 12-element vector (C, C#, D, D#, E, F, F#, G, G#, A, A#, B) representing the relative energy in each pitch class, summed across all octaves. Octave-invariant: C2 and C5 both contribute to bin 0.

**Perceptual basis.** Chroma was developed by Fujishima (1999) as a compact representation of harmony. It is the computational equivalent of pitch class — the abstract note name without octave. Temperley (2001) showed chroma vectors are highly correlated with perceived key and chord identity. Logarithmic frequency spacing (each semitone is a fixed ratio) means chroma computation requires a pre-computed frequency→pitch-class mapping matrix (done once at startup).

**Computing strategy.** At startup, all FFT bins are mapped to their pitch class via `pc = round(12 × log₂(freq/440) + 69) mod 12`. Only bins in the guitar fundamental range (80–2000 Hz) are included — covering all guitar and vocal fundamentals while excluding the many high-frequency bins (>2 kHz) that, at fftSize=4096 and 44.1 kHz, account for >80% of bins and carry mainly harmonics and noise. At runtime, extraction is 12 inner products.

**Renderer uses.** 12-bar pitch wheel, chord colour (map dominant pitch class to hue), chroma heatmap, key/chord visualisation.

```typescript
// Map dominant pitch class to hue (C=0°, C#=30°, ... B=330°)
let dominant = 0
for (let i = 1; i < 12; i++) if (f.chroma[i] > f.chroma[dominant]) dominant = i
const hue = (dominant / 12) * 360
```

---

#### `chromaNovelty: number` — Harmonic change signal `[0–1]`

L2 distance between the current chroma vector and the previous frame's chroma vector: `||chroma_t − chroma_{t−1}||₂`, clamped to [0, 1].

**Perceptual basis.** Chroma novelty is the harmonic analogue of spectral flux — it measures how much the pitch-class profile changed this frame. Chord changes, key modulations, and melodic leaps all produce peaks. Unlike onset detection (which fires on any energy change), chroma novelty fires specifically on harmonic/melodic changes, making it useful for detecting chord boundaries even when there is no clear transient.

**Relationship to `isOnset`.** An onset occurs when spectral energy suddenly increases; chroma novelty fires when the *pitch profile* changes. A sustained guitar chord that abruptly changes chord may show low spectral flux (no strong attack) but high chroma novelty.

**Renderer uses.** Flash visual response on chord change, trail colour shift, trigger harmonic-driven particle burst (distinct from beat-driven burst).

---

#### `predominantPitch: number | null` — Monophonic fundamental `[Hz, or null]`

Estimated fundamental frequency of the most prominent pitched sound, in Hz. `null` when the signal is too quiet (rms < 0.05) or when no clear pitch is detected (correlation < 0.15).

**Algorithm.** Normalised autocorrelation of the time-domain waveform. The autocorrelation of a periodic signal peaks at lags corresponding to integer multiples of the period; the first peak gives the fundamental period and thus frequency. Restricted to 80–1200 Hz (guitar/vocal fundamental range). Updated every 4 frames (~67 ms) because the autocorrelation is O(N × lag\_range).

**Academic refs.** The autocorrelation approach is described in de Cheveigné & Kawahara (2002). A production-quality implementation would use the YIN algorithm or CREPE (deep learning) for better accuracy on polyphonic content. This implementation is designed for monophonic or single-dominant-pitch contexts.

**Limitations.** Polyphonic content (full chords, dense textures) confuses autocorrelation — the returned pitch may be the most dominant harmonic, not the musical root. Also, very low notes (<80 Hz, e.g. bass guitar open E at 41 Hz) fall below the detection range.

**Renderer uses.** Display active note name, pitch-tracking trail, tune indicator, colour shift based on octave.

```typescript
// Note name from Hz
const midi = Math.round(12 * Math.log2(hz / 440) + 69)
const noteName = PITCH_CLASS_NAMES[midi % 12] + Math.floor(midi / 12 - 1)
```

---

#### `pitchStability: number` — Sustained pitch confidence `[0–1]`

Standard deviation of `predominantPitch` over the last ~1 second (60-frame ring buffer), normalised as a coefficient of variation and inverted. High = pitch has been steady; low = pitch is jumping around or absent. Returns 0 if fewer than 10 valid pitch samples are available.

**Perceptual basis.** A sustained held note has very low pitch jitter; rapid melodic passages, vibrato, or polyphonic content produce high jitter. This feature lets renderers distinguish between "player holding a note" and "player actively moving between notes".

**Renderer uses.** Show note name with high opacity only when stable, grow a visual "trail" behind a note when stable, animate vibrato speed as inverse of stability.

---

#### `key: string | null` — Estimated musical key `[e.g. "C major", "A minor"]`

The most probable key for the music over the past ~4 seconds, or `null` until enough history is available.

**Algorithm.** Krumhansl-Schmuckler key-finding (1990): the 4-second average chroma vector is Pearson-correlated with 24 pre-normalised key profiles (12 major + 12 minor, each rotated to all 12 roots). The key with the highest correlation wins.

**Academic refs.** Krumhansl, *Cognitive Foundations of Musical Pitch* (1990). The KS profiles were derived from listener experiments measuring how well each of the 12 pitch classes fits a given key context. The algorithm correctly identifies key ~80–90% of the time on clean, relatively tonal audio (Temperley, 2001).

**Update cadence.** Every 240 frames (~4s). Key changes in real-time performance are rare; slow updates reduce jitter.

**Renderer uses.** Colour theme selection (minor keys → cooler blues/purples, major keys → warmer yellows/oranges), background atmosphere, mode indicator display.

---

#### `chord: string | null` — Estimated current chord `[e.g. "C", "Am", "G"]`

The best-matching major or minor triad template for the current chroma, or `null` when silent.

**Algorithm.** Pearson correlation of the zero-mean chroma vector against 24 pre-normalised chord templates (12 major + 12 minor). Templates are constructed with weighted triads: root = 1.0, fifth = 0.7, third = 0.5, then zero-meaned and unit-normalised. This penalises non-chord tones and is scale-invariant. Detection fires two ways: (1) onset-triggered — resets chroma EMA on a strum and snapshots 8 frames (~133 ms) later for the attack to settle; (2) timer fallback every 30 frames (~500 ms) on the EMA-smoothed chroma for sustained notes with no clear onset.

**Academic refs.** Fujishima (1999); Cho & Bello (2014) on template-based chord recognition. The Pearson correlation approach rather than simple dot product is important — it is invariant to the overall loudness of the chroma and correctly penalises non-chord tones by making them subtly negative in the template.

**Limitations.** Only triads (major/minor) are currently modelled. Seventh chords, suspended chords, and complex voicings may be misidentified as the nearest triad. The 80–2000 Hz chroma range covers guitar fundamentals but may miss bass notes below 80 Hz.

**Renderer uses.** Display chord symbol on screen, colour change on chord change, chord progression history.

---

#### `chordCandidates: ReadonlyArray<{ chord: string; score: number }>` — Top 5 matches

The top 5 chord template correlations, sorted descending, normalised so the best candidate scores 1.0 and others are proportional. Empty until first detection.

**Renderer uses.** Confidence-weighted display (show dim alternatives when top score is low), accuracy testing overlay (compare what the algorithm detected vs what was played), debug display.

---

#### `chordDuration: number` — Time on current chord `[seconds]`

Seconds elapsed since `chord` last changed. Resets to 0 on every chord update.

**Renderer uses.** Fade in chord name display after 0.5s (avoids flash on rapid changes), grow a visual "root" element the longer a chord is held, trigger a "chord settled" effect at 1s.

---

### Rhythm

---

#### `onsetStrength: number` — Musical event energy `[0–1]`

Half-wave-rectified spectral flux: `Σ max(0, |X_t[i]| − |X_{t−1}[i]|) / N × 0.1`. Spikes on every note attack, beat, or chord change.

**Perceptual basis.** Onset strength is the continuous version of beat detection. Böck et al. (2012) show it is the most informative single stream for downstream beat tracking. Perceptually it corresponds to "how much is happening" — event rate and attack energy.

**Renderer uses.** Continuous glow radius driver, emission rate control, "heartbeat" envelope.

---

#### `isOnset: boolean` — Discrete musical event flag

`true` for exactly one frame when `onsetStrength` exceeds its recent local mean by ×1.3 and at least 8 frames (~130 ms) have passed since the last onset. This debounce prevents rapid noise from triggering multiple events.

**How to use.** React once per event with a one-shot effect — do not use as a sustained state.

```typescript
if (features.isOnset) {
  this.flashAlpha = 1.0
  spawnParticleBurst()
}
this.flashAlpha *= 0.85  // per-frame decay, independent of isOnset
```

---

#### `bpm: number | null` — Estimated tempo `[beats per minute]`

Estimated from inter-onset intervals via autocorrelation of the 6-second onset history ring buffer. Updated every ~2 seconds. `null` for the first ~6 seconds.

**Algorithm.** Autocorrelation over lag range 20–60 frames (corresponding to 60–180 BPM at 60 fps). The lag with the highest autocorrelation gives the beat period; a beat-clock EMA provides a faster-updating fallback estimate.

**Academic refs.** Large (1994); Dixon (2001). The simple autocorrelation approach here is adequate for music with a clear consistent beat. For jazz, classical, or complex rhythms, a dedicated beat tracker (e.g. BeatDetektor by cwilso; librosa.beat_track) would be more accurate.

**Renderer uses.** Tempo-synced animation — divide time into beat units, create metronome pulse, drive periodic visual period.

---

#### `beatPhase: number` — Position within beat `[0–1]`

Continuous 0→1 ramp within the estimated beat period. Resets to 0 on each detected onset; increments per frame based on the smoothed inter-onset interval.

```typescript
const pulse = Math.pow(1 - features.beatPhase, 2)  // sharp attack, slow decay
const glowRadius = 10 + 40 * pulse * features.rms
```

**Renderer uses.** Continuous beat-synced animation — size pulse, rotation, position oscillation, metronome dot.

---

#### `onsetDensity: number` — Onset rate `[0–1]`

Exponential moving average of onset events: `accum = accum × (1 − 1/60) + isOnset`. Normalised so ~4 onsets/second = 1.0. Provides a smoothed measure of "how frequently events are happening".

**Perceptual basis.** Distinct from `onsetStrength` (which is per-event amplitude) — density captures the *rate* of events over time. A rapid arpeggio has high density; a slow chord strum has low density. Rhythmic density correlates strongly with perceived arousal and excitement.

**Renderer uses.** Particle emission rate that scales with rhythmic busyness, visual speed, blur amount. Input to `buildupIntensity`.

---

#### `energyTrend: number` — Loudness direction `[−1 to +1]`

Signed deviation of current `rms` from a slow exponential moving average baseline (α = 0.02, time constant ~50 frames / ~800 ms), scaled and clamped to [−1, +1]. Positive = getting louder; negative = getting quieter.

**Perceptual basis.** Listeners are highly sensitive to energy *changes* as well as absolute level. A crescendo feels exciting not because it is loud but because it is *getting louder*. This feature captures that directionality in real time, independently of absolute loudness.

**Renderer uses.** Expand/contract visual field proportional to trend, colour temperature shift (warm on swell, cool on fade), input to `buildupIntensity`.

---

#### `spectralCentroidTrend: number` — Brightness direction `[−1 to +1]`

Signed deviation of current `spectralCentroid` from a slow EMA baseline (α = 0.02), scaled and clamped to [−1, +1]. Positive = spectrum is brightening; negative = darkening.

**Perceptual basis.** Producers commonly increase high-frequency content during builds and before drops. Spectral centroid trend captures this brightening trajectory in real time, complementing energy trend with a timbral dimension.

**Renderer uses.** Shimmer/sparkle layer increases when positive, hue drifts toward blue; input to `buildupIntensity`.

---

#### `buildupIntensity: number` — Pre-drop composite `[0–1]`

`0.40 × max(0, energyTrend) + 0.35 × onsetDensity + 0.25 × max(0, spectralCentroidTrend)`

High when energy is building, rhythmic activity is high, *and* the spectrum is brightening simultaneously — the characteristic profile of a musical buildup or pre-climax moment.

**Perceptual basis.** In EDM, rock, and pop, climactic moments (drops, choruses, peaks) are reliably preceded by increases in loudness, rhythmic density, and spectral brightness. Monitoring all three together produces far fewer false positives than any single feature alone. The weights (40/35/25) prioritise energy trajectory, then beat activity, then timbral change.

**Renderer uses.** Trigger "approaching drop" effects — increasing visual complexity, camera zoom, particle acceleration, background swirl. The clean signal produced by this composite reduces the need for manual tempo-locked triggers.

```typescript
if (features.buildupIntensity > 0.7) {
  this.cameraZoom = 1 + (features.buildupIntensity - 0.7) * 3
}
```

---

### Affective Proxies

These are computed composites — not directly measurable audio quantities, but weighted combinations of lower-tier features that approximate perceptual/emotional dimensions from music psychology. They are models, not ground truth; weights are approximate and would be learned from data in a production system.

**Research framework.** Russell's circumplex model of affect (1980) proposes two dimensions: *valence* (negative/positive emotional content) and *arousal* (calm/excited activation). Thayer (1989) and Eerola & Vuoskoski (2011) provide empirical mappings from acoustic features to these dimensions for music.

---

#### `arousal: number` — Calm ↔ Excited `[0–1]`

`0.35 × rms + 0.25 × onsetStrength + 0.25 × (centroid / 4000) + 0.15 × (bpm / 180)`

**Research basis.** The arousal axis in the Russell model is the most reliably predicted by audio features. MIR research (Eerola & Vuoskoski, 2011; Yang & Chen, 2012) consistently identifies tempo/BPM, loudness (RMS), onset rate, and spectral brightness as the strongest arousal predictors. The 35/25/25/15 weights here are based on those studies; a production system would use regression weights trained on a labelled dataset.

**Renderer uses.** Global visual intensity, animation speed, particle velocity, colour saturation.

---

#### `warmth: number` — Cold ↔ Warm `[0–1]`

`0.5 × (bandEnergy[0] + bandEnergy[1]) + 0.3 × (1 − centroid/4000) + 0.2 × rms`

**Research basis.** "Warmth" in timbre perception research (Zacharakis et al., 2014; Alluri & Toiviainen, 2010) correlates with low-frequency dominance, slow attack, and absence of high-frequency energy — roughly the inverse of brightness. Warm sounds: cello, acoustic bass, male baritone. Cool sounds: piccolo, cymbal, distorted guitar.

**Renderer uses.** Orange/red vs blue/white colour temperature, background glow colour, blur radius.

---

#### `valence: number` — Sad ↔ Happy `[0–1]`

`0.6 × keyValence + 0.4 × chordValence` where major key/chord → 0.8, minor → 0.2, unknown → 0.5.

**Research basis.** Valence is the most debated axis in music emotion research. The most reliable acoustic predictor is mode (major vs minor), a finding that is robust across cultures and listening contexts (Hevner, 1935; Husain et al., 2002; Eerola & Vuoskoski, 2011). Tempo also contributes to valence but is already captured in `arousal`. Key-level valence (60% weight) is more stable than chord-level (40%) which changes frequently.

**Limitations.** This model captures only mode-based valence. Lyrics, melody shape, performance dynamics, and cultural context all contribute substantially to emotional valence and are not modelled here.

**Renderer uses.** Warm/joyful vs cool/melancholy colour palettes, particle colour, visual "mood" backdrop.

---

#### `tension: number` — Resolved ↔ Tense `[0–1]`

Weighted mean pairwise interval dissonance across all active pitch classes (chroma > 0.3):

```
tension = Σᵢⱼ DISSONANCE[|i−j| mod 12] × chroma[i] × chroma[j]  /  Σᵢⱼ chroma[i] × chroma[j]
```

Interval dissonance weights (semitones 0–11):
`[0, 1.0, 0.8, 0.3, 0.2, 0.15, 0.9, 0.1, 0.3, 0.2, 0.7, 0.9]`

**Research basis.** Psychoacoustic consonance/dissonance research (Plomp & Levelt, 1965; Huron, 2001) establishes that certain intervals are consistently rated as tense/dissonant across listeners. The most dissonant intervals are the minor second (1), tritone (6), and major seventh (11). The most consonant are the unison (0), perfect fifth (7), and octave (12≡0). The weights above follow this psychoacoustic ordering.

**Note.** Tension captures the harmonic content of the *current frame's chroma*, independent of key context. A diminished chord played in a minor key may have similar raw tension to one played in a major key — this is harmonic tension without tonal context.

**Renderer uses.** Visual dissonance effects (jagged lines, aggressive colours, screen shake), harmonic tension indicator, complement to `valence`.

---

## Practical renderer patterns

### Beat-reactive flash

```typescript
// One-shot flash on onset
if (features.isOnset) {
  this.flashAlpha = 1.0
}
this.flashAlpha *= 0.85  // per-frame decay

// Continuous beat pulse
const pulse = Math.pow(1 - features.beatPhase, 2)  // sharp attack, slow decay
const glowRadius = 10 + 40 * pulse * features.rms

ctx.shadowBlur = glowRadius
ctx.shadowColor = accent
```

---

### Map features to colour

```typescript
// Hue from spectral centroid (warm dark → cool bright)
const hue = Math.floor((features.spectralCentroid / 6000) * 240)  // 0=red, 240=blue

// Saturation from flatness (tonal = saturated, noisy = grey)
const sat = Math.floor((1 - features.spectralFlatness) * 100)

// Lightness from RMS
const lit = Math.floor(20 + features.rms * 50)

ctx.fillStyle = `hsl(${hue}, ${sat}%, ${lit}%)`
```

---

### Harmonic-aware colour

```typescript
// Dominant pitch class → hue (C=0°, C#=30°, ..., B=330°)
let dominant = 0
for (let i = 1; i < 12; i++) {
  if (features.chroma[i] > features.chroma[dominant]) dominant = i
}
const hue = (dominant / 12) * 360

// Major/minor → warm/cool tint
const isMajorKey = features.key ? !features.key.includes('minor') : true
const lightness = isMajorKey ? 55 : 40
ctx.fillStyle = `hsl(${hue}, 80%, ${lightness}%)`
```

---

### Drive per-band visual layers

```typescript
const [sub, bass, mid, high] = features.bandEnergy

// Sub: screen shake / rumble
canvas.style.transform = `translateY(${(sub * 4).toFixed(1)}px)`

// Bass: background pulse
ctx.fillStyle = `rgba(200, 30, 80, ${bass * 0.4})`
ctx.fillRect(0, 0, width, height)

// Mid: primary visual brightness
ctx.globalAlpha = 0.2 + mid * 0.8
drawMainVisual()
ctx.globalAlpha = 1

// High: sparkle overlay
if (high > 0.4) spawnSparkles(high * 20)
```

---

### Buildup and drop detection

```typescript
// Rising buildup → intensify
if (features.buildupIntensity > 0.5) {
  const intensity = (features.buildupIntensity - 0.5) * 2  // remap 0.5–1.0 → 0–1
  this.cameraZoom = 1 + intensity * 0.3
  this.particleSpeed *= 1 + intensity * 0.5
}

// Energy drop after high energy → trigger drop effect
if (features.energyTrend < -0.6 && this.prevRMS > 0.4) {
  triggerDropEffect()
}
this.prevRMS = features.rms
```

---

### Pitch trail

```typescript
// Only draw when pitch is stable and signal is present
if (features.predominantPitch && features.pitchStability > 0.5) {
  const opacity = features.pitchStability
  const y = mapPitchToY(features.predominantPitch, 80, 1200, height)
  ctx.globalAlpha = opacity * features.rms * 2
  ctx.fillStyle = accent
  ctx.fillRect(x, y - 2, 4, 4)
  ctx.globalAlpha = 1
}
```

---

### Chord change detection

```typescript
// Flash when chord changes (chromaNovelty spikes on harmonic change)
if (features.chromaNovelty > 0.4) {
  this.chordChangeFlash = 1.0
}
this.chordChangeFlash *= 0.92

// Only show chord label when it has been stable for a moment
if (features.chordDuration > 0.3 && features.chord) {
  drawChordLabel(features.chord, features.chordDuration)
}
```

---

### Tension-driven visual distortion

```typescript
// Jitter / distortion driven by harmonic tension
const jitter = features.tension * features.rms * 3
ctx.save()
ctx.translate(
  (Math.random() - 0.5) * jitter,
  (Math.random() - 0.5) * jitter
)
drawMainVisual()
ctx.restore()
```

---

## Architecture notes for renderer authors

- **All `features` values are computed once per frame** by `FeatureExtractor.extract()`, called from `AudioEngine.getFeatures()`. They are passed read-only — do not mutate them.
- **`chroma` is a `Float32Array`** allocated per-frame. If you need history across frames, copy it: `const saved = Float32Array.from(features.chroma)`.
- **Windowed features** (`bpm`, `key`, `chord`, `dynamicComplexity`, `pitchStability`) lag by design. Cache the last non-null value for continuous display.
- **`NULL_FEATURES`** (from `AudioFeatures.ts`) provides safe zero defaults for use before the engine starts.
- **`isOnset` is a one-frame pulse.** Never use it to set a sustained visual state — use it to trigger a one-shot effect with its own decay.
- **`buildupIntensity` has a floor.** It will rarely be zero during active music because `onsetDensity` contributes even without energy trend. Threshold at >0.5 for "real" buildup detection.

---

## Academic references

| Reference | Relevance |
|---|---|
| Böck, Krebs & Schedl (2012). *Evaluating the Online Capabilities of Onset Detection Methods.* ISMIR. | Onset detection, spectral flux |
| Cho & Bello (2014). *On the Relative Importance of Individual Components of Chord Recognition Systems.* IEEE TASLP. | Chord template matching |
| Davis & Mermelstein (1980). *Comparison of Parametric Representations for Monosyllabic Word Recognition.* IEEE TASSL. | ZCR, MFCCs |
| de Cheveigné & Kawahara (2002). *YIN, a fundamental frequency estimator for speech and music.* JASA. | Pitch detection, autocorrelation |
| Dixon (2006). *Onset Detection Revisited.* DAFx. | Spectral flux, onset detection |
| Dubnov (2004). *Generalization of Spectral Flatness Measure for Non-Gaussian Linear Processes.* IEEE SPL. | Spectral flatness / tonality |
| Eerola & Vuoskoski (2011). *A comparison of the discrete and dimensional models of emotion in music.* Psychology of Music. | Valence, arousal, acoustic features |
| Fastl & Zwicker (2007). *Psychoacoustics: Facts and Models.* Springer. | Loudness, critical bands |
| Fitzgerald (2010). *Harmonic/Percussive Separation Using Median Filtering.* DAFx. | HPSS, harmonicRatio / percussiveRatio |
| Fujishima (1999). *Realtime Chord Recognition of Musical Sound: a System Using Common Lisp Music.* ICMC. | Chroma vectors, chord templates |
| Grey (1977). *Multidimensional perceptual scaling of musical timbres.* JASA. | Spectral centroid and brightness |
| Hevner (1935). *Affective value of the major and minor modes in music.* American Journal of Psychology. | Mode (major/minor) and valence |
| Huron (2001). *Tone and Voice: A Derivation of the Rules of Voice-Leading from Perceptual Principles.* Music Perception. | Interval dissonance, tension |
| Husain, Thompson & Schellenberg (2002). *Effects of Musical Tempo and Mode on Arousal, Mood, and Spatial Abilities.* Music Perception. | Mode, valence, arousal |
| Krumhansl (1990). *Cognitive Foundations of Musical Pitch.* Oxford University Press. | Key profiles, key-finding algorithm |
| Large (1994). *Resonance and the Perception of Musical Meter.* Connection Science. | Beat tracking, BPM |
| Mierswa & Morik (2005). *Automatic Feature Extraction for Classifying Audio Data.* Machine Learning. | Dynamic complexity, genre features |
| Ono, Miyamoto & Sagayama (2008). *Separation of a Monaural Audio Signal into Harmonic/Percussive Components.* ISMIR. | HPSS reference |
| Plomp & Levelt (1965). *Tonal Consonance and Critical Bandwidth.* JASA. | Psychoacoustic consonance/dissonance |
| Russell (1980). *A Circumplex Model of Affect.* Journal of Personality and Social Psychology. | Valence/arousal 2D model |
| Temperley (2001). *The Cognition of Basic Musical Structures.* MIT Press. | Chroma, key-finding, chord recognition |
| Thayer (1989). *The Biopsychology of Mood and Arousal.* Oxford University Press. | Arousal model |
| Zacharakis, Pastiadis & Reiss (2014). *An Interlanguage Study of Musical Timbre Semantic Dimensions.* Music Perception. | Warmth, timbral adjectives |
| Zwicker (1961). *Subdivision of the Audible Frequency Range into Critical Bands.* JASA. | Critical bands, bandEnergy |
