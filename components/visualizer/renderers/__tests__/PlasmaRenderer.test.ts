import { PlasmaRenderer } from '../PlasmaRenderer'
import { NULL_FEATURES } from '../../AudioFeatures'
import type { PlasmaConfig } from '@/lib/validations/preset'

const defaultConfig: PlasmaConfig = {
  type: 'plasma',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
}

/** Minimal WebGL2 context stub sufficient for PlasmaRenderer. */
function makeGlStub() {
  return {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88b4,
    FLOAT: 0x1406,
    TRIANGLES: 0x0004,
    COLOR_BUFFER_BIT: 0x4000,
    BLEND: 0x0be2,
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
    deleteProgram: jest.fn(),
    deleteBuffer: jest.fn(),
    getExtension: jest.fn().mockReturnValue(null),
    enable: jest.fn(),
    blendFunc: jest.fn(),
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

describe('PlasmaRenderer', () => {
  it('constructs without throwing when WebGL2 is available', () => {
    const canvas = makeCanvas()
    expect(() => new PlasmaRenderer(canvas, defaultConfig)).not.toThrow()
  })

  it('throws with descriptive message when WebGL2 is unavailable', () => {
    const canvas = makeCanvas(null)
    expect(() => new PlasmaRenderer(canvas, defaultConfig)).toThrow('WebGL2 not supported')
  })

  it('throws when vertex shader fails to compile', () => {
    const gl = makeGlStub()
    gl.getShaderParameter.mockImplementation((_shader: unknown, pname: number) => {
      if (pname === gl.COMPILE_STATUS) return false
      return true
    })
    gl.getShaderInfoLog.mockReturnValue('unexpected token')
    const canvas = makeCanvas(gl)
    expect(() => new PlasmaRenderer(canvas, defaultConfig)).toThrow('Plasma shader compile error')
  })

  it('calls gl.drawArrays on render', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new PlasmaRenderer(canvas, defaultConfig)
    const fft = new Float32Array(2048)
    const wave = new Float32Array(2048)
    renderer.render(fft, wave, { ...NULL_FEATURES })
    expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6)
  })

  it('calls gl.viewport on resize', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new PlasmaRenderer(canvas, defaultConfig)
    renderer.resize(1920, 1080)
    expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1920, 1080)
  })

  it('destroy does not throw', () => {
    const canvas = makeCanvas()
    const renderer = new PlasmaRenderer(canvas, defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })

  it('spawns a shockwave on isOnset and uploads to shader', () => {
    const gl = makeGlStub()
    const canvas = makeCanvas(gl)
    const renderer = new PlasmaRenderer(canvas, defaultConfig)
    const fft = new Float32Array(2048)
    const wave = new Float32Array(2048)

    renderer.render(fft, wave, { ...NULL_FEATURES, isOnset: true, rms: 0.5 })

    // u_swCount should have been set to 1 (one shock wave spawned)
    expect(gl.uniform1i).toHaveBeenCalledWith(expect.anything(), 1)
  })
})
