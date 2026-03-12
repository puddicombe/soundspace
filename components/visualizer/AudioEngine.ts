import type { PresetConfig } from '@/lib/validations/preset'

export class AudioEngine {
  private config: PresetConfig
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private fftBuffer: Float32Array = new Float32Array(0)
  private waveBuffer: Float32Array = new Float32Array(0)

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
    this.waveBuffer = new Float32Array(this.analyser.fftSize)

    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)
  }

  getProcessedFFT(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatFrequencyData(this.fftBuffer)
    const sensitivity = this.config.sensitivity
    const result = new Float32Array(this.fftBuffer.length)
    for (let i = 0; i < this.fftBuffer.length; i++) {
      const normalised = (this.fftBuffer[i] + 160) / 160
      result[i] = Math.min(1, Math.max(0, normalised * sensitivity))
    }
    return result
  }

  getRawWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatTimeDomainData(this.waveBuffer)
    return this.waveBuffer
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
  }
}
