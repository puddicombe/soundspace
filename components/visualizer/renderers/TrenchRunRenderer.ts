import type { BaseRenderer } from './BaseRenderer'
import type { TrenchRunConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

// ---------------------------------------------------------------------------
// Pure functions (exported for unit testing)
// ---------------------------------------------------------------------------

export function computeScrollDelta(rms: number, dt: number, isOnset: boolean): number {
  return (30 + rms * 90) * dt + (isOnset ? 8 : 0)
}

export function computeBankAngle(time: number, rms: number, bankIntensity: number): number {
  return Math.sin(time * 0.25 * 2 * Math.PI) * rms * bankIntensity * (25 * Math.PI / 180)
}

export function computeWarpAmount(bass: number, warpIntensity: number): number {
  return bass * warpIntensity * 0.4
}

export function computeReticleRadius(rms: number, bass: number): number {
  return 30 + bass * 20 + rms * 10
}

// ---------------------------------------------------------------------------
// GLSL shaders (#version 300 es)
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SRC = `#version 300 es
in vec3 a_position;
out float v_depth;

uniform mat4 u_mvp;
uniform float u_zOffset;
uniform float u_bassBreath;
uniform float u_beatFlash;
uniform float u_warpAmount;

const float TUNNEL_LENGTH = 80.0;

void main() {
  vec3 pos = a_position;
  pos.z = mod(pos.z - u_zOffset, TUNNEL_LENGTH) - TUNNEL_LENGTH * 0.5;
  pos.xy *= 1.0 + u_bassBreath * 0.08;
  gl_Position = u_mvp * vec4(pos, 1.0);
  float r2 = dot(gl_Position.xy, gl_Position.xy);
  gl_Position.xy *= 1.0 + u_warpAmount * r2;
  v_depth = max(0.0, pos.z);
}
`

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;
in float v_depth;
out vec4 fragColor;

uniform vec3 u_color;
uniform float u_alpha;
uniform float u_beatFlash;
uniform float u_scanRange;

void main() {
  float nd = v_depth / u_scanRange;
  float depthFade = 1.0 / (1.0 + nd * nd);
  float brightness = 1.0 + u_beatFlash * 0.5;
  fragColor = vec4(u_color * brightness, u_alpha * depthFade);
}
`

// ---------------------------------------------------------------------------
// Module-level pre-allocated scratch buffers for mat4 operations
// ---------------------------------------------------------------------------

const _m4a = new Float32Array(16)
const _m4b = new Float32Array(16)
const _mvp = new Float32Array(16)
const _colorBuf = new Float32Array(3)

// ---------------------------------------------------------------------------
// Inline mat4 utilities (column-major Float32Array[16])
// ---------------------------------------------------------------------------

type Mat4 = Float32Array

function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k]
      }
      out[col * 4 + row] = sum
    }
  }
  return out
}

function mat4Perspective(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  out.fill(0)
  const f = 1.0 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf
  return out
}

function mat4LookAt(
  out: Mat4,
  eyeX: number, eyeY: number, eyeZ: number,
  centerX: number, centerY: number, centerZ: number,
  upX: number, upY: number, upZ: number,
): Mat4 {
  // Forward = normalize(center - eye)
  let fx = centerX - eyeX, fy = centerY - eyeY, fz = centerZ - eyeZ
  let len = Math.sqrt(fx * fx + fy * fy + fz * fz)
  fx /= len; fy /= len; fz /= len

  // Side = normalize(forward x up)
  let sx = fy * upZ - fz * upY
  let sy = fz * upX - fx * upZ
  let sz = fx * upY - fy * upX
  len = Math.sqrt(sx * sx + sy * sy + sz * sz)
  sx /= len; sy /= len; sz /= len

  // Recompute up = side x forward
  const ux = sy * fz - sz * fy
  const uy = sz * fx - sx * fz
  const uz = sx * fy - sy * fx

  out[0] = sx;  out[1] = ux;  out[2]  = -fx; out[3]  = 0
  out[4] = sy;  out[5] = uy;  out[6]  = -fy; out[7]  = 0
  out[8] = sz;  out[9] = uz;  out[10] = -fz; out[11] = 0
  out[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ)
  out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ)
  out[14] = fx * eyeX + fy * eyeY + fz * eyeZ
  out[15] = 1
  return out
}

// ---------------------------------------------------------------------------
// Palette lookup
// ---------------------------------------------------------------------------

const PALETTES: Record<string, { grid: [number, number, number]; hud: [number, number, number] }> = {
  'neon-dark': { grid: [0, 0.898, 1.0],    hud: [1.0, 0.702, 0] },
  'ocean':     { grid: [0, 0.314, 1.0],     hud: [0, 1.0, 0.533] },
  'mono':      { grid: [0.224, 1.0, 0.078], hud: [1.0, 1.0, 1.0] },
  'sunset':    { grid: [1.0, 0.271, 0],     hud: [1.0, 1.0, 1.0] },
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
    throw new Error('TrenchRun shader compile error: ' + log)
  }
  return shader
}

// ---------------------------------------------------------------------------
// Tunnel geometry constants
// ---------------------------------------------------------------------------

const TUNNEL_LENGTH    = 80.0
const TRENCH_W         = 6.0   // half-width; walls at x = ±TRENCH_W
const TRENCH_H         = 3.0   // floor at y = -TRENCH_H
const TRENCH_TOP       = 5.0   // walls extend to y = +TRENCH_TOP (open above)
const BASE_SCAN_RANGE  = 35.0  // visible distance at silence
const SCAN_RANGE_DELTA = 35.0  // additional range added at full RMS

// ---------------------------------------------------------------------------
// Scanline overlay helper
// ---------------------------------------------------------------------------

function buildScanlineCanvas(w: number, h: number): OffscreenCanvas | null {
  try {
    const oc = new OffscreenCanvas(w, h)
    const ctx = oc.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = 'rgba(0,0,0,0.05)'
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1)
    }
    return oc
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class TrenchRunRenderer implements BaseRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private buffer: WebGLBuffer
  private overlay: HTMLCanvasElement
  private overlayCtx: CanvasRenderingContext2D | null
  private scanlineCanvas: OffscreenCanvas | null

  // Uniform locations
  private u_mvpLoc: WebGLUniformLocation | null
  private u_zOffsetLoc: WebGLUniformLocation | null
  private u_bassBreathLoc: WebGLUniformLocation | null
  private u_beatFlashLoc: WebGLUniformLocation | null
  private u_warpAmountLoc: WebGLUniformLocation | null
  private u_colorLoc: WebGLUniformLocation | null
  private u_alphaLoc: WebGLUniformLocation | null
  private u_scanRangeLoc: WebGLUniformLocation | null

  // Geometry layout
  private segmentCount: number

  // Animation state
  private lastTime: number = 0
  private time: number = 0
  private zOffset: number = 0
  private beatFlash: number = 0
  private smoothedRms: number = 0
  private smoothedBass: number = 0
  private lockTimer: number = 0
  private radarY: number = 0

  // Palette
  private colorScheme: string

  // Public properties (set by VisualizerCanvas in-place)
  scrollSpeed: number
  bankIntensity: number
  warpIntensity: number
  hudOpacity: number

  constructor(canvas: HTMLCanvasElement, config: TrenchRunConfig) {
    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not supported')
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
      throw new Error('TrenchRun shader link error: ' + gl.getProgramInfoLog(program))
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    this.program = program

    // Config
    this.scrollSpeed = config.scrollSpeed
    this.bankIntensity = config.bankIntensity
    this.warpIntensity = config.warpIntensity
    this.hudOpacity = config.hudOpacity
    this.colorScheme = config.colorScheme
    this.segmentCount = config.gridDensity

    // Build rectangular trench geometry
    // Layout: [floor | left wall | right wall], each face = gridDensity*4 vertices
    const N = config.gridDensity

    const totalVertices = N * 4 * 3  // 3 faces × 4N verts
    const positions = new Float32Array(totalVertices * 3)
    let idx = 0

    // FLOOR (y = -TRENCH_H, x from -TRENCH_W to +TRENCH_W)
    for (let i = 0; i < N; i++) {
      const x = -TRENCH_W + (2 * TRENCH_W * i) / (N - 1)
      positions[idx++] = x; positions[idx++] = -TRENCH_H; positions[idx++] = 0
      positions[idx++] = x; positions[idx++] = -TRENCH_H; positions[idx++] = TUNNEL_LENGTH
    }
    for (let i = 0; i < N; i++) {
      const z = (i / (N - 1)) * TUNNEL_LENGTH
      positions[idx++] = -TRENCH_W; positions[idx++] = -TRENCH_H; positions[idx++] = z
      positions[idx++] =  TRENCH_W; positions[idx++] = -TRENCH_H; positions[idx++] = z
    }

    // LEFT WALL (x = -TRENCH_W, y from -TRENCH_H to +TRENCH_TOP)
    for (let i = 0; i < N; i++) {
      const y = -TRENCH_H + (TRENCH_H + TRENCH_TOP) * i / (N - 1)
      positions[idx++] = -TRENCH_W; positions[idx++] = y; positions[idx++] = 0
      positions[idx++] = -TRENCH_W; positions[idx++] = y; positions[idx++] = TUNNEL_LENGTH
    }
    for (let i = 0; i < N; i++) {
      const z = (i / (N - 1)) * TUNNEL_LENGTH
      positions[idx++] = -TRENCH_W; positions[idx++] = -TRENCH_H; positions[idx++] = z
      positions[idx++] = -TRENCH_W; positions[idx++] =  TRENCH_TOP; positions[idx++] = z
    }

    // RIGHT WALL (x = +TRENCH_W, y from -TRENCH_H to +TRENCH_TOP)
    for (let i = 0; i < N; i++) {
      const y = -TRENCH_H + (TRENCH_H + TRENCH_TOP) * i / (N - 1)
      positions[idx++] = TRENCH_W; positions[idx++] = y; positions[idx++] = 0
      positions[idx++] = TRENCH_W; positions[idx++] = y; positions[idx++] = TUNNEL_LENGTH
    }
    for (let i = 0; i < N; i++) {
      const z = (i / (N - 1)) * TUNNEL_LENGTH
      positions[idx++] = TRENCH_W; positions[idx++] = -TRENCH_H; positions[idx++] = z
      positions[idx++] = TRENCH_W; positions[idx++] =  TRENCH_TOP; positions[idx++] = z
    }

    // Upload buffer
    const buffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW)
    this.buffer = buffer

    // Bind position attribute
    gl.useProgram(program)
    const aPos = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)

    // Cache uniform locations
    this.u_mvpLoc = gl.getUniformLocation(program, 'u_mvp')
    this.u_zOffsetLoc = gl.getUniformLocation(program, 'u_zOffset')
    this.u_bassBreathLoc = gl.getUniformLocation(program, 'u_bassBreath')
    this.u_beatFlashLoc = gl.getUniformLocation(program, 'u_beatFlash')
    this.u_warpAmountLoc = gl.getUniformLocation(program, 'u_warpAmount')
    this.u_colorLoc = gl.getUniformLocation(program, 'u_color')
    this.u_alphaLoc = gl.getUniformLocation(program, 'u_alpha')
    this.u_scanRangeLoc = gl.getUniformLocation(program, 'u_scanRange')

    // Initial GL state
    gl.clearColor(0, 0, 0, 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.viewport(0, 0, canvas.width, canvas.height)

    // HUD overlay canvas
    this.overlay = document.createElement('canvas')
    this.overlay.width = canvas.width
    this.overlay.height = canvas.height
    this.overlay.style.position = 'absolute'
    this.overlay.style.top = '0'
    this.overlay.style.left = '0'
    this.overlay.style.pointerEvents = 'none'
    this.overlay.style.zIndex = '10'

    if (canvas.parentElement) {
      canvas.parentElement.appendChild(this.overlay)
    }

    this.overlayCtx = this.overlay.getContext('2d')
    this.scanlineCanvas = buildScanlineCanvas(canvas.width, canvas.height)
  }

  render(_fft: Float32Array, _wave: Float32Array, features: AudioFeatures): void {
    const { gl } = this

    // Frame timing
    const now = performance.now()
    const dt = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000
    this.lastTime = now

    // Smoothed values (EMA, tau=150ms)
    const alpha = dt > 0 ? 1 - Math.exp(-dt / 0.15) : 0
    this.smoothedRms += (features.rms - this.smoothedRms) * alpha
    this.smoothedBass += (features.bandEnergy[1] - this.smoothedBass) * alpha

    const isOnset = features.isOnset

    // Beat flash
    this.beatFlash = isOnset ? 1.0 : this.beatFlash * Math.exp(-dt / 0.06)

    // Scroll
    this.zOffset += computeScrollDelta(this.smoothedRms, dt, isOnset) * this.scrollSpeed

    // Bank
    this.time += dt
    const bankAngle = computeBankAngle(this.time, this.smoothedRms, this.bankIntensity)

    // Warp
    const warpAmount = computeWarpAmount(this.smoothedBass, this.warpIntensity)

    // Lock timer
    if (isOnset) this.lockTimer = 400
    this.lockTimer = Math.max(0, this.lockTimer - dt * 1000)

    // Radar sweep
    if (isOnset) this.radarY = 0
    this.radarY += (this.overlay.height / 2) * dt

    // MVP matrix
    const aspect = gl.drawingBufferWidth / (gl.drawingBufferHeight || 1)
    mat4Perspective(_m4a, Math.PI / 3, aspect, 0.1, 200)
    mat4LookAt(_m4b, 0, 0, -10, 0, 0, 0, Math.sin(bankAngle), Math.cos(bankAngle), 0)
    mat4Multiply(_mvp, _m4a, _m4b)

    // Palette + spectral shift
    const palette = PALETTES[this.colorScheme] ?? PALETTES['neon-dark']
    const norm = Math.min(features.spectralCentroid / 8000, 1.0)
    let [r, g, b] = palette.grid
    if (norm < 0.4) { r *= 0.7; g *= 0.7 }
    if (norm > 0.6) { r = Math.min(r + 0.3, 1); g = Math.min(g + 0.3, 1); b = Math.min(b + 0.3, 1) }

    // Upload uniforms
    gl.useProgram(this.program)
    gl.uniformMatrix4fv(this.u_mvpLoc, false, _mvp)
    gl.uniform1f(this.u_zOffsetLoc, this.zOffset)
    gl.uniform1f(this.u_bassBreathLoc, this.smoothedBass)
    gl.uniform1f(this.u_beatFlashLoc, this.beatFlash)
    gl.uniform1f(this.u_warpAmountLoc, warpAmount)
    _colorBuf[0] = r; _colorBuf[1] = g; _colorBuf[2] = b
    gl.uniform3fv(this.u_colorLoc, _colorBuf)
    const scanRange = BASE_SCAN_RANGE + this.smoothedRms * SCAN_RANGE_DELTA
    gl.uniform1f(this.u_scanRangeLoc, scanRange)

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Draw geometry (two passes for glow)
    const segmentCount = this.segmentCount

    // Halo pass
    gl.uniform1f(this.u_alphaLoc, 0.2)
    this.drawGeometry(gl, segmentCount)

    // Core pass
    gl.uniform1f(this.u_alphaLoc, 1.0)
    this.drawGeometry(gl, segmentCount)

    // HUD overlay
    this.drawHud(features)
  }

  private drawGeometry(gl: WebGL2RenderingContext, N: number): void {
    gl.drawArrays(gl.LINES, 0,     N * 4)  // floor
    gl.drawArrays(gl.LINES, N * 4, N * 4)  // left wall
    gl.drawArrays(gl.LINES, N * 8, N * 4)  // right wall
  }

  private drawHud(features: AudioFeatures): void {
    const ctx = this.overlayCtx
    if (!ctx) return

    const w = this.overlay.width
    const h = this.overlay.height

    ctx.globalAlpha = this.hudOpacity

    ctx.clearRect(0, 0, w, h)

    // Scanlines
    if (this.scanlineCanvas) {
      ctx.drawImage(this.scanlineCanvas, 0, 0)
    }
    const palette = PALETTES[this.colorScheme] ?? PALETTES['neon-dark']
    const [hr, hg, hb] = palette.hud
    const hudColor = `rgba(${Math.round(hr * 255)},${Math.round(hg * 255)},${Math.round(hb * 255)},1)`

    ctx.strokeStyle = hudColor
    ctx.fillStyle = hudColor
    ctx.lineWidth = 1

    // Corner brackets (L-shaped, 40px arms)
    const arm = 40
    const margin = 20
    ctx.beginPath()
    // Top-left
    ctx.moveTo(margin, margin + arm); ctx.lineTo(margin, margin); ctx.lineTo(margin + arm, margin)
    // Top-right
    ctx.moveTo(w - margin - arm, margin); ctx.lineTo(w - margin, margin); ctx.lineTo(w - margin, margin + arm)
    // Bottom-left
    ctx.moveTo(margin, h - margin - arm); ctx.lineTo(margin, h - margin); ctx.lineTo(margin + arm, h - margin)
    // Bottom-right
    ctx.moveTo(w - margin - arm, h - margin); ctx.lineTo(w - margin, h - margin); ctx.lineTo(w - margin, h - margin - arm)
    ctx.stroke()

    // Targeting reticle
    const cx = w / 2
    const cy = h / 2
    const baseRadius = computeReticleRadius(this.smoothedRms, this.smoothedBass)

    // 3 concentric circles
    const radii = [baseRadius * 0.5, baseRadius * 0.75, baseRadius * (1.0 + this.beatFlash * 0.3)]
    for (const r of radii) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Crosshair
    const crossSize = baseRadius * 1.2
    ctx.beginPath()
    ctx.moveTo(cx - crossSize, cy); ctx.lineTo(cx + crossSize, cy)
    ctx.moveTo(cx, cy - crossSize); ctx.lineTo(cx, cy + crossSize)
    ctx.stroke()

    // Data readouts (monospace 11px)
    ctx.font = '11px monospace'
    ctx.textBaseline = 'top'

    // Top-left: BPM
    const bpmText = `BPM: ${features.bpm === null ? '---' : Math.round(features.bpm)}`
    ctx.fillText(bpmText, margin + 5, margin + 5)

    // Top-right: RMS
    ctx.textAlign = 'right'
    ctx.fillText(`RMS: ${this.smoothedRms.toFixed(2)}`, w - margin - 5, margin + 5)

    // Bottom-left
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(`VEL: ${(this.scrollSpeed * (1 + this.smoothedRms * 0.5)).toFixed(1)}x`, margin + 5, h - margin - 5)

    // Bottom-right
    ctx.textAlign = 'right'
    ctx.fillText(`TGT: ${this.lockTimer > 0 ? 'LOCK' : 'SCAN'}`, w - margin - 5, h - margin - 5)

    // Radar sweep line
    ctx.textAlign = 'left'
    ctx.beginPath()
    ctx.moveTo(0, this.radarY)
    ctx.lineTo(w, this.radarY)
    ctx.stroke()

    ctx.globalAlpha = 1.0
  }

  resize(w: number, h: number): void {
    this.gl.viewport(0, 0, w, h)
    this.overlay.width = w
    this.overlay.height = h
    this.scanlineCanvas = buildScanlineCanvas(w, h)
  }

  destroy(): void {
    const { gl, program, buffer } = this
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    this.overlay.parentElement?.removeChild(this.overlay)
  }
}
