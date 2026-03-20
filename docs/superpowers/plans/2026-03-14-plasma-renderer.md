# Plasma Renderer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `plasma` visualizer type that renders an emotionally-responsive full-screen WebGL2 plasma field driven by audio features.

**Architecture:** A `PlasmaRenderer` class implements the existing `BaseRenderer` interface using `canvas.getContext('webgl2')`. A single-pass GLSL fragment shader computes a domain-warped sinusoidal plasma field coloured by a cosine palette driven by `valence`/`tension`/`warmth`. Beat-reactive shock wave rings are accumulated in JS state and passed as shader uniforms.

**Tech Stack:** WebGL2, GLSL ES 1.00 (precision highp), TypeScript, Zod, React, Jest + jsdom + jest-canvas-mock

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/validations/preset.ts` | Modify | Add `plasmaConfigSchema` and `PlasmaConfig` type; add to `presetConfigSchema` union |
| `lib/validations/__tests__/preset.test.ts` | Modify | Add tests for plasma config validation |
| `components/controls/TypeBar.tsx` | Modify | Add `'plasma'` to `TYPES` and `buildConfigForType` |
| `components/visualizer/VisualizerCanvas.tsx` | Modify | Add `plasma` case to `buildRenderer`; wrap renderer construction in try/catch; import `PlasmaConfig` |
| `components/visualizer/renderers/PlasmaRenderer.ts` | Create | Full renderer: shaders, WebGL init, render loop, shock waves, palette interpolation |
| `components/visualizer/renderers/__tests__/PlasmaRenderer.test.ts` | Create | Unit tests using mocked WebGL2 context |

---

## Chunk 1: Schema, TypeBar, and VisualizerCanvas wiring

### Task 1: Add plasma preset schema

**Files:**
- Modify: `lib/validations/preset.ts`
- Modify: `lib/validations/__tests__/preset.test.ts`

- [ ] **Step 1: Write failing tests for plasma config**

Add to `lib/validations/__tests__/preset.test.ts`, inside the `describe('presetConfigSchema', ...)` block:

```typescript
it('accepts valid plasma config', () => {
  const result = presetConfigSchema.safeParse({
    type: 'plasma',
    colorScheme: 'neon-dark',
    sensitivity: 1.0,
    fftSize: 2048,
  })
  expect(result.success).toBe(true)
})

it('rejects plasma config with invalid colorScheme', () => {
  const result = presetConfigSchema.safeParse({
    type: 'plasma',
    colorScheme: 'rainbow',
    sensitivity: 1.0,
    fftSize: 2048,
  })
  expect(result.success).toBe(false)
})
```

- [ ] **Step 2: Run tests to confirm failure**

```bash
npx jest lib/validations/__tests__/preset.test.ts --no-coverage
```

Expected: the two new tests fail with "Invalid discriminator value".

- [ ] **Step 3: Add plasmaConfigSchema to preset.ts**

In `lib/validations/preset.ts`, after `chordsConfigSchema`:

```typescript
export const plasmaConfigSchema = baseConfigSchema.extend({
  type: z.literal('plasma'),
})
export type PlasmaConfig = z.infer<typeof plasmaConfigSchema>
```

Update `presetConfigSchema` to include `plasmaConfigSchema`:

```typescript
export const presetConfigSchema = z.discriminatedUnion('type', [
  barsConfigSchema,
  waveformConfigSchema,
  spectrumConfigSchema,
  featuresConfigSchema,
  chordsConfigSchema,
  plasmaConfigSchema,   // add this line
])
```

Update the `PresetConfig` type (it's derived via `z.infer` so it updates automatically — no manual change needed).

- [ ] **Step 4: Run tests to confirm passing**

```bash
npx jest lib/validations/__tests__/preset.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/preset.ts lib/validations/__tests__/preset.test.ts
git commit -m "feat: add plasma preset schema"
```

---

### Task 2: Add plasma to TypeBar

**Files:**
- Modify: `components/controls/TypeBar.tsx`

No dedicated test file exists for TypeBar — this is UI-only wiring.

- [ ] **Step 1: Update TYPES array**

In `components/controls/TypeBar.tsx`, change:

```typescript
const TYPES = ['bars', 'waveform', 'spectrum', 'features', 'chords'] as const
```

to:

```typescript
const TYPES = ['bars', 'waveform', 'spectrum', 'features', 'chords', 'plasma'] as const
```

- [ ] **Step 2: Add plasma case to buildConfigForType**

In `buildConfigForType`, add a plasma case before the final `// bars` fallthrough. The full function after the change:

```typescript
export function buildConfigForType(type: VisualizerType, current: PresetConfig): PresetConfig {
  const base = { colorScheme: current.colorScheme, sensitivity: current.sensitivity }
  if (type === 'waveform') return { ...base, type: 'waveform', fftSize: current.fftSize }
  if (type === 'spectrum') {
    const fftSize = current.fftSize < 4096 ? 4096 : current.fftSize
    return { ...base, type: 'spectrum', fftSize } as PresetConfig
  }
  if (type === 'features' || type === 'chords') {
    const fftSize = current.fftSize < 2048 ? 2048 : current.fftSize
    return { ...base, type, fftSize } as PresetConfig
  }
  if (type === 'plasma') {
    // plasma has no fftSize minimum — pass through unchanged
    return { ...base, type: 'plasma', fftSize: current.fftSize } as PresetConfig
  }
  // bars
  return { ...base, type: 'bars', fftSize: current.fftSize, barCount: 64, mirrorBars: true }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/controls/TypeBar.tsx
git commit -m "feat: add plasma type to TypeBar"
```

---

### Task 3: Wire plasma into VisualizerCanvas

**Files:**
- Modify: `components/visualizer/VisualizerCanvas.tsx`

- [ ] **Step 1: Add PlasmaConfig to import**

Find the existing import at the top of `VisualizerCanvas.tsx`:

```typescript
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig } from '@/lib/validations/preset'
```

Change it to:

```typescript
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig, PlasmaConfig } from '@/lib/validations/preset'
```

- [ ] **Step 2: Add PlasmaRenderer import**

After the existing renderer imports, add:

```typescript
import { PlasmaRenderer } from './renderers/PlasmaRenderer'
```

- [ ] **Step 3: Add plasma case to buildRenderer**

Find the `buildRenderer` function:

```typescript
const buildRenderer = useCallback((canvas: HTMLCanvasElement, cfg: PresetConfig): BaseRenderer => {
  if (cfg.type === 'bars') return new BarsRenderer(canvas, cfg)
  if (cfg.type === 'spectrum') return new SpectrumRenderer(canvas, cfg as SpectrumConfig)
  if (cfg.type === 'features') return new FeaturesRenderer(canvas, cfg as FeaturesConfig)
  if (cfg.type === 'chords') return new ChordsRenderer(canvas, cfg as ChordsConfig)
  return new WaveformRenderer(canvas, cfg)
}, [])
```

Add the plasma case before the final `return`:

```typescript
const buildRenderer = useCallback((canvas: HTMLCanvasElement, cfg: PresetConfig): BaseRenderer => {
  if (cfg.type === 'bars') return new BarsRenderer(canvas, cfg)
  if (cfg.type === 'spectrum') return new SpectrumRenderer(canvas, cfg as SpectrumConfig)
  if (cfg.type === 'features') return new FeaturesRenderer(canvas, cfg as FeaturesConfig)
  if (cfg.type === 'chords') return new ChordsRenderer(canvas, cfg as ChordsConfig)
  if (cfg.type === 'plasma') return new PlasmaRenderer(canvas, cfg as PlasmaConfig)
  return new WaveformRenderer(canvas, cfg)
}, [])
```

- [ ] **Step 4: Wrap renderer construction in handleStart try/catch**

Find the `handleStart` function:

```typescript
async function handleStart() {
  const canvas = canvasRef.current
  if (!canvas) return
  try {
    const engine = new AudioEngine(config)
    await engine.start()
    engineRef.current = engine
    rendererRef.current = buildRenderer(canvas, config)
    setStarted(true)
  } catch {
    setMicError('Microphone access denied. Please allow mic access and refresh.')
  }
}
```

Replace the catch block to differentiate WebGL2 failures:

```typescript
async function handleStart() {
  const canvas = canvasRef.current
  if (!canvas) return
  try {
    const engine = new AudioEngine(config)
    await engine.start()
    engineRef.current = engine
    rendererRef.current = buildRenderer(canvas, config)
    setStarted(true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setMicError(
      msg.includes('WebGL2')
        ? 'WebGL2 is not supported in this browser. Try Chrome or Firefox.'
        : 'Microphone access denied. Please allow mic access and refresh.'
    )
  }
}
```

- [ ] **Step 5: Wrap renderer construction in the config-change useEffect**

Find the `useEffect` that rebuilds the renderer when config changes (around line 61-67):

```typescript
useEffect(() => {
  if (!started || !canvasRef.current) return
  const canvas = canvasRef.current
  rendererRef.current?.destroy()
  rendererRef.current = buildRenderer(canvas, config)
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [config.type, config.colorScheme, barCount, mirrorBars, started, buildRenderer])
```

Wrap the renderer construction in a try/catch:

```typescript
useEffect(() => {
  if (!started || !canvasRef.current) return
  const canvas = canvasRef.current
  rendererRef.current?.destroy()
  try {
    rendererRef.current = buildRenderer(canvas, config)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setMicError(
      msg.includes('WebGL2')
        ? 'WebGL2 is not supported in this browser. Try Chrome or Firefox.'
        : `Failed to build renderer: ${msg}`
    )
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [config.type, config.colorScheme, barCount, mirrorBars, started, buildRenderer])
```

- [ ] **Step 6: Verify TypeScript reports only the expected error**

```bash
npx tsc --noEmit
```

Expected: TypeScript reports an error for the missing `PlasmaRenderer` module (since it doesn't exist yet). This is the correct state at the end of Chunk 1. Any other errors are real problems to fix before continuing.

- [ ] **Step 7: Commit**

```bash
git add components/visualizer/VisualizerCanvas.tsx
git commit -m "feat: wire plasma renderer into VisualizerCanvas with WebGL2 error handling"
```

---

## Chunk 2: PlasmaRenderer — tests and implementation

### Task 4: Write PlasmaRenderer tests

**Files:**
- Create: `components/visualizer/renderers/__tests__/PlasmaRenderer.test.ts`

The jsdom test environment does not provide a real WebGL2 context, so we mock `canvas.getContext` to return a stub object that satisfies all calls `PlasmaRenderer` makes.

- [ ] **Step 1: Create the test file**

Create `components/visualizer/renderers/__tests__/PlasmaRenderer.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to confirm they fail (PlasmaRenderer doesn't exist yet)**

```bash
npx jest PlasmaRenderer --no-coverage
```

Expected: all tests fail with "Cannot find module '../PlasmaRenderer'".

---

### Task 5: Implement PlasmaRenderer

**Files:**
- Create: `components/visualizer/renderers/PlasmaRenderer.ts`

- [ ] **Step 1: Create the file with shader sources and helpers**

Create `components/visualizer/renderers/PlasmaRenderer.ts`:

```typescript
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
    float beatPulse = pow(1.0 - u_beatPhase, 2.0) * u_rms * 0.3;
    float brightness = 0.2 + u_rms * 0.8 + beatPulse;
    colour *= brightness * u_signalPresence;

    // Step 7: high-frequency shimmer
    float sparkle = fract(sin(dot(v_uv * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
    colour += vec3(sparkle) * u_highBand * 0.15;

    // Step 8: chord change flash (desaturate toward luminance)
    float lum = dot(colour, vec3(0.299, 0.587, 0.114));
    colour = mix(colour, vec3(lum), u_chromaNovelty * 0.4);

    gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
  }
`

// ---------------------------------------------------------------------------
// Palette constants (warm = high valence, cool = low valence)
// ---------------------------------------------------------------------------

type Vec3 = [number, number, number]

const WARM_PALETTE = {
  a: [0.5, 0.4, 0.3] as Vec3,
  b: [0.5, 0.4, 0.3] as Vec3,
  c: [1.0, 1.0, 1.0] as Vec3,
  d: [0.0, 0.1, 0.2] as Vec3,
}

const COOL_PALETTE = {
  a: [0.3, 0.3, 0.5] as Vec3,
  b: [0.3, 0.3, 0.4] as Vec3,
  c: [1.0, 1.0, 1.0] as Vec3,
  d: [0.5, 0.6, 0.7] as Vec3,
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
  private uSwCount: WebGLUniformLocation
  private uSwOrigin: WebGLUniformLocation
  private uSwAge: WebGLUniformLocation
  private uSwStrength: WebGLUniformLocation

  constructor(canvas: HTMLCanvasElement, _config: PlasmaConfig) {
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
    this.uSwCount          = ul('u_swCount')
    this.uSwOrigin         = ul('u_swOrigin[0]')
    this.uSwAge            = ul('u_swAge[0]')
    this.uSwStrength       = ul('u_swStrength[0]')

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

    // Interpolate palette from cool (valence=0) to warm (valence=1)
    const v = features.valence
    const pa = lerp3(COOL_PALETTE.a, WARM_PALETTE.a, v)
    const pb = lerp3(COOL_PALETTE.b, WARM_PALETTE.b, v)
    const pc = lerp3(COOL_PALETTE.c, WARM_PALETTE.c, v)
    const pd = lerp3(COOL_PALETTE.d, WARM_PALETTE.d, v)
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
    gl.uniform1i(this.uSwCount, this.shockwaves.length)

    // Pack shock wave arrays
    const origins   = new Float32Array(16)
    const ages      = new Float32Array(8)
    const strengths = new Float32Array(8)
    this.shockwaves.forEach((sw, i) => {
      origins[i * 2]     = sw.x
      origins[i * 2 + 1] = sw.y
      ages[i]            = sw.age
      strengths[i]       = sw.strength
    })
    gl.uniform2fv(this.uSwOrigin,   origins)
    gl.uniform1fv(this.uSwAge,      ages)
    gl.uniform1fv(this.uSwStrength, strengths)

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
    ;(gl.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext()
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npx jest PlasmaRenderer --no-coverage
```

Expected: all 7 tests pass.

- [ ] **Step 3: Run full test suite to check no regressions**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/visualizer/renderers/PlasmaRenderer.ts components/visualizer/renderers/__tests__/PlasmaRenderer.test.ts
git commit -m "feat: implement PlasmaRenderer with WebGL2 plasma field and shock waves"
```

---

## Smoke Test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open http://localhost:3000, click to start, select "plasma" in the TypeBar**

Expected:
- The TypeBar shows a `[6] plasma` button
- Selecting it switches to the plasma renderer
- Audio from the microphone produces a full-screen animated plasma field
- Colour shifts between warm and cool as the music's mood changes
- Beats produce expanding ring effects
- Silence fades the display to black

- [ ] **Step 3: Verify in Chrome DevTools console — no errors**

Expected: no WebGL errors, no uncaught exceptions.

- [ ] **Step 4: Final commit**

```bash
git add components/visualizer/renderers/PlasmaRenderer.ts \
        components/visualizer/renderers/__tests__/PlasmaRenderer.test.ts \
        components/visualizer/VisualizerCanvas.tsx \
        components/controls/TypeBar.tsx \
        lib/validations/preset.ts \
        lib/validations/__tests__/preset.test.ts
git commit -m "chore: plasma renderer smoke tested and complete"
```
