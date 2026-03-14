import type { PresetConfig } from '@/lib/validations/preset'
import { FeatureExtractor } from './FeatureExtractor'
import { type AudioFeatures, NULL_FEATURES } from './AudioFeatures'

export class AudioEngine {
  private config: PresetConfig
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private fftBuffer: Float32Array<ArrayBuffer> = new Float32Array(0)
  private fftResult: Float32Array<ArrayBuffer> = new Float32Array(0)
  private waveBuffer: Float32Array<ArrayBuffer> = new Float32Array(0)
  private extractor: FeatureExtractor | null = null

  constructor(config: PresetConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    this.audioContext = new AudioContext()

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = this.config.fftSize

    this.fftBuffer = new Float32Array(this.analyser.frequencyBinCount)
    this.fftResult = new Float32Array(this.analyser.frequencyBinCount)
    this.waveBuffer = new Float32Array(this.analyser.fftSize)

    this.extractor = new FeatureExtractor(
      this.analyser.frequencyBinCount,
      this.analyser.fftSize,
      this.audioContext.sampleRate,
    )

    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)
  }

  getProcessedFFT(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatFrequencyData(this.fftBuffer)
    const sensitivity = this.config.sensitivity
    for (let i = 0; i < this.fftBuffer.length; i++) {
      // Mic noise floor is typically around -70 to -80 dBFS; normalise against
      // -80 dBFS so genuine silence clamps to 0 rather than appearing at ~50%.
      const normalised = (this.fftBuffer[i] + 80) / 80
      this.fftResult[i] = Math.min(1, Math.max(0, normalised * sensitivity))
    }
    return this.fftResult
  }

  getRawWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatTimeDomainData(this.waveBuffer)
    return this.waveBuffer
  }

  /** Returns computed audio features for the current frame.
   *  Must be called after getProcessedFFT() and getRawWaveform()
   *  so the internal buffers are freshly populated. */
  getFeatures(): AudioFeatures {
    if (!this.extractor) return NULL_FEATURES
    return this.extractor.extract(this.fftResult, this.waveBuffer)
  }

  async restart(newConfig: PresetConfig): Promise<void> {
    this.stop()
    this.config = newConfig
    await this.start()
  }

  stop(): void {
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.audioContext?.close()
    this.audioContext = null
    this.analyser = null
    this.source = null
    this.stream = null
    this.extractor = null
  }
}
