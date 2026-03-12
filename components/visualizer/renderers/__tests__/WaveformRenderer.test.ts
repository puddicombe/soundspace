import { WaveformRenderer } from '../WaveformRenderer'
import type { WaveformConfig } from '@/lib/validations/preset'

const defaultConfig: WaveformConfig = {
  type: 'waveform',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
}

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

describe('WaveformRenderer', () => {
  it('constructs without throwing', () => {
    expect(() => new WaveformRenderer(makeCanvas(), defaultConfig)).not.toThrow()
  })

  it('calls beginPath and stroke on render', () => {
    const canvas = makeCanvas()
    const renderer = new WaveformRenderer(canvas, defaultConfig)
    const ctx = canvas.getContext('2d')!
    const beginPathSpy = jest.spyOn(ctx, 'beginPath')
    const strokeSpy = jest.spyOn(ctx, 'stroke')

    renderer.render(new Float32Array(1024), new Float32Array(2048).fill(0.5))

    expect(beginPathSpy).toHaveBeenCalled()
    expect(strokeSpy).toHaveBeenCalled()
  })

  it('resize does not throw', () => {
    const renderer = new WaveformRenderer(makeCanvas(), defaultConfig)
    expect(() => renderer.resize(1920, 1080)).not.toThrow()
  })

  it('destroy does not throw', () => {
    const renderer = new WaveformRenderer(makeCanvas(), defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })
})
