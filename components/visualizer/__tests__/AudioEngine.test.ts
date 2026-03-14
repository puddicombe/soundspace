import { AudioEngine } from '../AudioEngine'
import type { PresetConfig } from '@/lib/validations/preset'

const baseConfig: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: false,
}

// Mock Web Audio API
const mockGetFloatFrequencyData = jest.fn()
const mockGetFloatTimeDomainData = jest.fn()
const mockConnect = jest.fn()
const mockDisconnect = jest.fn()
const mockResume = jest.fn().mockResolvedValue(undefined)

const mockAnalyser = {
  fftSize: 2048,
  frequencyBinCount: 1024,
  connect: mockConnect,
  disconnect: mockDisconnect,
  getFloatFrequencyData: mockGetFloatFrequencyData,
  getFloatTimeDomainData: mockGetFloatTimeDomainData,
}

const mockSourceNode = { connect: mockConnect, disconnect: mockDisconnect }

const mockAudioContext = {
  state: 'suspended',
  sampleRate: 44100,
  resume: mockResume,
  createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
  createMediaStreamSource: jest.fn().mockReturnValue(mockSourceNode),
  close: jest.fn().mockResolvedValue(undefined),
}

global.AudioContext = jest.fn().mockImplementation(() => mockAudioContext) as unknown as typeof AudioContext

const mockStream = { getTracks: () => [{ stop: jest.fn() }] }
Object.defineProperty(global.navigator, 'mediaDevices', {
  writable: true,
  value: { getUserMedia: jest.fn().mockResolvedValue(mockStream) },
})

describe('AudioEngine', () => {
  beforeEach(() => jest.clearAllMocks())

  it('constructs without starting', () => {
    expect(() => new AudioEngine(baseConfig)).not.toThrow()
    expect(global.AudioContext).not.toHaveBeenCalled()
  })

  it('start() resumes AudioContext and requests mic', async () => {
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    expect(mockResume).toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
  })

  it('getProcessedFFT normalises and clamps values', async () => {
    mockGetFloatFrequencyData.mockImplementation((buf: Float32Array) => buf.fill(0))
    const engine = new AudioEngine({ ...baseConfig, sensitivity: 2.0 })
    await engine.start()
    const result = engine.getProcessedFFT()
    // (0 + 80) / 80 = 1.0, * 2.0 = 2.0, clamped to 1.0
    expect(result[0]).toBeCloseTo(1.0)
  })

  it('getProcessedFFT clamps to 0 for silence (−160 dBFS)', async () => {
    mockGetFloatFrequencyData.mockImplementation((buf: Float32Array) => buf.fill(-160))
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    const result = engine.getProcessedFFT()
    expect(result[0]).toBeCloseTo(0.0)
  })

  it('stop() releases resources', async () => {
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    engine.stop()
    expect(mockAudioContext.close).toHaveBeenCalled()
  })
})
