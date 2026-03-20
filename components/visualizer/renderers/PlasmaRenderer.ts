import type { BaseRenderer } from './BaseRenderer'
import type { PlasmaConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

// ---------------------------------------------------------------------------
// Shader sources (inline — no webpack loader required)
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec2 v_uv;

  uniform float u_time;
  uniform float u_tension;
  uniform float u_buildupIntensity;
  uniform float u_rms;
  uniform float u_signalPresence;
  uniform float u_beatPhase;
  uniform float u_highBand;
  uniform float u_chromaNovelty;

  uniform vec3 u_paletteA;
  uniform vec3 u_paletteB;
  uniform vec3 u_paletteC;
  uniform vec3 u_paletteD;

  uniform float u_brightness;
  uniform float u_dynamicRange;

  uniform int u_swCount;
  uniform vec2 u_swOrigin[8];
  uniform float u_swAge[8];
  uniform float u_swStrength[8];

  void main() {
    // Step 1: domain warp
    float warpAmt = u_tension * 0.35 + u_buildupIntensity * 0.2;
    float wx = sin(v_uv.y * 4.1 + u_time * 0.7) * warpAmt;
    float wy = cos(v_uv.x * 3.7 + u_time * 0.5) * warpAmt;
    vec2 warpedUV = v_uv + vec2(wx, wy);

    // Step 2: plasma field — four sinusoidal interference waves
    float pv = 0.0;
    pv += sin(warpedUV.x * 5.0 + u_time);
    pv += sin(warpedUV.y * 4.0 + u_time * 0.9);
    pv += sin((warpedUV.x + warpedUV.y) * 3.5 + u_time * 1.1);
    float cx = warpedUV.x + 0.5 * sin(u_time * 0.33);
    float cy = warpedUV.y + 0.5 * cos(u_time * 0.25);
    pv += sin(sqrt(cx * cx + cy * cy) * 5.0 + u_time * 0.8);
    // Map [-4,4] sum to [0,1] palette input
    float t = pv * 0.125 + 0.5;

    // Step 3: cosine palette
    vec3 colour = u_paletteA + u_paletteB * cos(6.28318 * (u_paletteC * t + u_paletteD));

    // Step 4: tension red-shift
    colour.r += u_tension * 0.25;
    colour.b -= u_tension * 0.15;
    colour = clamp(colour, 0.0, 1.0);

    // Step 5: shock wave rings
    for (int i = 0; i < 8; i++) {
      if (i >= u_swCount) break;
      float dist = length(v_uv - u_swOrigin[i]);
      float radius = u_swAge[i] * 0.6;
      float ring = exp(-pow((dist - radius) / 0.04, 2.0));
      float fade = max(0.0, 1.0 - u_swAge[i] / 1.5);
      vec3 swColour = u_paletteA + u_paletteB * cos(6.28318 * (u_paletteC * 0.1 + u_paletteD));
      colour += ring * fade * u_swStrength[i] * swColour * 1.5;
    }

    // Step 6: brightness and beat pulse
    float beatPulse = pow(1.0 - u_beatPhase, 2.0) * u_rms * 0.8;
    float brightness = u_brightness + u_rms * u_dynamicRange + beatPulse;
    colour *= brightness * max(u_signalPresence, 0.15);

    // Step 7: high-frequency shimmer
    float sparkle = fract(sin(dot(v_uv * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
    colour += vec3(sparkle) * u_highBand * 0.35;

    // Step 8: chord change flash (desaturate toward luminance)
    float lum = dot(colour, vec3(0.299, 0.587, 0.114));
    colour = mix(colour, vec3(lum), u_chromaNovelty * 0.4);

    gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
  }
`

// ---------------------------------------------------------------------------
// Palette pairs per colour scheme (cool = low valence, warm = high valence)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number]

interface Palette { a: Vec3; b: Vec3; c: Vec3; d: Vec3 }
interface PalettePair { cool: Palette; warm: Palette }

const PALETTES: Record<string, PalettePair> = {
  'neon-dark': {
    cool: { a: [0.2, 0.3, 0.6], b: [0.4, 0.4, 0.7], c: [1, 1, 1], d: [0.5, 0.6, 0.7] },
    warm: { a: [0.6, 0.5, 0.3], b: [0.7, 0.6, 0.4], c: [1, 1, 1], d: [0.0, 0.1, 0.2] },
  },
  'sunset': {
    cool: { a: [0.4, 0.1, 0.3], b: [0.5, 0.2, 0.4], c: [1, 1, 1], d: [0.6, 0.7, 0.8] },
    warm: { a: [0.7, 0.3, 0.1], b: [0.6, 0.5, 0.2], c: [1, 1, 1], d: [0.0, 0.1, 0.3] },
  },
  'ocean': {
    cool: { a: [0.1, 0.2, 0.5], b: [0.2, 0.3, 0.6], c: [1, 1, 1], d: [0.5, 0.6, 0.7] },
    warm: { a: [0.1, 0.5, 0.5], b: [0.2, 0.5, 0.4], c: [1, 1, 1], d: [0.5, 0.3, 0.5] },
  },
  'mono': {
    cool: { a: [0.15, 0.15, 0.2], b: [0.25, 0.25, 0.3], c: [1, 1, 1], d: [0.0, 0.1, 0.2] },
    warm: { a: [0.5, 0.5, 0.5],  b: [0.5, 0.5, 0.5],  c: [1, 1, 1], d: [0.0, 0.0, 0.0] },
  },
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`Plasma shader compile error: ${log}`)
  }
  return shader
}

interface Shockwave {
  x: number
  y: number
  age: number       // wall-clock seconds since spawn
  strength: number  // rms at spawn time
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class PlasmaRenderer implements BaseRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vbo: WebGLBuffer
  private plasmaTime = 0
  private lastTimestamp = 0
  private shockwaves: Shockwave[] = []

  // Cached uniform locations
  private uTime: WebGLUniformLocation
  private uTension: WebGLUniformLocation
  private uBuildupIntensity: WebGLUniformLocation
  private uRms: WebGLUniformLocation
  private uSignalPresence: WebGLUniformLocation
  private uBeatPhase: WebGLUniformLocation
  private uHighBand: WebGLUniformLocation
  private uChromaNovelty: WebGLUniformLocation
  private uPaletteA: WebGLUniformLocation
  private uPaletteB: WebGLUniformLocation
  private uPaletteC: WebGLUniformLocation
  private uPaletteD: WebGLUniformLocation
  private uBrightness: WebGLUniformLocation
  private uDynamicRange: WebGLUniformLocation
  private uSwCount: WebGLUniformLocation
  private uSwOrigin: WebGLUniformLocation
  private uSwAge: WebGLUniformLocation
  private uSwStrength: WebGLUniformLocation

  // Pre-allocated shock wave upload buffers (avoids hot-path GC pressure)
  private swOrigins   = new Float32Array(16)
  private swAges      = new Float32Array(8)
  private swStrengths = new Float32Array(8)

  // Config-derived values — public so VisualizerCanvas can update sliders without a full rebuild
  brightness: number
  dynamicRange: number
  private palettePair: PalettePair

  constructor(canvas: HTMLCanvasElement, config: PlasmaConfig) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not supported in this browser.')
    this.gl = gl

    // Compile shaders
    const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC)
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC)

    // Link program
    const program = gl.createProgram()!
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Plasma program link error: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    this.program = program

    // Fullscreen quad: 6 vertices for 2 triangles covering [-1,1]²
    const quad = new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ])
    const vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
    this.vbo = vbo

    // Bind position attribute
    gl.useProgram(program)
    const aPos = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

    // Cache uniform locations
    const ul = (name: string) => gl.getUniformLocation(program, name)!
    this.uTime             = ul('u_time')
    this.uTension          = ul('u_tension')
    this.uBuildupIntensity = ul('u_buildupIntensity')
    this.uRms              = ul('u_rms')
    this.uSignalPresence   = ul('u_signalPresence')
    this.uBeatPhase        = ul('u_beatPhase')
    this.uHighBand         = ul('u_highBand')
    this.uChromaNovelty    = ul('u_chromaNovelty')
    this.uPaletteA         = ul('u_paletteA')
    this.uPaletteB         = ul('u_paletteB')
    this.uPaletteC         = ul('u_paletteC')
    this.uPaletteD         = ul('u_paletteD')
    this.uBrightness       = ul('u_brightness')
    this.uDynamicRange     = ul('u_dynamicRange')
    this.uSwCount          = ul('u_swCount')
    this.uSwOrigin         = ul('u_swOrigin[0]')
    this.uSwAge            = ul('u_swAge[0]')
    this.uSwStrength       = ul('u_swStrength[0]')

    this.brightness    = config.brightness
    this.dynamicRange  = config.dynamicRange
    this.palettePair   = PALETTES[config.colorScheme] ?? PALETTES['neon-dark']

    gl.clearColor(0, 0, 0, 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE)  // additive blending: shock wave rings add light to plasma
    gl.viewport(0, 0, canvas.width, canvas.height)
  }

  render(_fft: Float32Array, _wave: Float32Array, features: AudioFeatures): void {
    const { gl } = this

    // Advance clocks
    const now = performance.now()
    const dt = this.lastTimestamp === 0 ? 0 : now - this.lastTimestamp
    this.lastTimestamp = now
    this.plasmaTime += dt * 0.001 * (0.3 + features.arousal * 1.4)

    // Age and expire shock waves (wall-clock seconds, independent of arousal)
    for (const sw of this.shockwaves) sw.age += dt * 0.001
    this.shockwaves = this.shockwaves.filter(sw => sw.age < 1.5)

    // Spawn new shock wave on onset
    if (features.isOnset) {
      this.shockwaves.push({ x: Math.random(), y: Math.random(), age: 0, strength: features.rms })
      if (this.shockwaves.length > 8) this.shockwaves.shift()
    }

    // Interpolate palette from cool (valence=0) to warm (valence=1) using active palette pair
    const { cool, warm } = this.palettePair
    const v = features.valence
    const pa = lerp3(cool.a, warm.a, v)
    const pb = lerp3(cool.b, warm.b, v)
    const pc = lerp3(cool.c, warm.c, v)
    const pd = lerp3(cool.d, warm.d, v)
    // Warmth nudge toward amber (independent of valence axis)
    pa[0] += features.warmth * 0.15
    pa[1] += features.warmth * 0.08

    // Upload uniforms
    gl.uniform1f(this.uTime,             this.plasmaTime)
    gl.uniform1f(this.uTension,          features.tension)
    gl.uniform1f(this.uBuildupIntensity, features.buildupIntensity)
    gl.uniform1f(this.uRms,              features.rms)
    gl.uniform1f(this.uSignalPresence,   features.signalPresence)
    gl.uniform1f(this.uBeatPhase,        features.beatPhase)
    gl.uniform1f(this.uHighBand,         features.bandEnergy[3])
    gl.uniform1f(this.uChromaNovelty,    features.chromaNovelty)
    gl.uniform3fv(this.uPaletteA, pa)
    gl.uniform3fv(this.uPaletteB, pb)
    gl.uniform3fv(this.uPaletteC, pc)
    gl.uniform3fv(this.uPaletteD, pd)
    gl.uniform1f(this.uBrightness,   this.brightness)
    gl.uniform1f(this.uDynamicRange, this.dynamicRange)
    gl.uniform1i(this.uSwCount, this.shockwaves.length)

    // Pack shock wave arrays into pre-allocated buffers
    this.shockwaves.forEach((sw, i) => {
      this.swOrigins[i * 2]     = sw.x
      this.swOrigins[i * 2 + 1] = sw.y
      this.swAges[i]            = sw.age
      this.swStrengths[i]       = sw.strength
    })
    gl.uniform2fv(this.uSwOrigin,   this.swOrigins)
    gl.uniform1fv(this.uSwAge,      this.swAges)
    gl.uniform1fv(this.uSwStrength, this.swStrengths)

    // Draw
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height)
  }

  destroy(): void {
    const { gl, program, vbo } = this
    gl.deleteProgram(program)
    gl.deleteBuffer(vbo)
    // Note: do NOT call loseContext() — it permanently invalidates the canvas's WebGL context,
    // which prevents rebuilding a new renderer on the same canvas element.
  }
}
