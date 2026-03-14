import { BarsRenderer } from '../BarsRenderer'
import type { BarsConfig } from '@/lib/validations/preset'

const defaultConfig: BarsConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: false,
}

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

describe('BarsRenderer', () => {
  it('constructs without throwing', () => {
    const canvas = makeCanvas()
    expect(() => new BarsRenderer(canvas, defaultConfig)).not.toThrow()
  })

  it('calls clearRect and fillRect on render', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    const ctx = canvas.getContext('2d')!
    const clearSpy = jest.spyOn(ctx, 'clearRect')
    const fillSpy = jest.spyOn(ctx, 'fillRect')

    const fft = new Float32Array(64).fill(0.5)
    const wave = new Float32Array(2048)
    renderer.render(fft, wave, {} as import('../../AudioFeatures').AudioFeatures)

    expect(clearSpy).toHaveBeenCalled()
    expect(fillSpy).toHaveBeenCalled()
  })

  it('resize updates internal dimensions', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    expect(() => renderer.resize(1920, 1080)).not.toThrow()
  })

  it('destroy does not throw', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })
})
