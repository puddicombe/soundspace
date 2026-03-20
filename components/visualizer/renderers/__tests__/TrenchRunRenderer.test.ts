import { TrenchRunRenderer, computeScrollDelta, computeBankAngle, computeWarpAmount, computeReticleRadius } from '../TrenchRunRenderer'
import { NULL_FEATURES } from '../../AudioFeatures'
import type { TrenchRunConfig } from '@/lib/validations/preset'

/** Minimal WebGL2 context stub sufficient for TrenchRunRenderer. */
function makeGlStub() {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88b4,
    FLOAT: 0x1406,
    LINES: 0x0001,
    LINE_LOOP: 0x0002,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
    SRC_ALPHA: 0x0302,
    ONE: 1,
    createShader: jest.fn().mockReturnValue({}),
    shaderSource: jest.fn(),
    compileShader: jest.fn(),
    getShaderParameter: jest.fn().mockReturnValue(true),
    getShaderInfoLog: jest.fn().mockReturnValue(''),
    createProgram: jest.fn().mockReturnValue({}),
    attachShader: jest.fn(),
    linkProgram: jest.fn(),
    getProgramParameter: jest.fn().mockReturnValue(true),
    getProgramInfoLog: jest.fn().mockReturnValue(''),
    deleteShader: jest.fn(),
    useProgram: jest.fn(),
    createBuffer: jest.fn().mockReturnValue({}),
    bindBuffer: jest.fn(),
    bufferData: jest.fn(),
    getAttribLocation: jest.fn().mockReturnValue(0),
    enableVertexAttribArray: jest.fn(),
    vertexAttribPointer: jest.fn(),
    getUniformLocation: jest.fn().mockReturnValue({}),
    clearColor: jest.fn(),
    viewport: jest.fn(),
    clear: jest.fn(),
    drawArrays: jest.fn(),
    uniform1f: jest.fn(),
    uniform1i: jest.fn(),
    uniform3fv: jest.fn(),
    uniform2fv: jest.fn(),
    uniform1fv: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    deleteProgram: jest.fn(),
    deleteBuffer: jest.fn(),
    getExtension: jest.fn().mockReturnValue(null),
    enable: jest.fn(),
    blendFunc: jest.fn(),
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
  }
}

function makeCanvas(gl: ReturnType<typeof makeGlStub> | null = makeGlStub()) {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  jest.spyOn(canvas, 'getContext').mockImplementation((id: string) => {
    if (id === 'webgl2') return gl as unknown as WebGL2RenderingContext
    return null
  })
  return canvas
}

// ---------------------------------------------------------------------------
// Group A: Pure function tests
// ---------------------------------------------------------------------------

describe('computeScrollDelta', () => {
  it('returns 0 when rms is 0 and dt is 0', () => {
    expect(computeScrollDelta(0, 0, false)).toBe(0)
  })
  it('increases proportionally to rms and dt', () => {
    const d1 = computeScrollDelta(0.5, 0.016, false)
    const d2 = computeScrollDelta(1.0, 0.016, false)
    expect(d2).toBeGreaterThan(d1)
  })
  it('adds a fixed snap of 8 units on onset frame', () => {
    const withoutOnset = computeScrollDelta(0.5, 0.016, false)
    const withOnset    = computeScrollDelta(0.5, 0.016, true)
    expect(withOnset - withoutOnset).toBeCloseTo(8, 5)
  })
})

describe('computeBankAngle', () => {
  it('returns ≈ 0.436 rad when time=1, rms=1, bankIntensity=1 (tolerance ±0.001)', () => {
    const angle = computeBankAngle(1, 1, 1)
    expect(Math.abs(angle)).toBeGreaterThan(0.435)
    expect(Math.abs(angle)).toBeLessThan(0.437)
  })
  it('scales with bankIntensity', () => {
    const a1 = computeBankAngle(1, 1, 0.5)
    const a2 = computeBankAngle(1, 1, 1.0)
    expect(Math.abs(a2)).toBeGreaterThan(Math.abs(a1))
  })
})

describe('computeWarpAmount', () => {
  it('returns 0 when bass is 0', () => {
    expect(computeWarpAmount(0, 1.0)).toBe(0)
  })
  it('scales with bass and warpIntensity', () => {
    const w1 = computeWarpAmount(0.5, 0.5)
    const w2 = computeWarpAmount(0.5, 1.0)
    expect(w2).toBeGreaterThan(w1)
  })
})

describe('computeReticleRadius', () => {
  it('returns a positive number for non-zero inputs', () => {
    expect(computeReticleRadius(0.5, 0.5)).toBeGreaterThan(0)
  })
  it('grows with bass', () => {
    const r1 = computeReticleRadius(0.5, 0.2)
    const r2 = computeReticleRadius(0.5, 0.8)
    expect(r2).toBeGreaterThan(r1)
  })
})

// ---------------------------------------------------------------------------
// Group B: Constructor and lifecycle tests
// ---------------------------------------------------------------------------

const defaultConfig: TrenchRunConfig = {
  type: 'trenchRun',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
  scrollSpeed: 1.0,
  bankIntensity: 0.6,
  warpIntensity: 0.5,
  gridDensity: 16,
  hudOpacity: 0.9,
}

describe('TrenchRunRenderer', () => {
  it('constructs without throwing when WebGL2 is available', () => {
    const canvas = makeCanvas()
    expect(() => new TrenchRunRenderer(canvas, defaultConfig)).not.toThrow()
  })

  it('throws with descriptive message when WebGL2 is unavailable', () => {
    const canvas = makeCanvas(null)
    expect(() => new TrenchRunRenderer(canvas, defaultConfig)).toThrow('WebGL2 not supported')
  })

  it('calls gl.drawArrays on render', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new TrenchRunRenderer(canvas, defaultConfig)
    const fft = new Float32Array(2048)
    const wave = new Float32Array(2048)
    renderer.render(fft, wave, { ...NULL_FEATURES })
    expect(gl.drawArrays).toHaveBeenCalled()
  })

  it('builds geometry for 3 rectangular faces (floor + 2 walls)', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    new TrenchRunRenderer(canvas, defaultConfig)
    // gridDensity=16 → 12 * 16 = 192 vertices → 576 floats
    const call = gl.bufferData.mock.calls[0]
    expect(call[1]).toBeInstanceOf(Float32Array)
    expect((call[1] as Float32Array).length).toBe(12 * defaultConfig.gridDensity * 3)
  })

  it('uploads u_scanRange uniform on each render call', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new TrenchRunRenderer(canvas, defaultConfig)
    const fft = new Float32Array(2048)
    const wave = new Float32Array(2048)
    gl.uniform1f.mockClear()
    renderer.render(fft, wave, { ...NULL_FEATURES })
    // u_scanRange should be uploaded (uniform1f called at least once after render)
    expect(gl.uniform1f).toHaveBeenCalled()
    // Verify u_scanRange was queried during construction
    const scanRangeQueried = gl.getUniformLocation.mock.calls.some(
      (call: unknown[]) => call[1] === 'u_scanRange'
    )
    expect(scanRangeQueried).toBe(true)
  })

  it('calls gl.viewport on resize', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new TrenchRunRenderer(canvas, defaultConfig)
    renderer.resize(1920, 1080)
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1920, 1080)
  })

  it('destroy does not throw', () => {
    const canvas = makeCanvas()
    const renderer = new TrenchRunRenderer(canvas, defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })

  it('can be rebuilt on the same canvas after destroy (loseContext must not be called)', () => {
    let contextLost = false
    const gl = makeGlStub()
    gl.getExtension.mockImplementation((name: string) => {
      if (name === 'WEBGL_lose_context') return { loseContext: () => { contextLost = true } }
      return null
    })
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 600
    jest.spyOn(canvas, 'getContext').mockImplementation((id: string) => {
      if (id === 'webgl2') return contextLost ? null : gl as unknown as WebGL2RenderingContext
      return null
    })
    const r1 = new TrenchRunRenderer(canvas, defaultConfig)
    r1.destroy()
    expect(() => new TrenchRunRenderer(canvas, defaultConfig)).not.toThrow()
  })
})
