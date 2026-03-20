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

const float TUNNEL_LENGTH = 280.0;

void main() {
  vec3 pos = a_position;
  pos.z = mod(pos.z - u_zOffset, TUNNEL_LENGTH) - TUNNEL_LENGTH * 0.5;
  pos.xy *= 1.0 + u_bassBreath * 0.08;
  gl_Position = u_mvp * vec4(pos, 1.0);
  // Compute warp in NDC space (divide by w) so edge geometry isn't blown off-screen
  vec2 ndc = gl_Position.xy / gl_Position.w;
  float r2 = dot(ndc, ndc);
  gl_Position.xy += ndc * u_warpAmount * r2 * gl_Position.w;
  v_depth = max(0.0, pos.z);
}
`

const FRAGMENT_SHADER_SRC = `#version 300 es
precision mediump float;
in float v_depth;
out vec4 fragColor;

uniform vec3  u_color;
uniform float u_alpha;
uniform float u_beatFlash;
uniform float u_scanRange;
uniform float u_hueTime;   // >0 → override color with rainbow cycling; 0 → use u_color

// Compact HSV → RGB (IQ formula)
vec3 hsvToRgb(float h, float s, float v) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(vec3(h) + K.xyz) * 6.0 - K.www);
  return v * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), s);
}

void main() {
  float nd = v_depth / u_scanRange;
  // Exponential depth fog — denser near horizon, atmospheric
  float fogFactor = exp(-nd * 0.9);
  float brightness = 1.0 + u_beatFlash * 0.5;
  vec3 col = u_hueTime > 0.0
    ? hsvToRgb(fract(v_depth / 55.0 + u_hueTime), 0.88, 1.0)
    : u_color;
  // Blend geometry colour toward a deep dark-blue fog at distance
  vec3 fogColor = vec3(0.0, 0.004, 0.022);
  vec3 finalCol = mix(fogColor, col * brightness, fogFactor);
  // Minimum alpha 0.018 so very distant lines leave a faint fog-coloured trace
  fragColor = vec4(finalCol, u_alpha * (fogFactor * 0.98 + 0.02));
}
`

// ---------------------------------------------------------------------------
// Module-level pre-allocated scratch buffers for mat4 operations
// ---------------------------------------------------------------------------

const _m4a = new Float32Array(16)
const _m4b = new Float32Array(16)
const _mvp = new Float32Array(16)
const _colorBuf = new Float32Array(3)
const _beamColor     = new Float32Array([1.0, 0.95, 0.3])  // yellow — debris
const _smokeColor    = new Float32Array([0.9, 0.35, 0.1])  // warm orange — missile exhaust
const _playerColor   = new Float32Array([0.35, 1.0, 0.45]) // green — player shots
const _explodeColor  = new Float32Array([1.0, 0.5, 0.1])   // orange — explosions
const _obstacleColor = new Float32Array([1.0, 0.55, 0.0])  // amber — obstacle bars

// Neon palette for per-missile colour variety
const MISSILE_COLORS = [
  new Float32Array([1.0, 0.08, 0.05]), // hot red
  new Float32Array([0.0, 0.88, 1.0]),  // electric cyan
  new Float32Array([1.0, 0.92, 0.0]),  // acid yellow
  new Float32Array([1.0, 0.1,  0.85]), // neon magenta
  new Float32Array([0.1, 1.0,  0.4]),  // toxic green
]

// ---------------------------------------------------------------------------
// Turret types
// ---------------------------------------------------------------------------

interface TurretDef { baseZ: number; x: number; y: number; surface: 'floor'|'left'|'right'; type: 0|1|2 }
interface TurretState { aimAngle: number; nextShot: number; shootTimer: number; destroyed: boolean; respawnTimer: number }
interface Missile { wx: number; wy: number; wz: number; vx: number; vy: number; vz: number; life: number; smokeTimer: number; colorIdx: number }
interface SmokeParticle { wx: number; wy: number; wz: number; vx: number; vy: number; life: number; maxLife: number }
interface PlayerProjectile { wx: number; wy: number; wz: number; vz: number; life: number }
interface Explosion { wx: number; wy: number; wz: number; radius: number; life: number; maxLife: number }
interface Obstacle { baseZ: number; y: number; halfH: number }  // baseZ = tunnel-space z, like turrets
interface FlyingObject {
  wx: number; wy: number; wz: number
  vx: number; vy: number; vz: number
  angle: number; spin: number
  scale: number
  type: 'tie' | 'debris'
}

// Literal values: floor y=-3 (TRENCH_H), wall x=±6 (TRENCH_W)
const TURRET_DEFS: TurretDef[] = [
  { baseZ:  10, x:  1.0, y: -3,   surface: 'floor', type: 0 },
  { baseZ:  22, x: -6,   y:  1.5, surface: 'left',  type: 2 },
  { baseZ:  32, x:  6,   y:  0.5, surface: 'right', type: 1 },
  { baseZ:  42, x: -1.0, y: -3,   surface: 'floor', type: 1 },
  { baseZ:  54, x: -6,   y: -0.5, surface: 'left',  type: 0 },
  { baseZ:  63, x:  6,   y:  2.5, surface: 'right', type: 2 },
  { baseZ:  74, x:  0.5, y: -3,   surface: 'floor', type: 2 },
  { baseZ:  86, x: -6,   y:  3.0, surface: 'left',  type: 1 },
  { baseZ:  96, x:  6,   y: -0.5, surface: 'right', type: 0 },
  { baseZ: 108, x: -0.5, y: -3,   surface: 'floor', type: 0 },
  { baseZ: 120, x: -6,   y:  1.0, surface: 'left',  type: 2 },
  { baseZ: 132, x:  6,   y:  1.5, surface: 'right', type: 1 },
  { baseZ: 142, x:  1.0, y: -3,   surface: 'floor', type: 1 },
  { baseZ: 154, x: -6,   y:  0.0, surface: 'left',  type: 0 },
]

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
// Sky overlay constants
// ---------------------------------------------------------------------------

// Capital ship silhouettes — normalised coords, center=(0,0), x∈[-1,1], y∈[-0.5,0.5]
const SHIP_OUTLINES: [number, number][][] = [
  // Type 0 — angular wedge destroyer
  [[-1, 0.12], [-0.22, -0.3], [0, -0.45], [0.22, -0.3], [1, 0.12], [0.65, 0.28], [-0.65, 0.28]],
  // Type 1 — rectangular dreadnought
  [[-1, -0.22], [1, -0.22], [1.15, 0.0], [0.85, 0.32], [-0.85, 0.32], [-1.15, 0.0]],
]

// Nebula blob definitions — fractional canvas positions
const NEBULA_DEFS = [
  { fx: 0.18, fy: 0.13, r: 0.32 },
  { fx: 0.72, fy: 0.09, r: 0.27 },
  { fx: 0.50, fy: 0.21, r: 0.38 },
]

/** HSV → CSS rgba string */
function hsvCss(h: number, s: number, v: number, a: number): string {
  h = ((h % 1) + 1) % 1
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  let rv: number, gv: number, bv: number
  switch (i % 6) {
    case 0: rv = v; gv = t; bv = p; break
    case 1: rv = q; gv = v; bv = p; break
    case 2: rv = p; gv = v; bv = t; break
    case 3: rv = p; gv = q; bv = v; break
    case 4: rv = t; gv = p; bv = v; break
    default: rv = v; gv = p; bv = q
  }
  return `rgba(${Math.round(rv*255)},${Math.round(gv*255)},${Math.round(bv*255)},${a.toFixed(3)})`
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

const TUNNEL_LENGTH    = 280.0
const TRENCH_W         = 6.0   // half-width; walls at x = ±TRENCH_W
const TRENCH_H         = 3.0   // floor at y = -TRENCH_H
const TRENCH_TOP       = 5.0   // walls extend to y = +TRENCH_TOP (open above)
const SCAN_RANGE_DELTA = 90.0  // audio extension added on top of manual scan range at full RMS
const DETAIL_SECTIONS  = 35    // panel bays along the tunnel

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
  private detailBuffer: WebGLBuffer
  private detailVertexCount: number = 0
  private solidPanelBuffer!: WebGLBuffer
  private solidFloorVertCount: number = 0   // gl.TRIANGLES — bass-pulsing floor strips
  private solidWallVertCount:  number = 0   // gl.TRIANGLES — rms-pulsing wall panels
  private aPosLoc: number = 0
  private turretBuffer!: WebGLBuffer
  private turretVerts: Float32Array = new Float32Array(20000)
  private turretStructVertCount: number = 0
  private missileVertCounts: number[] = new Array(MISSILE_COLORS.length).fill(0)
  private missileTotalVerts: number = 0
  private debrisVertCount: number = 0     // yellow — flying debris
  private playerVertCount: number = 0
  private explodeVertCount: number = 0
  private obstacleVertCount: number = 0
  private smokeVertCount: number = 0      // warm orange — missile exhaust
  private turretStates: TurretState[] = []
  private missiles: Missile[] = []
  private smokeParticles: SmokeParticle[] = []
  private playerProjectiles: PlayerProjectile[] = []
  private explosions: Explosion[] = []
  private flyingObjects: FlyingObject[] = []
  private tieSpawnTimer: number = 0
  private debrisSpawnTimer: number = 0
  private cameraLX: number = 0    // camera lateral position, updated each frame
  private cameraLY: number = 0
  private shotSide: number = 0          // 0 = left wing, 1 = right wing
  private lastAutoShotTime: number = 0  // ms, compared against this.time * 1000
  private obstacles: Obstacle[] = []
  private obstacleSpawnTimer: number = 0
  private shieldFlash: number = 0   // 0→1 on hit, decays
  private shakeAmount: number = 0   // camera shake magnitude, decays
  private hueTime: number = 0          // panel colour cycle accumulator
  private gridHueTime: number = 0      // grid line colour cycle accumulator
  private frameScrollDelta: number = 0 // zOffset advance this frame (for missile speed floor)
  private overlay: HTMLCanvasElement
  private overlayCtx: CanvasRenderingContext2D | null
  private scanlineCanvas: OffscreenCanvas | null

  // Sky overlay state
  private stars: Array<{ fx: number; fy: number; sz: number; phase: number; speed: number }> = []
  private battleFlashes: Array<{ fx: number; fy: number; radius: number; maxRadius: number; life: number; maxLife: number; rgb: string }> = []
  private battleLasers: Array<{ fx0: number; fy0: number; fx1: number; fy1: number; life: number; maxLife: number; rgb: string }> = []
  private capitalShips: Array<{ fx: number; fy: number; vfx: number; scale: number; type: number }> = []
  private capitalSpawnTimer: number = 12000
  private nebulaPhase: number = 0
  private mvpCopy: Float32Array = new Float32Array(16)   // saved each frame for sky clip projection

  // Frequency band energies for panel FX (smoothed, set each render)
  private smoothedMid: number = 0    // mid frequencies → wall panel emphasis
  private smoothedHigh: number = 0   // high frequencies → wall panel hue cycling speed

  // Uniform locations
  private u_mvpLoc: WebGLUniformLocation | null
  private u_zOffsetLoc: WebGLUniformLocation | null
  private u_bassBreathLoc: WebGLUniformLocation | null
  private u_beatFlashLoc: WebGLUniformLocation | null
  private u_warpAmountLoc: WebGLUniformLocation | null
  private u_colorLoc: WebGLUniformLocation | null
  private u_alphaLoc: WebGLUniformLocation | null
  private u_scanRangeLoc: WebGLUniformLocation | null
  private u_hueTimeLoc: WebGLUniformLocation | null

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
  scanRange: number
  bankLateral: number
  missileRate: number      // 0=off, 1=default, 2=double rate
  skyIntensity: number     // 0–1: star/nebula/ship opacity multiplier
  battleIntensity: number  // 0–1: battle flash/laser spawn chance and alpha

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
    this.scrollSpeed     = config.scrollSpeed
    this.bankIntensity   = config.bankIntensity
    this.warpIntensity   = config.warpIntensity
    this.hudOpacity      = config.hudOpacity
    this.scanRange       = config.scanRange ?? 50
    this.bankLateral     = config.bankLateral ?? 0.7
    this.missileRate     = config.missileRate ?? 1.0
    this.skyIntensity    = config.skyIntensity ?? 1.0
    this.battleIntensity = config.battleIntensity ?? 1.0
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
    this.aPosLoc = aPos
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0)

    // Build detail geometry (panels, tiles) in a second buffer
    const detailPositions = this.buildDetailGeometry()
    this.detailVertexCount = detailPositions.length / 3
    const detailBuffer = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, detailBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, detailPositions, gl.STATIC_DRAW)
    this.detailBuffer = detailBuffer

    // Solid panel buffer (triangles for filled panels)
    const { floor: floorTris, wall: wallTris } = this.buildSolidPanelGeometry()
    this.solidFloorVertCount = floorTris.length / 3
    this.solidWallVertCount  = wallTris.length  / 3
    const solidAll = new Float32Array(floorTris.length + wallTris.length)
    solidAll.set(floorTris, 0)
    solidAll.set(wallTris,  floorTris.length)
    const solidBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, solidBuf)
    gl.bufferData(gl.ARRAY_BUFFER, solidAll, gl.STATIC_DRAW)
    this.solidPanelBuffer = solidBuf

    // Turret buffer (dynamic, rebuilt each frame)
    const turretBuf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, turretBuf)
    gl.bufferData(gl.ARRAY_BUFFER, this.turretVerts.byteLength, gl.DYNAMIC_DRAW)
    this.turretBuffer = turretBuf
    this.turretStates = TURRET_DEFS.map(() => ({
      aimAngle: Math.random() * Math.PI * 2,
      nextShot: Math.random() * 1500,
      shootTimer: 0,
      destroyed: false,
      respawnTimer: 0,
    }))

    // Restore main buffer binding
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
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
    this.u_hueTimeLoc = gl.getUniformLocation(program, 'u_hueTime')

    // Initial GL state — dark blue matching shader fog colour
    gl.clearColor(0.0, 0.004, 0.022, 1.0)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
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
    this.initStars()
  }

  render(_fft: Float32Array, _wave: Float32Array, features: AudioFeatures): void {
    const { gl } = this

    // Frame timing
    const now = performance.now()
    const dt = this.lastTime === 0 ? 0 : (now - this.lastTime) / 1000
    this.lastTime = now

    // Smoothed values (EMA, tau=150ms)
    const alpha = dt > 0 ? 1 - Math.exp(-dt / 0.15) : 0
    this.smoothedRms  += (features.rms            - this.smoothedRms)  * alpha
    this.smoothedBass += (features.bandEnergy[1] - this.smoothedBass) * alpha
    this.smoothedMid  += (features.bandEnergy[2] - this.smoothedMid)  * alpha  // mids (250Hz–2kHz)
    this.smoothedHigh += (features.bandEnergy[3] - this.smoothedHigh) * alpha  // highs (2kHz–20kHz)

    const isOnset = features.isOnset

    // Beat flash
    this.beatFlash = isOnset ? 1.0 : this.beatFlash * Math.exp(-dt / 0.06)

    // Scroll — speed scales with BPM relative to 120 bpm baseline
    const bpmFactor = features.bpm != null ? Math.max(0.5, Math.min(2.5, features.bpm / 120)) : 1.0
    const scrollDelta = computeScrollDelta(this.smoothedRms, dt, isOnset) * this.scrollSpeed * bpmFactor
    this.zOffset += scrollDelta
    // Store continuous (non-onset) scroll speed for missile speed floor
    this.frameScrollDelta = computeScrollDelta(this.smoothedRms, dt, false) * this.scrollSpeed * bpmFactor

    // Time (used by bank oscillators and sky effects)
    this.time += dt

    // Warp
    const warpAmount = computeWarpAmount(this.smoothedBass, this.warpIntensity)

    // Lock timer
    if (isOnset) this.lockTimer = 400
    this.lockTimer = Math.max(0, this.lockTimer - dt * 1000)

    // Radar sweep
    if (isOnset) this.radarY = 0
    this.radarY += (this.overlay.height / 2) * dt

    // Normalise rms so typical loud music (0.08) gives full motion range
    const normEnergy = Math.min(this.smoothedRms / 0.08, 1.0)

    // Two independent oscillators for lateral and vertical — different frequencies
    // avoid whole-number ratio so the path never exactly repeats
    const tLat  = this.time * 0.25 * 2 * Math.PI        // period ≈ 4 s
    const tVert = this.time * 0.19 * 2 * Math.PI + 1.1  // period ≈ 5.3 s, offset phase

    const lateralOffset = Math.sin(tLat)  * normEnergy * this.bankIntensity * this.bankLateral * TRENCH_W
    const vertOffset    = Math.sin(tVert) * normEnergy * this.bankIntensity * 2.5
    const rollAngle     = Math.sin(tLat)  * normEnergy * this.bankIntensity * 0.38  // ≈ 22° max

    // Store camera position for player shooting
    this.cameraLX = lateralOffset
    this.cameraLY = vertOffset

    // Colour-cycle accumulators
    // Grid lines: slow base + jump on each onset → "entering new stage" feel
    this.gridHueTime += dt * 0.025 + (isOnset ? 0.04 : 0)
    // Panels: faster, bass-driven
    this.hueTime += dt * (0.07 + this.smoothedBass * 0.25) + (isOnset ? 0.015 : 0)

    // Shield / shake decay
    this.shieldFlash = this.shieldFlash * Math.exp(-dt / 0.35)
    this.shakeAmount = this.shakeAmount * Math.exp(-dt / 0.12)

    // MVP matrix
    const aspect = gl.drawingBufferWidth / (gl.drawingBufferHeight || 1)
    mat4Perspective(_m4a, Math.PI / 3, aspect, 0.1, 300)
    const shakeX = this.shakeAmount * (Math.random() - 0.5) * 0.35
    const shakeY = this.shakeAmount * (Math.random() - 0.5) * 0.35
    const eyeX = lateralOffset + shakeX, eyeY = vertOffset + shakeY
    mat4LookAt(_m4b, eyeX, eyeY, -10, eyeX, eyeY, 0, Math.sin(rollAngle), Math.cos(rollAngle), 0)
    mat4Multiply(_mvp, _m4a, _m4b)
    this.mvpCopy.set(_mvp)

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
    const scanRange = this.scanRange + normEnergy * SCAN_RANGE_DELTA
    gl.uniform1f(this.u_scanRangeLoc, scanRange)
    gl.uniform1f(this.u_hueTimeLoc, 0)  // default: use u_color

    // Clear
    gl.clear(gl.COLOR_BUFFER_BIT)

    // Draw geometry — grid lines cycle through neon hues
    const segmentCount = this.segmentCount
    gl.uniform1f(this.u_hueTimeLoc, this.gridHueTime)

    // Grid: halo pass
    gl.uniform1f(this.u_alphaLoc, 0.2)
    this.drawGeometry(gl, segmentCount)

    // Grid: core pass
    gl.uniform1f(this.u_alphaLoc, 1.0)
    this.drawGeometry(gl, segmentCount)

    gl.uniform1f(this.u_hueTimeLoc, 0)  // reset

    // Solid panel fills — rainbow hue cycling, drawn before wireframe detail lines
    {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.solidPanelBuffer)
      gl.vertexAttribPointer(this.aPosLoc, 3, gl.FLOAT, false, 0, 0)
      gl.enable(gl.POLYGON_OFFSET_FILL)
      gl.polygonOffset(1.0, 1.0)
      // Floor strips: strong bass pulse + fast colour cycle
      gl.uniform1f(this.u_hueTimeLoc, this.hueTime)
      gl.uniform1f(this.u_alphaLoc, 0.06 + this.smoothedBass * 0.5 + this.beatFlash * 0.25)
      gl.drawArrays(gl.TRIANGLES, 0, this.solidFloorVertCount)
      // Wall panels: driven by mid/high frequencies — mids pulse alpha, highs accelerate hue cycling
      gl.uniform1f(this.u_hueTimeLoc, this.hueTime + 0.18 + this.smoothedHigh * 2.0)
      gl.uniform1f(this.u_alphaLoc, 0.04 + this.smoothedMid * 0.35 + this.beatFlash * 0.1)
      gl.drawArrays(gl.TRIANGLES, this.solidFloorVertCount, this.solidWallVertCount)
      gl.uniform1f(this.u_hueTimeLoc, 0)
      gl.disable(gl.POLYGON_OFFSET_FILL)
      // Restore grid color
      _colorBuf[0] = r; _colorBuf[1] = g; _colorBuf[2] = b
      gl.uniform3fv(this.u_colorLoc, _colorBuf)
    }

    // Detail panels: switch buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, this.detailBuffer)
    gl.vertexAttribPointer(this.aPosLoc, 3, gl.FLOAT, false, 0, 0)

    // Detail: halo pass (subtler than grid)
    gl.uniform1f(this.u_alphaLoc, 0.12)
    gl.drawArrays(gl.LINES, 0, this.detailVertexCount)

    // Detail: core pass
    gl.uniform1f(this.u_alphaLoc, 0.65)
    gl.drawArrays(gl.LINES, 0, this.detailVertexCount)

    // Update simulation
    this.autoShoot(isOnset, features.rms)
    this.updateTurrets(dt, isOnset, lateralOffset)
    this.updateMissiles(dt)
    this.updatePlayerProjectiles(dt)
    this.updateExplosions(dt)
    this.updateObstacles(dt, isOnset, this.smoothedRms)
    this.buildTurretVerts()

    // Draw dynamic buffer [struct | missile_c0..cN | debris | player | explode | obstacle | smoke]
    const S   = this.turretStructVertCount
    const MS  = this.missileTotalVerts
    const DB  = this.debrisVertCount
    const PL  = this.playerVertCount
    const EX  = this.explodeVertCount
    const OB  = this.obstacleVertCount
    const SM  = this.smokeVertCount
    const totalVerts = S + MS + DB + PL + EX + OB + SM
    if (totalVerts > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.turretBuffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.turretVerts.subarray(0, totalVerts * 3))
      gl.vertexAttribPointer(this.aPosLoc, 3, gl.FLOAT, false, 0, 0)

      // Turret structures + TIE fighters: grid hue cycle, double pass
      if (S > 0) {
        gl.uniform1f(this.u_hueTimeLoc, this.gridHueTime + 0.5)
        gl.uniform1f(this.u_alphaLoc, 0.15)
        gl.drawArrays(gl.LINES, 0, S)
        gl.uniform1f(this.u_alphaLoc, 0.85)
        gl.drawArrays(gl.LINES, 0, S)
        gl.uniform1f(this.u_hueTimeLoc, 0)
      }
      // Missiles: per-colour group, glow + core double pass
      let mOff = S
      for (let c = 0; c < MISSILE_COLORS.length; c++) {
        const mc = this.missileVertCounts[c]
        if (mc > 0) {
          gl.uniform3fv(this.u_colorLoc, MISSILE_COLORS[c])
          gl.uniform1f(this.u_alphaLoc, 0.35)
          gl.drawArrays(gl.LINES, mOff, mc)
          gl.uniform1f(this.u_alphaLoc, 1.0)
          gl.drawArrays(gl.LINES, mOff, mc)
        }
        mOff += mc
      }
      // Flying debris: yellow
      if (DB > 0) {
        gl.uniform3fv(this.u_colorLoc, _beamColor)
        gl.uniform1f(this.u_alphaLoc, 1.0)
        gl.drawArrays(gl.LINES, S + MS, DB)
      }
      // Player shots: green
      if (PL > 0) {
        gl.uniform3fv(this.u_colorLoc, _playerColor)
        gl.uniform1f(this.u_alphaLoc, 1.0)
        gl.drawArrays(gl.LINES, S + MS + DB, PL)
      }
      // Explosions: orange
      if (EX > 0) {
        gl.uniform3fv(this.u_colorLoc, _explodeColor)
        gl.uniform1f(this.u_alphaLoc, 1.0)
        gl.drawArrays(gl.LINES, S + MS + DB + PL, EX)
      }
      // Obstacle bars: amber
      if (OB > 0) {
        gl.uniform3fv(this.u_colorLoc, _obstacleColor)
        gl.uniform1f(this.u_alphaLoc, 0.9 + this.beatFlash * 0.1)
        gl.drawArrays(gl.LINES, S + MS + DB + PL + EX, OB)
      }
      // Smoke exhaust: glow pass + core pass
      if (SM > 0) {
        const smokeOff = S + MS + DB + PL + EX + OB
        gl.uniform3fv(this.u_colorLoc, _smokeColor)
        gl.uniform1f(this.u_alphaLoc, 0.2)
        gl.drawArrays(gl.LINES, smokeOff, SM)
        gl.uniform1f(this.u_alphaLoc, 0.65)
        gl.drawArrays(gl.LINES, smokeOff, SM)
      }
      _colorBuf[0] = r; _colorBuf[1] = g; _colorBuf[2] = b
      gl.uniform3fv(this.u_colorLoc, _colorBuf)
    }

    // Restore main buffer binding for next frame
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.vertexAttribPointer(this.aPosLoc, 3, gl.FLOAT, false, 0, 0)

    // HUD overlay
    this.drawHud(features, dt)
  }

  // -------------------------------------------------------------------------
  // Turret update + geometry
  // -------------------------------------------------------------------------

  private updateTurrets(dt: number, isOnset: boolean, cameraX: number): void {
    const rotAlpha = Math.min(1, dt * 1.8)
    for (let i = 0; i < TURRET_DEFS.length; i++) {
      const def = TURRET_DEFS[i]
      const state = this.turretStates[i]
      const worldZ = ((def.baseZ - this.zOffset) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH / 2

      // Destroyed — count down respawn
      if (state.destroyed) {
        state.respawnTimer -= dt * 1000
        if (state.respawnTimer <= 0) {
          state.destroyed = false
          state.aimAngle = Math.random() * Math.PI * 2
          state.nextShot = 800 + Math.random() * 1000
        }
        continue
      }

      // Aim continuously — turrets always track camera regardless of visibility
      let aimTarget: number
      if (def.surface === 'floor') {
        aimTarget = Math.atan2(cameraX - def.x, worldZ - (-10))
      } else {
        aimTarget = Math.atan2(0 - def.y, worldZ - (-10)) * 0.6
      }
      let diff = aimTarget - state.aimAngle
      while (diff >  Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      state.aimAngle += diff * rotAlpha

      // Shoot timing — always tick, only spawn projectiles when visible
      state.nextShot -= dt * 1000
      if (state.nextShot <= 0) {
        // Firing rate scales with energy: only fire when music is energetic enough.
        // At low energy, turrets stay menacing but idle. missileRate scales the whole interval.
        const ef = Math.min(1, this.smoothedRms / 0.15)  // higher threshold — quiet = no fire
        const baseInterval = 1800 + (1 - ef) * 4200 + Math.random() * (1000 + (1 - ef) * 3000)
        if (this.missileRate > 0 && ef > 0.25) {
          // Only show muzzle flash when actually about to fire
          state.shootTimer = 160
          state.nextShot = baseInterval / this.missileRate
        } else {
          // Turret stays armed/idle — no flash, long wait before reconsidering
          state.nextShot = baseInterval * (this.missileRate > 0 ? 1 : 5)
        }
        if (this.missileRate > 0 && ef > 0.25 && worldZ > 2 && worldZ < TUNNEL_LENGTH / 2 && this.missiles.length < 8) {
          const aim = state.aimAngle
          const sa = Math.sin(aim), ca = Math.cos(aim)
          const speed = 0.007
          // Arc offset: launch ±36° off aimed direction for visible curved flight path
          const arcSign = Math.random() < 0.5 ? 1 : -1
          const arcOff = arcSign * (Math.PI / 5)
          const colorIdx = Math.floor(Math.random() * MISSILE_COLORS.length)
          if (def.surface === 'floor') {
            const bLen = def.type === 2 ? 2.0 : 1.4
            const la = aim + arcOff
            const lsa = Math.sin(la), lca = Math.cos(la)
            this.missiles.push({ wx: def.x + sa * bLen, wy: -TRENCH_H + 0.65, wz: worldZ - ca * bLen, vx: lsa * speed, vy: 0, vz: -lca * speed, life: 3500, smokeTimer: 0, colorIdx })
          } else {
            const sign = def.surface === 'left' ? 1 : -1
            const bLen = def.type === 1 ? 1.6 : 1.4
            const la = aim + arcOff
            const lsa = Math.sin(la), lca = Math.cos(la)
            this.missiles.push({ wx: def.x + sign * bLen * 0.3, wy: def.y + sa * bLen, wz: worldZ - ca * bLen, vx: sign * speed * 0.15, vy: lsa * speed, vz: -lca * speed, life: 3500, smokeTimer: 0, colorIdx })
          }
        }
      }
      if (state.shootTimer > 0) state.shootTimer -= dt * 1000
    }

    this.updateFlying(dt, isOnset)
  }

  private updateFlying(dt: number, isOnset: boolean): void {
    // Spawn TIE fighters (max 3)
    this.tieSpawnTimer -= dt * 1000
    if (this.tieSpawnTimer <= 0) {
      const tieCount = this.flyingObjects.filter(f => f.type === 'tie').length
      if (tieCount < 3) {
        this.flyingObjects.push({
          wx: (Math.random() * 2 - 1) * TRENCH_W * 0.6,
          wy: -TRENCH_H + 0.5 + Math.random() * (TRENCH_H + TRENCH_TOP - 1.0),
          wz: TUNNEL_LENGTH / 2 - 5,
          vx: (Math.random() - 0.5) * 0.004,
          vy: (Math.random() - 0.5) * 0.003,
          vz: -(0.025 + Math.random() * 0.025),
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.6,
          scale: 0.5 + Math.random() * 0.4,
          type: 'tie',
        })
      }
      this.tieSpawnTimer = isOnset ? 600 + Math.random() * 500 : 1500 + Math.random() * 1500
    }

    // Spawn debris (max 8)
    this.debrisSpawnTimer -= dt * 1000
    if (this.debrisSpawnTimer <= 0) {
      const debrisCount = this.flyingObjects.filter(f => f.type === 'debris').length
      if (debrisCount < 8) {
        this.flyingObjects.push({
          wx: (Math.random() * 2 - 1) * TRENCH_W * 0.8,
          wy: -TRENCH_H + 0.3 + Math.random() * (TRENCH_H + TRENCH_TOP - 0.6),
          wz: TUNNEL_LENGTH / 2 - 5,
          vx: (Math.random() - 0.5) * 0.008,
          vy: (Math.random() - 0.5) * 0.006,
          vz: -(0.01 + Math.random() * 0.015),
          angle: Math.random() * Math.PI * 2,
          spin: (Math.random() > 0.5 ? 1 : -1) * (1.5 + Math.random() * 2.5),
          scale: 0.25 + Math.random() * 0.4,
          type: 'debris',
        })
      }
      this.debrisSpawnTimer = 400 + Math.random() * 800
    }

    // Advance flying objects
    for (let i = this.flyingObjects.length - 1; i >= 0; i--) {
      const f = this.flyingObjects[i]
      f.wx += f.vx * dt * 1000
      f.wy += f.vy * dt * 1000
      f.wz += f.vz * dt * 1000
      f.angle += f.spin * dt
      if (f.wz < -16) this.flyingObjects.splice(i, 1)
    }
  }

  private updateMissiles(dt: number): void {
    const dtMs = dt * 1000
    // Gentle homing turn rate: 2 rad/s — fast enough to arc visibly within ~1s
    const TURN_RATE = 2.0

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i]

      // Soft homing — aim at trench center (0,0,-10), NOT the camera's sway position.
      // This way banking the player doesn't cause missiles to lurch and follow.
      const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz)
      if (spd > 0) {
        const tx = 0 - m.wx     // toward trench x-center
        const ty = 0 - m.wy     // toward trench y-center
        const tz = -10 - m.wz   // toward camera z-plane
        const tDist = Math.sqrt(tx * tx + ty * ty + tz * tz)
        if (tDist > 0.5) {
          const tdx = tx / tDist, tdy = ty / tDist, tdz = tz / tDist
          const curDx = m.vx / spd, curDy = m.vy / spd, curDz = m.vz / spd
          const blend = Math.min(1, TURN_RATE * dt)
          m.vx = (curDx + (tdx - curDx) * blend) * spd
          m.vy = (curDy + (tdy - curDy) * blend) * spd
          m.vz = (curDz + (tdz - curDz) * blend) * spd
        }
      }

      // Speed floor — missiles must approach at least as fast as the tunnel scrolls.
      // frameScrollDelta is in world-units/frame; convert to units/ms for comparison.
      if (dt > 0) {
        const minVzMs = -Math.min(this.frameScrollDelta / (dt * 1000) * 1.15, 0.06)
        if (m.vz > minVzMs) m.vz = minVzMs
      }

      // Move
      m.wx += m.vx * dtMs
      m.wy += m.vy * dtMs
      m.wz += m.vz * dtMs
      m.life -= dtMs

      // Emit smoke cloud from tail — 3 particles per burst
      m.smokeTimer -= dtMs
      if (m.smokeTimer <= 0 && this.smokeParticles.length < 150) {
        for (let p = 0; p < 3 && this.smokeParticles.length < 150; p++) {
          const life = 500 + Math.random() * 250
          this.smokeParticles.push({
            wx: m.wx + (Math.random() - 0.5) * 0.25,
            wy: m.wy + (Math.random() - 0.5) * 0.25,
            wz: m.wz,
            vx: (Math.random() - 0.5) * 0.004,
            vy: (Math.random() - 0.5) * 0.004,
            life, maxLife: life,
          })
        }
        m.smokeTimer = 30
      }

      if (m.life <= 0 || m.wz < -14) { this.missiles.splice(i, 1); continue }

      // Hit player?
      if (m.wz < -6 && m.wz > -14) {
        const dx = m.wx - this.cameraLX, dy = m.wy - this.cameraLY
        if (dx * dx + dy * dy < 2.25) {
          this.shieldFlash = Math.min(this.shieldFlash + 0.9, 1.0)
          this.shakeAmount = 6
          this.explosions.push({ wx: m.wx, wy: m.wy, wz: m.wz, radius: 0, life: 700, maxLife: 700 })
          this.missiles.splice(i, 1)
        }
      }
    }

    // Age + drift smoke particles
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const s = this.smokeParticles[i]
      s.wx += s.vx * dtMs
      s.wy += s.vy * dtMs
      s.life -= dtMs
      if (s.life <= 0) this.smokeParticles.splice(i, 1)
    }
  }

  private autoShoot(isOnset: boolean, rms: number): void {
    const WING_SPAN  = 1.8   // units left/right of camera centre
    const SHOT_SPEED = 0.045 // units/ms — slow enough to watch travel down the trench
    const nowMs      = this.time * 1000
    // Minimum gap between shots shrinks with energy: 350ms quiet → 180ms loud
    const cooldownMs = 350 - Math.min(rms / 0.12, 1.0) * 170
    if (!isOnset) return
    if (nowMs - this.lastAutoShotTime < cooldownMs) return
    if (this.playerProjectiles.length >= 8) return

    const wx = this.cameraLX + (this.shotSide === 0 ? -WING_SPAN : WING_SPAN)
    this.playerProjectiles.push({ wx, wy: this.cameraLY - 0.3, wz: -7, vz: SHOT_SPEED, life: 4000 })
    this.shotSide = 1 - this.shotSide
    this.lastAutoShotTime = nowMs
  }

  private updatePlayerProjectiles(dt: number): void {
    const dtMs = dt * 1000
    for (let i = this.playerProjectiles.length - 1; i >= 0; i--) {
      const p = this.playerProjectiles[i]
      p.wz  += p.vz * dtMs
      p.life -= dtMs
      if (p.life <= 0 || p.wz > TUNNEL_LENGTH / 2) { this.playerProjectiles.splice(i, 1); continue }

      // Check collision with turrets
      let hit = false
      for (let j = 0; j < TURRET_DEFS.length && !hit; j++) {
        const def = TURRET_DEFS[j]
        const state = this.turretStates[j]
        if (state.destroyed) continue
        const wz = ((def.baseZ - this.zOffset) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH / 2
        const dx = p.wx - def.x, dy = p.wy - def.y, dz = p.wz - wz
        if (dx*dx + dy*dy + dz*dz < 6.25) {  // hit radius 2.5
          state.destroyed = true
          state.respawnTimer = 4000
          this.explosions.push({ wx: def.x, wy: def.y, wz, radius: 0, life: 700, maxLife: 700 })
          hit = true
        }
      }
      // Check collision with flying objects
      if (!hit) {
        for (let j = this.flyingObjects.length - 1; j >= 0 && !hit; j--) {
          const f = this.flyingObjects[j]
          const dx = p.wx - f.wx, dy = p.wy - f.wy, dz = p.wz - f.wz
          const hr = f.scale * (f.type === 'tie' ? 3.0 : 1.2)
          if (dx*dx + dy*dy + dz*dz < hr * hr) {
            this.explosions.push({ wx: f.wx, wy: f.wy, wz: f.wz, radius: 0, life: 700, maxLife: 700 })
            this.flyingObjects.splice(j, 1)
            hit = true
          }
        }
      }
      if (hit) this.playerProjectiles.splice(i, 1)
    }
  }

  private updateExplosions(dt: number): void {
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i]
      e.life -= dt * 1000
      e.radius = (1 - e.life / e.maxLife) * 4.0  // expand to 4 units
      if (e.life <= 0) this.explosions.splice(i, 1)
    }
  }

  private updateObstacles(dt: number, isOnset: boolean, rms: number): void {
    // Spawn — place obstacle at a fixed tunnel-space z far ahead, same system as turrets
    this.obstacleSpawnTimer -= dt * 1000
    if (this.obstacleSpawnTimer <= 0 && isOnset && this.obstacles.length < 6) {
      // baseZ = tunnel-space position that currently maps to worldZ ≈ TUNNEL_LENGTH/2 - 15 (far ahead)
      const baseZ = ((this.zOffset + TUNNEL_LENGTH - 15) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH
      const bassStrength = Math.min(this.smoothedBass / 0.1, 1.0)
      const barY = (Math.random() < bassStrength ? 1 : -1) * (0.8 + Math.random() * 1.2)
      this.obstacles.push({ baseZ, y: barY, halfH: 0.2 })
      this.obstacleSpawnTimer = 3000 + Math.random() * 4000 - rms * 2000
    }

    // Check hits and remove once passed — worldZ computed exactly like turrets
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i]
      const worldZ = ((obs.baseZ - this.zOffset) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH / 2
      if (worldZ < -15) { this.obstacles.splice(i, 1); continue }
      if (worldZ > -13 && worldZ < -5) {
        if (Math.abs(this.cameraLY - obs.y) < obs.halfH + 0.55) {
          this.shieldFlash = Math.min(this.shieldFlash + 0.6, 1.0)
          this.shakeAmount = Math.max(this.shakeAmount, 4)
        }
      }
    }
  }

  private buildTurretVerts(): void {
    const v = this.turretVerts
    const si = 0   // structure vertex index (reserved for future use)
    const structVerts:  number[] = []
    const missileVertGroups: number[][] = Array.from({ length: MISSILE_COLORS.length }, () => [])
    const debrisVerts:  number[] = []  // yellow — flying debris
    const playerVerts:  number[] = []
    const explodeVerts: number[] = []
    const obstVerts:    number[] = []
    const smokeVerts:   number[] = []  // warm orange — missile exhaust

    const ps = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      structVerts.push(x0, y0, z0, x1, y1, z1)
    // pm pushes into the correct per-colour group; replaced per-missile below
    const pd = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
      debrisVerts.push(x0, y0, z0, x1, y1, z1)

    // Turret structures
    for (let i = 0; i < TURRET_DEFS.length; i++) {
      const def = TURRET_DEFS[i]
      const state = this.turretStates[i]
      if (state.destroyed) continue
      const worldZ = ((def.baseZ - this.zOffset) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH / 2
      if (worldZ < -12 || worldZ > TUNNEL_LENGTH / 2) continue
      const pz = def.baseZ
      const shooting = state.shootTimer > 0
      if (def.surface === 'floor') {
        this.buildFloorTurret(ps, ps, def.x, pz, state.aimAngle, def.type, shooting, state.shootTimer)
      } else {
        const sign = def.surface === 'left' ? 1 : -1
        this.buildWallTurret(ps, ps, def.x, def.y, pz, sign, state.aimAngle, def.type, shooting, state.shootTimer)
      }
    }

    // Enemy missiles — 4-rail tube body + cross-section rings + large fins
    for (const m of this.missiles) {
      const tz = this.zOffset + m.wz + TUNNEL_LENGTH / 2
      const spd = Math.sqrt(m.vx * m.vx + m.vy * m.vy + m.vz * m.vz)
      if (spd <= 0) continue
      const mg = missileVertGroups[m.colorIdx]
      const pm = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
        mg.push(x0, y0, z0, x1, y1, z1)
      const nx = m.vx / spd, ny = m.vy / spd, nz = m.vz / spd
      const bodyLen = 3.5
      const tailX = m.wx - nx * bodyLen, tailY = m.wy - ny * bodyLen, tailTz = tz - nz * bodyLen
      const r = 0.22  // tube cross-section half-width
      // 4 long rails forming a rectangular tube (offsets in fixed XY — works for Z-dominant flight)
      pm(m.wx+r, m.wy+r, tz,  tailX+r, tailY+r, tailTz)
      pm(m.wx+r, m.wy-r, tz,  tailX+r, tailY-r, tailTz)
      pm(m.wx-r, m.wy+r, tz,  tailX-r, tailY+r, tailTz)
      pm(m.wx-r, m.wy-r, tz,  tailX-r, tailY-r, tailTz)
      // Nose ring
      pm(m.wx+r, m.wy+r, tz,  m.wx+r, m.wy-r, tz)
      pm(m.wx+r, m.wy-r, tz,  m.wx-r, m.wy-r, tz)
      pm(m.wx-r, m.wy-r, tz,  m.wx-r, m.wy+r, tz)
      pm(m.wx-r, m.wy+r, tz,  m.wx+r, m.wy+r, tz)
      // Mid ring (1/2 along body)
      const midX = (m.wx + tailX) / 2, midY = (m.wy + tailY) / 2, midTz = (tz + tailTz) / 2
      pm(midX+r, midY+r, midTz,  midX+r, midY-r, midTz)
      pm(midX+r, midY-r, midTz,  midX-r, midY-r, midTz)
      pm(midX-r, midY-r, midTz,  midX-r, midY+r, midTz)
      pm(midX-r, midY+r, midTz,  midX+r, midY+r, midTz)
      // Tail ring
      pm(tailX+r, tailY+r, tailTz,  tailX+r, tailY-r, tailTz)
      pm(tailX+r, tailY-r, tailTz,  tailX-r, tailY-r, tailTz)
      pm(tailX-r, tailY-r, tailTz,  tailX-r, tailY+r, tailTz)
      pm(tailX-r, tailY+r, tailTz,  tailX+r, tailY+r, tailTz)
      // Large swept-back fins at tail
      const fin = 0.75
      pm(tailX-fin, tailY,    tailTz,  tailX+fin, tailY,    tailTz)
      pm(tailX,     tailY-fin, tailTz,  tailX,     tailY+fin, tailTz)
      // Fin tips swept back along body
      pm(tailX-fin, tailY, tailTz,  tailX - fin*0.5 - nx, tailY - ny, tailTz - nz)
      pm(tailX+fin, tailY, tailTz,  tailX + fin*0.5 - nx, tailY - ny, tailTz - nz)
    }

    // Flying objects: TIE fighters (struct/grid) + debris (yellow)
    for (const f of this.flyingObjects) {
      const tz = this.zOffset + f.wz + TUNNEL_LENGTH / 2
      if (f.type === 'tie') {
        this.buildTieGeom(ps, f.wx, f.wy, tz, f.angle, f.scale)
      } else {
        this.buildDebrisGeom(pd, f.wx, f.wy, tz, f.angle, f.scale)
      }
    }

    // Player shots
    for (const p of this.playerProjectiles) {
      const tz     = this.zOffset + p.wz + TUNNEL_LENGTH / 2
      const tzTail = this.zOffset + (p.wz - 5.0) + TUNNEL_LENGTH / 2
      playerVerts.push(p.wx, p.wy, tz, p.wx, p.wy, tzTail)
      playerVerts.push(p.wx + 0.05, p.wy, tz, p.wx + 0.05, p.wy, tzTail)
    }

    // Explosions
    for (const e of this.explosions) {
      const tz   = this.zOffset + e.wz + TUNNEL_LENGTH / 2
      const fade = e.life / e.maxLife
      const push = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
        explodeVerts.push(x0, y0, z0, x1, y1, z1)
      this.buildExplosionRing(push, e.wx, e.wy, tz, e.radius)
      if (e.radius > 0.5) this.buildExplosionRing(push, e.wx, e.wy, tz, e.radius * 0.5 * fade)
    }

    // Obstacle bars (horizontal girders) — baseZ is tunnel-space, shader scrolls them
    for (const obs of this.obstacles) {
      const worldZ = ((obs.baseZ - this.zOffset) % TUNNEL_LENGTH + TUNNEL_LENGTH) % TUNNEL_LENGTH - TUNNEL_LENGTH / 2
      if (worldZ < -15 || worldZ > TUNNEL_LENGTH / 2) continue
      const tz   = obs.baseZ   // tunnel-space z, same as turrets
      const yBot = obs.y - obs.halfH
      const yTop = obs.y + obs.halfH
      // Two rails
      obstVerts.push(-TRENCH_W, yBot, tz,  TRENCH_W, yBot, tz)
      obstVerts.push(-TRENCH_W, yTop, tz,  TRENCH_W, yTop, tz)
      // Side posts
      obstVerts.push(-TRENCH_W, yBot, tz, -TRENCH_W, yTop, tz)
      obstVerts.push( TRENCH_W, yBot, tz,  TRENCH_W, yTop, tz)
      // Cross-struts every 2 units
      for (let x = -TRENCH_W + 2; x < TRENCH_W; x += 2) {
        obstVerts.push(x, yBot, tz,  x, yTop, tz)
      }
      // Diagonal X brace at each end
      obstVerts.push(-TRENCH_W, yBot, tz, -TRENCH_W+2, yTop, tz)
      obstVerts.push(-TRENCH_W, yTop, tz, -TRENCH_W+2, yBot, tz)
      obstVerts.push( TRENCH_W-2, yBot, tz,  TRENCH_W, yTop, tz)
      obstVerts.push( TRENCH_W-2, yTop, tz,  TRENCH_W, yBot, tz)
    }

    // Smoke exhaust — X-cross puffs that expand as they age
    for (const s of this.smokeParticles) {
      const tz = this.zOffset + s.wz + TUNNEL_LENGTH / 2
      const age = 1 - s.life / s.maxLife   // 0 = fresh, 1 = dying
      const sz = 0.07 + 0.3 * age          // grows and spreads over lifetime
      smokeVerts.push(s.wx - sz, s.wy,      tz,  s.wx + sz, s.wy,      tz)
      smokeVerts.push(s.wx,      s.wy - sz, tz,  s.wx,      s.wy + sz, tz)
      // Diagonal cross for extra density
      const sd = sz * 0.65
      smokeVerts.push(s.wx - sd, s.wy - sd, tz,  s.wx + sd, s.wy + sd, tz)
      smokeVerts.push(s.wx + sd, s.wy - sd, tz,  s.wx - sd, s.wy + sd, tz)
    }

    // Pack: [struct | missile_c0..cN | debris | player | explode | obstacle | smoke]
    this.turretStructVertCount = structVerts.length / 3
    let totalMissile = 0
    for (let c = 0; c < MISSILE_COLORS.length; c++) {
      this.missileVertCounts[c] = missileVertGroups[c].length / 3
      totalMissile += this.missileVertCounts[c]
    }
    this.missileTotalVerts  = totalMissile
    this.debrisVertCount    = debrisVerts.length  / 3
    this.playerVertCount    = playerVerts.length  / 3
    this.explodeVertCount   = explodeVerts.length / 3
    this.obstacleVertCount  = obstVerts.length    / 3
    this.smokeVertCount     = smokeVerts.length   / 3
    let idx = 0
    for (const arr of [structVerts, ...missileVertGroups, debrisVerts, playerVerts, explodeVerts, obstVerts, smokeVerts])
      for (let k = 0; k < arr.length; k++) v[idx++] = arr[k]
    void si
  }

  private buildExplosionRing(
    pe: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    cx: number, cy: number, tz: number, radius: number,
  ): void {
    const SEGS = 14
    for (let i = 0; i < SEGS; i++) {
      const a0 = (i / SEGS) * Math.PI * 2, a1 = ((i + 1) / SEGS) * Math.PI * 2
      pe(
        cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius, tz,
        cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, tz,
      )
    }
  }

  private buildFloorTurret(
    ps: (...a: number[]) => void, pb: (...a: number[]) => void,
    px: number, pz: number, aim: number, type: number, shooting: boolean, shootTimer: number,
  ): void {
    const py = -TRENCH_H
    const hw = type === 2 ? 0.55 : 0.45, hd = 0.35
    // Platform
    ps(px-hw, py, pz-hd,  px+hw, py, pz-hd)
    ps(px+hw, py, pz-hd,  px+hw, py, pz+hd)
    ps(px+hw, py, pz+hd,  px-hw, py, pz+hd)
    ps(px-hw, py, pz+hd,  px-hw, py, pz-hd)
    // Body
    const bh = type === 2 ? 1.0 : 0.65, bw = 0.27
    const my = py + bh
    ps(px-bw, py, pz-bw,  px-bw, my, pz-bw); ps(px+bw, py, pz-bw,  px+bw, my, pz-bw)
    ps(px-bw, my, pz-bw,  px+bw, my, pz-bw); ps(px-bw, my, pz-bw,  px-bw, my, pz+bw)
    ps(px+bw, my, pz-bw,  px+bw, my, pz+bw); ps(px-bw, my, pz+bw,  px+bw, my, pz+bw)
    // Barrel
    const sa = Math.sin(aim), ca = Math.cos(aim)
    const bLen = type === 2 ? 2.0 : 1.4
    const tx = px + sa * bLen, tz = pz - ca * bLen
    const px2 = ca * 0.11, pz2 = sa * 0.11  // perpendicular to barrel
    if (type === 1) {
      // Twin: two tubes offset perpendicular to aim
      const ox = ca * 0.18, oz = sa * 0.18
      ps(px+ox, my+0.08, pz+oz,  tx+ox, my+0.08, tz+oz)
      ps(px+ox, my-0.08, pz+oz,  tx+ox, my-0.08, tz+oz)
      ps(px-ox, my+0.08, pz-oz,  tx-ox, my+0.08, tz-oz)
      ps(px-ox, my-0.08, pz-oz,  tx-ox, my-0.08, tz-oz)
      ps(px+ox, my, pz+oz,  px-ox, my, pz-oz)
      ps(tx+ox, my, tz+oz,  tx-ox, my, tz-oz)
    } else {
      ps(px+px2, my+0.1, pz+pz2,  tx+px2, my+0.1, tz+pz2)
      ps(px-px2, my-0.1, pz-pz2,  tx-px2, my-0.1, tz-pz2)
      if (type === 2) ps(px, my-0.12, pz,  tx*0.45+px*0.55, my+0.08, tz*0.45+pz*0.55)
    }
    // Tip
    ps(tx-px2, my, tz-pz2,  tx+px2, my, tz+pz2)
    ps(tx, my-0.15, tz,  tx, my+0.15, tz)
    // Beam
    if (shooting) {
      const bl = 2.5 + (shootTimer / 160) * 2.5
      pb(tx, my, tz,  tx + sa * bl, my, tz - ca * bl)
    }
  }

  private buildWallTurret(
    ps: (...a: number[]) => void, pb: (...a: number[]) => void,
    wx: number, wy: number, pz: number, sign: number,
    aim: number, type: number, shooting: boolean, shootTimer: number,
  ): void {
    const bw = 0.3, bd = 0.3, bodyLen = 0.65
    const ox = wx + sign * bodyLen  // outer X
    // Wall plate
    ps(wx, wy-bw*1.3, pz-bd*1.3,  wx, wy+bw*1.3, pz-bd*1.3)
    ps(wx, wy+bw*1.3, pz-bd*1.3,  wx, wy+bw*1.3, pz+bd*1.3)
    ps(wx, wy+bw*1.3, pz+bd*1.3,  wx, wy-bw*1.3, pz+bd*1.3)
    ps(wx, wy-bw*1.3, pz+bd*1.3,  wx, wy-bw*1.3, pz-bd*1.3)
    // Body box
    ps(wx, wy-bw, pz-bd,  ox, wy-bw, pz-bd); ps(wx, wy+bw, pz-bd,  ox, wy+bw, pz-bd)
    ps(wx, wy-bw, pz+bd,  ox, wy-bw, pz+bd); ps(wx, wy+bw, pz+bd,  ox, wy+bw, pz+bd)
    ps(ox, wy-bw, pz-bd,  ox, wy+bw, pz-bd); ps(ox, wy-bw, pz-bd,  ox, wy-bw, pz+bd)
    ps(ox, wy+bw, pz-bd,  ox, wy+bw, pz+bd); ps(ox, wy-bw, pz+bd,  ox, wy+bw, pz+bd)
    // Barrel
    const sa = Math.sin(aim), ca = Math.cos(aim)
    const bLen = type === 1 ? 1.8 : 1.5
    const tipX = ox + sign * 0.15
    const tipY = wy + sa * bLen, tipZ = pz - ca * bLen
    const py2 = ca * 0.1, pz2 = sa * 0.1
    if (type === 1) {
      ps(ox, wy+0.1, pz+0.16,  tipX, tipY+0.1, tipZ+0.16)
      ps(ox, wy-0.1, pz+0.16,  tipX, tipY-0.1, tipZ+0.16)
      ps(ox, wy+0.1, pz-0.16,  tipX, tipY+0.1, tipZ-0.16)
      ps(ox, wy-0.1, pz-0.16,  tipX, tipY-0.1, tipZ-0.16)
      ps(ox, wy, pz+0.16,  ox, wy, pz-0.16)
      ps(tipX, tipY, tipZ+0.16,  tipX, tipY, tipZ-0.16)
    } else {
      ps(ox, wy+py2, pz+pz2,  tipX, tipY+py2, tipZ+pz2)
      ps(ox, wy-py2, pz-pz2,  tipX, tipY-py2, tipZ-pz2)
      if (type === 2) ps(ox, wy-0.1, pz,  tipX*0.5+ox*0.5, tipY*0.5+wy*0.5+0.08, tipZ*0.5+pz*0.5)
    }
    ps(tipX, tipY-0.14, tipZ,  tipX, tipY+0.14, tipZ)
    ps(tipX, tipY, tipZ-0.14,  tipX, tipY, tipZ+0.14)
    // Beam
    if (shooting) {
      const bl = 2.5 + (shootTimer / 160) * 2.5
      pb(tipX, tipY, tipZ,  tipX + sign*0.2, tipY + sa * bl, tipZ - ca * bl)
    }
  }

  private buildTieGeom(
    ps: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    cx: number, cy: number, tz: number, angle: number, scale: number,
  ): void {
    const c = Math.cos(angle), s = Math.sin(angle)
    const rot = (lx: number, ly: number): [number, number] =>
      [lx * c - ly * s + cx, lx * s + ly * c + cy]

    // Central pod — 8-gon
    const podR = 0.4 * scale
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2, a1 = ((i + 1) / 8) * Math.PI * 2
      const [x0, y0] = rot(Math.cos(a0) * podR, Math.sin(a0) * podR)
      const [x1, y1] = rot(Math.cos(a1) * podR, Math.sin(a1) * podR)
      ps(x0, y0, tz, x1, y1, tz)
    }

    // Hexagonal wings — one each side
    const wingX = 2.1 * scale, wingR = 0.88 * scale
    for (const wx of [-wingX, wingX]) {
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * Math.PI * 2 + Math.PI / 6
        const a1 = ((i + 1) / 6) * Math.PI * 2 + Math.PI / 6
        const [x0, y0] = rot(wx + Math.cos(a0) * wingR, Math.sin(a0) * wingR)
        const [x1, y1] = rot(wx + Math.cos(a1) * wingR, Math.sin(a1) * wingR)
        ps(x0, y0, tz, x1, y1, tz)
      }
      // Two connecting struts per wing
      const sg = wx > 0 ? 1 : -1
      const inX = sg * podR * 0.9, outX = wx - sg * wingR * 0.65, sy = 0.22 * scale
      const [ax, ay] = rot(inX,  sy); const [bx, by] = rot(outX,  sy)
      const [dx, dy] = rot(inX, -sy); const [ex, ey] = rot(outX, -sy)
      ps(ax, ay, tz, bx, by, tz)
      ps(dx, dy, tz, ex, ey, tz)
    }
  }

  private buildDebrisGeom(
    pb: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => void,
    cx: number, cy: number, tz: number, angle: number, scale: number,
  ): void {
    const c = Math.cos(angle), s = Math.sin(angle)
    const rot = (lx: number, ly: number): [number, number] =>
      [lx * c - ly * s + cx, lx * s + ly * c + cy]

    // Irregular pentagon (fixed shape — looks rocky, not symmetric)
    const vts: [number, number][] = [
      [ 0.0,  0.9], [ 0.8,  0.2], [ 0.55, -0.75], [-0.6, -0.7], [-0.75, 0.3],
    ]
    for (let i = 0; i < vts.length; i++) {
      const [ax, ay] = vts[i], [bx, by] = vts[(i + 1) % vts.length]
      const [x0, y0] = rot(ax * scale, ay * scale)
      const [x1, y1] = rot(bx * scale, by * scale)
      pb(x0, y0, tz, x1, y1, tz)
    }
    // Internal crack
    const [rx0, ry0] = rot( 0.1 * scale,  0.5 * scale)
    const [rx1, ry1] = rot(-0.2 * scale, -0.4 * scale)
    pb(rx0, ry0, tz, rx1, ry1, tz)
  }

  private buildSolidPanelGeometry(): { floor: Float32Array; wall: Float32Array } {
    const floorVerts: number[] = []
    const wallVerts:  number[] = []

    // Add a rectangle as two CCW triangles, inset 0.01 from the surface normal
    // so polygon-offset still handles any residual z-fight with coplanar wireframes.
    const wallQuad = (wx: number, y0: number, y1: number, z0: number, z1: number) => {
      const x = wx > 0 ? wx - 0.01 : wx + 0.01   // step slightly inside
      wallVerts.push(
        x, y0, z0,  x, y1, z0,  x, y1, z1,
        x, y0, z0,  x, y1, z1,  x, y0, z1,
      )
    }

    const floorQuad = (x0: number, x1: number, z0: number, z1: number) => {
      const y = -TRENCH_H + 0.01   // just above the floor wireframe
      floorVerts.push(
        x0, y, z0,  x1, y, z0,  x1, y, z1,
        x0, y, z0,  x1, y, z1,  x0, y, z1,
      )
    }

    for (let i = 0; i < DETAIL_SECTIONS; i++) {
      const zS  = (i / DETAIL_SECTIONS) * TUNNEL_LENGTH
      const zE  = ((i + 1) / DETAIL_SECTIONS) * TUNNEL_LENGTH
      // Match the inset used in buildDetailGeometry
      const zi0 = zS + 0.4 + 0.35
      const zi1 = zE - 0.4 - 0.35

      // Floor centre light strip — every section, bass-pulsing
      floorQuad(-0.9, 0.9, zi0, zi1)

      // Every other section: an extra wide floor slab on one side
      if (i % 3 === 0) {
        floorQuad(-TRENCH_W + 0.6, -1.1, zi0, zi1)
      } else if (i % 3 === 1) {
        floorQuad(1.1, TRENCH_W - 0.6, zi0, zi1)
      }

      // Wall panels — lower inset rect, alternating sides, every section
      const ly0 = -TRENCH_H + 0.6
      const ly1 = -0.5
      if (i % 2 === 0) {
        wallQuad(-TRENCH_W, ly0, ly1, zi0, zi1)
      } else {
        wallQuad( TRENCH_W, ly0, ly1, zi0, zi1)
      }

      // Upper wall accent — sparser (every 4th section, opposite side)
      if (i % 4 === 0) {
        const uy0 = 0.5
        const uy1 = TRENCH_TOP - 0.6
        wallQuad(TRENCH_W, uy0, uy1, zi0, zi1)
      } else if (i % 4 === 2) {
        const uy0 = 0.5
        const uy1 = TRENCH_TOP - 0.6
        wallQuad(-TRENCH_W, uy0, uy1, zi0, zi1)
      }
    }

    return { floor: new Float32Array(floorVerts), wall: new Float32Array(wallVerts) }
  }

  private buildDetailGeometry(): Float32Array {
    const verts: number[] = []

    const wallRect = (x: number, y0: number, y1: number, z0: number, z1: number) => {
      verts.push(x, y0, z0,  x, y1, z0)
      verts.push(x, y1, z0,  x, y1, z1)
      verts.push(x, y1, z1,  x, y0, z1)
      verts.push(x, y0, z1,  x, y0, z0)
    }

    const floorRect = (x0: number, x1: number, z0: number, z1: number) => {
      const y = -TRENCH_H
      verts.push(x0, y, z0,  x1, y, z0)
      verts.push(x1, y, z0,  x1, y, z1)
      verts.push(x1, y, z1,  x0, y, z1)
      verts.push(x0, y, z1,  x0, y, z0)
    }

    for (let i = 0; i < DETAIL_SECTIONS; i++) {
      const zS = (i / DETAIL_SECTIONS) * TUNNEL_LENGTH
      const zE = ((i + 1) / DETAIL_SECTIONS) * TUNNEL_LENGTH
      const z0 = zS + 0.4
      const z1 = zE - 0.4
      const zi0 = z0 + 0.35
      const zi1 = z1 - 0.35

      for (const wx of [-TRENCH_W, TRENCH_W]) {
        // Lower panel: y from just above floor to mid-wall
        const ly0 = -TRENCH_H + 0.3
        const ly1 = -0.2
        wallRect(wx, ly0, ly1, z0, z1)
        wallRect(wx, ly0 + 0.3, ly1 - 0.3, zi0, zi1)  // inset

        // Upper panel: y from mid-wall to near top
        const uy0 = 0.2
        const uy1 = TRENCH_TOP - 0.3
        wallRect(wx, uy0, uy1, z0, z1)
        wallRect(wx, uy0 + 0.3, uy1 - 0.3, zi0, zi1)  // inset
      }

      // Floor: outer tile spanning most of width
      floorRect(-TRENCH_W + 0.5, TRENCH_W - 0.5, z0, z1)
      // Floor: center light strip
      floorRect(-1.2, 1.2, z0, z1)
    }

    return new Float32Array(verts)
  }

  private drawGeometry(gl: WebGL2RenderingContext, N: number): void {
    gl.drawArrays(gl.LINES, 0,     N * 4)  // floor
    gl.drawArrays(gl.LINES, N * 4, N * 4)  // left wall
    gl.drawArrays(gl.LINES, N * 8, N * 4)  // right wall
  }

  /** Project a world-space point through the saved MVP to canvas pixel coordinates. */
  private projectToScreen(wx: number, wy: number, wz: number, sw: number, sh: number): [number, number] {
    const m = this.mvpCopy
    // Column-major MVP multiply: clip = MVP * [wx, wy, wz, 1]
    const cx = m[0]*wx + m[4]*wy + m[8] *wz + m[12]
    const cy = m[1]*wx + m[5]*wy + m[9] *wz + m[13]
    const cw = m[3]*wx + m[7]*wy + m[11]*wz + m[15]
    if (Math.abs(cw) < 1e-6) return [sw / 2, 0]
    return [(cx / cw + 1) * 0.5 * sw, (1 - cy / cw) * 0.5 * sh]
  }

  private drawHud(features: AudioFeatures, dt: number): void {
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

    // Sky: nebula, stars, capital ships, battle effects
    this.drawSkyEffects(ctx, w, h, dt, features)
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

    // Shield force-field — concentric rings + screen-edge glow on hit
    if (this.shieldFlash > 0.01) {
      const f = this.shieldFlash
      ctx.globalAlpha = 1.0
      // Expanding rings
      for (let ring = 0; ring < 4; ring++) {
        const radius = 35 + ring * 55 + (1 - f) * 120
        ctx.beginPath()
        ctx.arc(cx, cy, radius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(80, 200, 255, ${f * (0.9 - ring * 0.18)})`
        ctx.lineWidth = 2.5 - ring * 0.4
        ctx.stroke()
      }
      // Screen-edge cyan vignette
      const grad = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.25, cx, cy, Math.max(w, h) * 0.75)
      grad.addColorStop(0, 'rgba(0,180,255,0)')
      grad.addColorStop(1, `rgba(0,100,255,${f * 0.35})`)
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, w, h)
    }

    ctx.globalAlpha = 1.0
  }

  // -------------------------------------------------------------------------
  // Sky overlay
  // -------------------------------------------------------------------------

  private initStars(): void {
    this.stars = []
    for (let i = 0; i < 180; i++) {
      this.stars.push({
        fx:    Math.random(),
        fy:    Math.random() * 0.44,   // upper 44% of screen — sky region
        sz:    0.4 + Math.random() * 1.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.8,
      })
    }
  }

  private drawSkyEffects(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    dt: number,
    features: AudioFeatures,
  ): void {
    const dtMs = dt * 1000
    const energyFactor = Math.min(1, this.smoothedRms / 0.1)

    // ------------------------------------------------------------------
    // Sky clip — restrict all effects to the open region above wall tops.
    // Project the four wall-top corners through the saved MVP to screen
    // space, then build a convex polygon clip: screen-top → near-right →
    // far-right → far-left → near-left → screen-top.
    // ------------------------------------------------------------------
    const nearL = this.projectToScreen(-TRENCH_W, TRENCH_TOP,  0, w, h)
    const nearR = this.projectToScreen( TRENCH_W, TRENCH_TOP,  0, w, h)
    const farL  = this.projectToScreen(-TRENCH_W, TRENCH_TOP, 60, w, h)
    const farR  = this.projectToScreen( TRENCH_W, TRENCH_TOP, 60, w, h)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(0, 0)           // top-left screen corner
    ctx.lineTo(w, 0)           // top-right screen corner
    ctx.lineTo(nearR[0], nearR[1])
    ctx.lineTo(farR[0],  farR[1])
    ctx.lineTo(farL[0],  farL[1])
    ctx.lineTo(nearL[0], nearL[1])
    ctx.closePath()
    ctx.clip()

    const skyH = h * 0.44   // pixel height for legacy star y-position scaling

    // ------------------------------------------------------------------
    // Nebula (Option 4) — visible only on quiet/slow parts
    // ------------------------------------------------------------------
    this.nebulaPhase += dt * 0.04
    const nebulaAlpha = this.skyIntensity * Math.max(0, 0.30 - energyFactor * 0.30)
    if (nebulaAlpha > 0.004) {
      for (let i = 0; i < NEBULA_DEFS.length; i++) {
        const nd = NEBULA_DEFS[i]
        const cx = nd.fx * w, cy = nd.fy * h
        const rv = nd.r * Math.min(w, h) * 0.5
        const hue = (this.nebulaPhase + i * 0.30) % 1
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rv)
        grad.addColorStop(0, hsvCss(hue, 0.75, 0.55, nebulaAlpha))
        grad.addColorStop(1, hsvCss(hue, 0.9,  0.3,  0))
        ctx.fillStyle = grad
        ctx.fillRect(cx - rv, cy - rv, rv * 2, rv * 2)
      }
    }

    // ------------------------------------------------------------------
    // Stars (Option 1) — always present
    // ------------------------------------------------------------------
    for (const s of this.stars) {
      const twinkle = this.skyIntensity * (0.22 + 0.22 * Math.sin(this.time * s.speed + s.phase))
      if (twinkle < 0.005) continue
      ctx.beginPath()
      ctx.arc(s.fx * w, s.fy * skyH, s.sz, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(200,220,255,${twinkle.toFixed(3)})`
      ctx.fill()
    }

    // ------------------------------------------------------------------
    // Capital ships (Option 2) — occasional, slow drift
    // ------------------------------------------------------------------
    this.capitalSpawnTimer -= dtMs
    if (this.capitalSpawnTimer <= 0 && this.capitalShips.length < 2) {
      const fromLeft = Math.random() < 0.5
      this.capitalShips.push({
        fx:   fromLeft ? -0.15 : 1.15,
        fy:   0.05 + Math.random() * 0.30,
        vfx:  (fromLeft ? 1 : -1) * (0.006 + Math.random() * 0.005) / 1000,  // frac/ms
        scale: 50 + Math.random() * 55,
        type: Math.floor(Math.random() * SHIP_OUTLINES.length),
      })
      this.capitalSpawnTimer = 20000 + Math.random() * 20000
    }
    for (let i = this.capitalShips.length - 1; i >= 0; i--) {
      const cs = this.capitalShips[i]
      cs.fx += cs.vfx * dtMs
      if (cs.fx < -0.25 || cs.fx > 1.25) { this.capitalShips.splice(i, 1); continue }
      const cx = cs.fx * w, cy = cs.fy * h
      const outline = SHIP_OUTLINES[cs.type]
      ctx.beginPath()
      ctx.moveTo(cx + outline[0][0] * cs.scale, cy + outline[0][1] * cs.scale)
      for (let j = 1; j < outline.length; j++) {
        ctx.lineTo(cx + outline[j][0] * cs.scale, cy + outline[j][1] * cs.scale)
      }
      ctx.closePath()
      ctx.strokeStyle = `rgba(160,200,255,${(0.22 * this.skyIntensity).toFixed(3)})`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // ------------------------------------------------------------------
    // Battle effects (Option 3) — spawned on strong bass onsets
    // ------------------------------------------------------------------
    if (features.isOnset && this.smoothedBass > 0.05 && this.battleFlashes.length < 6 && Math.random() < this.battleIntensity) {
      const mc = MISSILE_COLORS[Math.floor(Math.random() * MISSILE_COLORS.length)]
      const rgb = `${Math.round(mc[0]*255)},${Math.round(mc[1]*255)},${Math.round(mc[2]*255)}`
      const life = 500 + Math.random() * 400
      this.battleFlashes.push({
        fx: 0.08 + Math.random() * 0.84,
        fy: 0.01 + Math.random() * 0.34,
        radius: 0,
        maxRadius: (25 + Math.random() * 55) * (w / 1920),
        life, maxLife: life, rgb,
      })
      // Paired laser crossfire (65% chance)
      if (Math.random() < 0.65 && this.battleLasers.length < 8) {
        const laserLife = 180 + Math.random() * 200
        this.battleLasers.push({
          fx0: Math.random(), fy0: Math.random() * 0.38,
          fx1: Math.random(), fy1: Math.random() * 0.38,
          life: laserLife, maxLife: laserLife, rgb,
        })
      }
    }
    // Update + draw flashes
    for (let i = this.battleFlashes.length - 1; i >= 0; i--) {
      const bf = this.battleFlashes[i]
      bf.life -= dtMs
      if (bf.life <= 0) { this.battleFlashes.splice(i, 1); continue }
      const t = 1 - bf.life / bf.maxLife
      bf.radius = bf.maxRadius * t
      const a = (1 - t) * 0.88 * this.battleIntensity
      ctx.beginPath()
      ctx.arc(bf.fx * w, bf.fy * h, bf.radius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${bf.rgb},${a.toFixed(3)})`
      ctx.lineWidth = 1.5
      ctx.stroke()
      if (t < 0.5) {
        ctx.beginPath()
        ctx.arc(bf.fx * w, bf.fy * h, bf.radius * 0.3, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${bf.rgb},${Math.min(1, a * 1.6).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
    // Update + draw lasers
    for (let i = this.battleLasers.length - 1; i >= 0; i--) {
      const bl = this.battleLasers[i]
      bl.life -= dtMs
      if (bl.life <= 0) { this.battleLasers.splice(i, 1); continue }
      const a = (bl.life / bl.maxLife) * 0.75 * this.battleIntensity
      ctx.beginPath()
      ctx.moveTo(bl.fx0 * w, bl.fy0 * h)
      ctx.lineTo(bl.fx1 * w, bl.fy1 * h)
      ctx.strokeStyle = `rgba(${bl.rgb},${a.toFixed(3)})`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Restore clip region (removes sky clip path)
    ctx.restore()
  }

  resize(w: number, h: number): void {
    this.gl.viewport(0, 0, w, h)
    this.overlay.width = w
    this.overlay.height = h
    this.scanlineCanvas = buildScanlineCanvas(w, h)
    this.initStars()
  }

  destroy(): void {
    const { gl, program, buffer, detailBuffer, solidPanelBuffer, turretBuffer } = this
    gl.deleteProgram(program)
    gl.deleteBuffer(buffer)
    gl.deleteBuffer(detailBuffer)
    gl.deleteBuffer(solidPanelBuffer)
    gl.deleteBuffer(turretBuffer)
    this.overlay.parentElement?.removeChild(this.overlay)
  }
}
