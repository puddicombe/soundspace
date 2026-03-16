# TrenchRunRenderer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `trenchRun` visualiser type — a first-person neon wireframe tunnel with a Star Wars/Tron HUD overlay, fully audio-reactive and preset-configurable.

**Architecture:** A `TrenchRunRenderer` class owns two rendering surfaces: a WebGL2 canvas for the 3D wireframe cylinder (rings, rails, floor), and a Canvas 2D overlay it injects into the DOM for the HUD chrome. All audio-reactive math is extracted as pure exported functions for unit testing. The renderer follows the same lifecycle pattern as `PlasmaRenderer`.

**Tech Stack:** TypeScript, WebGL2 (GLSL ES 3.00), Canvas 2D API, Zod (schema), React (settings panel wiring), Jest (tests)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/validations/preset.ts` | Modify | Add `trenchRunConfigSchema`, `TrenchRunConfig`, add to union |
| `lib/validations/__tests__/preset.test.ts` | Modify | Tests for trenchRun schema + buildConfigForType |
| `components/controls/TypeBar.tsx` | Modify | Add `'trenchRun'` to TYPES, add buildConfigForType branch |
| `components/controls/ControlPanel.tsx` | Modify | Add `isTrenchRun` sliders block |
| `components/visualizer/renderers/TrenchRunRenderer.ts` | Create | Full renderer: shaders, geometry, pure math, HUD |
| `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts` | Create | Unit tests: constructor, lifecycle, render, pure functions |
| `components/visualizer/VisualizerCanvas.tsx` | Modify | Wire trenchRun: buildRenderer, visibility, effects |

---

## Chunk 1: Preset schema + TypeBar + ControlPanel

### Task 1: Add trenchRun to preset schema

**Files:**
- Modify: `lib/validations/preset.ts`

- [ ] **Step 1: Add schema and type**

In `lib/validations/preset.ts`, after the `plasmaConfigSchema` block, add:

```ts
export const trenchRunConfigSchema = baseConfigSchema.extend({
  type: z.literal('trenchRun'),
  scrollSpeed:   z.number().min(0.5).max(2.0).default(1.0),
  bankIntensity: z.number().min(0.0).max(1.0).default(0.6),
  warpIntensity: z.number().min(0.0).max(1.0).default(0.5),
  gridDensity:   z.number().int().min(8).max(32).default(16),
  hudOpacity:    z.number().min(0.0).max(1.0).default(0.9),
})
```

Add `trenchRunConfigSchema` to the `presetConfigSchema` discriminated union:

```ts
export const presetConfigSchema = z.discriminatedUnion('type', [
  barsConfigSchema,
  waveformConfigSchema,
  spectrumConfigSchema,
  featuresConfigSchema,
  chordsConfigSchema,
  plasmaConfigSchema,
  trenchRunConfigSchema,   // add this line
])
```

At the bottom of the types block, add:

```ts
export type TrenchRunConfig = z.infer<typeof trenchRunConfigSchema>
```

- [ ] **Step 2: Write schema tests**

In `lib/validations/__tests__/preset.test.ts`, add a `describe('trenchRunConfigSchema')` block:

```ts
describe('trenchRunConfigSchema', () => {
  const base = {
    type: 'trenchRun' as const,
    colorScheme: 'neon-dark' as const,
    sensitivity: 1.0,
    fftSize: 2048 as const,
    scrollSpeed: 1.0,
    bankIntensity: 0.6,
    warpIntensity: 0.5,
    gridDensity: 16,
    hudOpacity: 0.9,
  }

  it('accepts valid trenchRun config', () => {
    expect(() => trenchRunConfigSchema.parse(base)).not.toThrow()
  })

  it('rejects scrollSpeed below 0.5', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, scrollSpeed: 0.1 })).toThrow()
  })

  it('rejects gridDensity above 32', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, gridDensity: 64 })).toThrow()
  })

  it('rejects non-integer gridDensity', () => {
    expect(() => trenchRunConfigSchema.parse({ ...base, gridDensity: 16.5 })).toThrow()
  })
})
```

Also add to the imports at the top of the test file:
```ts
import { trenchRunConfigSchema } from '../preset'
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npx jest lib/validations/__tests__/preset.test.ts --no-coverage
```

Expected: all tests pass (schema exists and validates correctly).

- [ ] **Step 4: Commit**

```bash
git add lib/validations/preset.ts lib/validations/__tests__/preset.test.ts
git commit -m "feat: add trenchRunConfigSchema to preset validation"
```

---

### Task 2: Add trenchRun to TypeBar

**Files:**
- Modify: `components/controls/TypeBar.tsx`

- [ ] **Step 1: Add to TYPES array and buildConfigForType**

In `TypeBar.tsx`, change the `TYPES` constant:

```ts
const TYPES = ['bars', 'waveform', 'spectrum', 'features', 'chords', 'plasma', 'trenchRun'] as const
```

Add the `TrenchRunConfig` import at the top of the file:

```ts
import type { PresetConfig, TrenchRunConfig } from '@/lib/validations/preset'
```

In `buildConfigForType`, add a branch **before** the `// bars` fallback comment:

```ts
if (type === 'trenchRun') {
  const scrollSpeed   = current.type === 'trenchRun' ? (current as TrenchRunConfig).scrollSpeed   : 1.0
  const bankIntensity = current.type === 'trenchRun' ? (current as TrenchRunConfig).bankIntensity : 0.6
  const warpIntensity = current.type === 'trenchRun' ? (current as TrenchRunConfig).warpIntensity : 0.5
  const gridDensity   = current.type === 'trenchRun' ? (current as TrenchRunConfig).gridDensity   : 16
  const hudOpacity    = current.type === 'trenchRun' ? (current as TrenchRunConfig).hudOpacity    : 0.9
  return { ...base, type: 'trenchRun', fftSize: current.fftSize,
           scrollSpeed, bankIntensity, warpIntensity, gridDensity, hudOpacity } as PresetConfig
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. If TypeScript complains about `VisualizerType` narrowing gaps in `ControlPanel.tsx` or `page.tsx`, they'll be resolved in the next step.

- [ ] **Step 3: Commit**

```bash
git add components/controls/TypeBar.tsx
git commit -m "feat: add trenchRun type to TypeBar"
```

---

### Task 3: Add trenchRun controls to ControlPanel

**Files:**
- Modify: `components/controls/ControlPanel.tsx`

- [ ] **Step 1: Add imports and isTrenchRun block**

At the top of `ControlPanel.tsx`, add to the import:

```ts
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig, PlasmaConfig, TrenchRunConfig } from '@/lib/validations/preset'
```

In the component, alongside `const isBars` and `const isPlasma`, add:

```ts
const isTrenchRun  = config.type === 'trenchRun'
const trenchConfig = config as TrenchRunConfig
```

Also update the `ALL_TYPES` array to include `'trenchRun'`:

```ts
const ALL_TYPES: VisualizerType[] = ['bars', 'waveform', 'spectrum', 'features', 'chords', 'plasma', 'trenchRun']
```

After the `{/* Plasma controls */}` block, add:

```tsx
{/* TrenchRun controls */}
{isTrenchRun && (
  <>
    <div className="flex flex-col gap-2">
      <label className="text-gray-400 text-xs uppercase tracking-wider">
        Scroll speed: {trenchConfig.scrollSpeed.toFixed(1)}×
      </label>
      <input
        type="range" min={0.5} max={2.0} step={0.1}
        value={trenchConfig.scrollSpeed}
        onChange={(e) => onConfigChange({ ...trenchConfig, scrollSpeed: parseFloat(e.target.value) })}
        className="w-full accent-cyan-500"
      />
    </div>

    <div className="flex flex-col gap-2">
      <label className="text-gray-400 text-xs uppercase tracking-wider">
        Bank intensity: {Math.round(trenchConfig.bankIntensity * 100)}%
      </label>
      <input
        type="range" min={0} max={1} step={0.05}
        value={trenchConfig.bankIntensity}
        onChange={(e) => onConfigChange({ ...trenchConfig, bankIntensity: parseFloat(e.target.value) })}
        className="w-full accent-cyan-500"
      />
    </div>

    <div className="flex flex-col gap-2">
      <label className="text-gray-400 text-xs uppercase tracking-wider">
        Warp intensity: {Math.round(trenchConfig.warpIntensity * 100)}%
      </label>
      <input
        type="range" min={0} max={1} step={0.05}
        value={trenchConfig.warpIntensity}
        onChange={(e) => onConfigChange({ ...trenchConfig, warpIntensity: parseFloat(e.target.value) })}
        className="w-full accent-cyan-500"
      />
    </div>

    <div className="flex flex-col gap-2">
      <label className="text-gray-400 text-xs uppercase tracking-wider">
        Grid density: {trenchConfig.gridDensity}
      </label>
      <input
        type="range" min={8} max={32} step={4}
        value={trenchConfig.gridDensity}
        onChange={(e) => onConfigChange({ ...trenchConfig, gridDensity: parseInt(e.target.value) })}
        className="w-full accent-cyan-500"
      />
    </div>

    <div className="flex flex-col gap-2">
      <label className="text-gray-400 text-xs uppercase tracking-wider">
        HUD opacity: {Math.round(trenchConfig.hudOpacity * 100)}%
      </label>
      <input
        type="range" min={0} max={1} step={0.05}
        value={trenchConfig.hudOpacity}
        onChange={(e) => onConfigChange({ ...trenchConfig, hudOpacity: parseFloat(e.target.value) })}
        className="w-full accent-cyan-500"
      />
    </div>
  </>
)}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/controls/ControlPanel.tsx
git commit -m "feat: add trenchRun settings to ControlPanel"
```

---

## Chunk 2: Pure math functions (TDD)

### Task 4: Write failing tests for pure functions

**Files:**
- Create: `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts`

- [ ] **Step 1: Create test file with pure function tests**

Create `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts`:

```ts
/**
 * TrenchRunRenderer tests
 *
 * Pure function tests run without WebGL — they import named exports directly.
 * WebGL tests use a stub context following PlasmaRenderer.test.ts patterns.
 */
import {
  computeScrollDelta,
  computeBankAngle,
  computeWarpAmount,
  computeReticleRadius,
} from '../TrenchRunRenderer'

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('computeScrollDelta', () => {
  it('returns base scroll contribution when no onset', () => {
    // (30 + 0.5 * 90) * 1.0 * 0.016 = 75 * 0.016 = 1.2
    const result = computeScrollDelta(0.5, false, 1.0, 0.016)
    expect(result).toBeCloseTo(1.2, 5)
  })

  it('adds flat snap of 8 units on onset frame', () => {
    // 1.2 base + 8.0 snap = 9.2
    const result = computeScrollDelta(0.5, true, 1.0, 0.016)
    expect(result).toBeCloseTo(9.2, 5)
  })

  it('scales with scrollSpeed multiplier', () => {
    const single = computeScrollDelta(0.5, false, 1.0, 0.016)
    const double = computeScrollDelta(0.5, false, 2.0, 0.016)
    expect(double).toBeCloseTo(single * 2, 5)
  })

  it('returns 0 when rms is 0 and dt is 0', () => {
    // (30 + 0) * 1.0 * 0 = 0, no snap
    expect(computeScrollDelta(0, false, 1.0, 0)).toBeCloseTo(0, 5)
  })
})

describe('computeBankAngle', () => {
  it('returns 0 at time=0 (sin(0) = 0)', () => {
    expect(computeBankAngle(1.0, 0, 1.0)).toBeCloseTo(0, 5)
  })

  it('returns ~0.436 rad at quarter period with full rms and full bankIntensity', () => {
    // time = 1 / (0.15 * 4) → sin(π/2) = 1.0 → 25° in rad = 0.4363
    const quarterPeriod = 1 / (0.15 * 4)
    const result = computeBankAngle(1.0, quarterPeriod, 1.0)
    expect(result).toBeCloseTo(25 * Math.PI / 180, 3)
  })

  it('scales with bankIntensity', () => {
    const quarterPeriod = 1 / (0.15 * 4)
    const full = computeBankAngle(1.0, quarterPeriod, 1.0)
    const half = computeBankAngle(1.0, quarterPeriod, 0.5)
    expect(half).toBeCloseTo(full * 0.5, 5)
  })

  it('scales with smoothedRms', () => {
    const quarterPeriod = 1 / (0.15 * 4)
    const full = computeBankAngle(1.0, quarterPeriod, 1.0)
    const half = computeBankAngle(0.5, quarterPeriod, 1.0)
    expect(half).toBeCloseTo(full * 0.5, 5)
  })
})

describe('computeWarpAmount', () => {
  it('returns 0 when buildupIntensity is below threshold (0.6)', () => {
    expect(computeWarpAmount(0.0, 1.0)).toBe(0)
    expect(computeWarpAmount(0.5, 1.0)).toBe(0)
    expect(computeWarpAmount(0.6, 1.0)).toBe(0)
  })

  it('returns correct value above threshold', () => {
    // (0.8 - 0.6) / 0.4 = 0.5 → 0.4 * 0.5 = 0.2
    expect(computeWarpAmount(0.8, 1.0)).toBeCloseTo(0.2, 5)
  })

  it('returns warpIntensity * 0.4 at max buildupIntensity', () => {
    expect(computeWarpAmount(1.0, 1.0)).toBeCloseTo(0.4, 5)
    expect(computeWarpAmount(1.0, 0.5)).toBeCloseTo(0.2, 5)
  })
})

describe('computeReticleRadius', () => {
  it('returns 1.0 when beatFlash is 0', () => {
    expect(computeReticleRadius(0)).toBe(1.0)
  })

  it('returns 1.3 when beatFlash is 1', () => {
    expect(computeReticleRadius(1.0)).toBeCloseTo(1.3, 5)
  })

  it('interpolates linearly', () => {
    expect(computeReticleRadius(0.5)).toBeCloseTo(1.15, 5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest TrenchRunRenderer.test.ts --no-coverage
```

Expected: FAIL — module `TrenchRunRenderer` not found.

- [ ] **Step 3: Create the renderer file with pure functions only**

Create `components/visualizer/renderers/TrenchRunRenderer.ts` with just the pure functions (the rest will be added in later tasks):

```ts
import type { BaseRenderer } from './BaseRenderer'
import type { TrenchRunConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

// ---------------------------------------------------------------------------
// Pure audio-reactive math (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Compute the zOffset delta for one frame.
 * @param smoothedRms  Already-smoothed RMS (0–1)
 * @param isOnset      True on the single onset frame
 * @param scrollSpeed  User's scroll speed multiplier (0.5–2.0)
 * @param dt           Frame delta time in seconds
 */
export function computeScrollDelta(
  smoothedRms: number,
  isOnset: boolean,
  scrollSpeed: number,
  dt: number,
): number {
  const baseSpeed = (30 + smoothedRms * 90) * scrollSpeed
  return baseSpeed * dt + (isOnset ? 8.0 : 0.0)
}

/**
 * Compute the camera bank angle in radians.
 * @param smoothedRms   Already-smoothed RMS (0–1)
 * @param time          Wall-clock elapsed seconds since construction
 * @param bankIntensity User's bank intensity (0–1)
 */
export function computeBankAngle(
  smoothedRms: number,
  time: number,
  bankIntensity: number,
): number {
  return (
    Math.sin(time * 0.15 * 2 * Math.PI) *
    smoothedRms *
    bankIntensity *
    (25 * Math.PI / 180)
  )
}

/**
 * Compute barrel distortion amount.
 * @param buildupIntensity  0–1 pre-drop signal (from AudioFeatures)
 * @param warpIntensity     User's warp intensity (0–1)
 */
export function computeWarpAmount(buildupIntensity: number, warpIntensity: number): number {
  if (buildupIntensity <= 0.6) return 0
  return warpIntensity * 0.4 * ((buildupIntensity - 0.6) / 0.4)
}

/**
 * Compute the targeting reticle outer ring radius multiplier.
 * @param beatFlash  0–1 decay value, 1.0 on onset
 */
export function computeReticleRadius(beatFlash: number): number {
  return 1.0 + beatFlash * 0.3
}

// ---------------------------------------------------------------------------
// Placeholder — full implementation added in later tasks
// ---------------------------------------------------------------------------

export class TrenchRunRenderer implements BaseRenderer {
  constructor(_canvas: HTMLCanvasElement, _config: TrenchRunConfig) {
    throw new Error('TrenchRunRenderer: not yet implemented')
  }
  render(_fft: Float32Array, _wave: Float32Array, _features: AudioFeatures): void {}
  resize(_width: number, _height: number): void {}
  destroy(): void {}
}
```

- [ ] **Step 4: Run tests to verify pure function tests pass**

```bash
npx jest TrenchRunRenderer.test.ts --no-coverage
```

Expected: The four `describe` blocks for pure functions PASS. Constructor tests don't exist yet.

- [ ] **Step 5: Commit**

```bash
git add components/visualizer/renderers/TrenchRunRenderer.ts \
        components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts
git commit -m "test: add TrenchRunRenderer pure function tests (TDD)"
```

---

## Chunk 3: WebGL constructor, geometry, and lifecycle

### Task 5: Write failing constructor and lifecycle tests

**Files:**
- Modify: `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts`

- [ ] **Step 1: Add GL stub and constructor tests**

At the top of the test file, after the existing imports, add:

```ts
import { TrenchRunRenderer } from '../TrenchRunRenderer'
import { NULL_FEATURES } from '../../AudioFeatures'
import type { TrenchRunConfig } from '@/lib/validations/preset'

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
    uniform3f: jest.fn(),
    uniform3fv: jest.fn(),
    uniform2fv: jest.fn(),
    uniform1fv: jest.fn(),
    uniformMatrix4fv: jest.fn(),
    deleteProgram: jest.fn(),
    deleteBuffer: jest.fn(),
    getExtension: jest.fn().mockReturnValue(null),
    enable: jest.fn(),
    blendFunc: jest.fn(),
  }
}

function makeCanvas(
  gl: ReturnType<typeof makeGlStub> | null = makeGlStub(),
  mountInDom = true,
) {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  jest.spyOn(canvas, 'getContext').mockImplementation((id: string) => {
    if (id === 'webgl2') return gl as unknown as WebGL2RenderingContext
    if (id === '2d') return document.createElement('canvas').getContext('2d')
    return null
  })
  if (mountInDom) {
    const wrapper = document.createElement('div')
    wrapper.style.position = 'relative'
    wrapper.appendChild(canvas)
    document.body.appendChild(wrapper)
  }
  return canvas
}
```

Then add a `describe('TrenchRunRenderer')` block after the pure function describes:

```ts
describe('TrenchRunRenderer', () => {
  afterEach(() => {
    // Clean up DOM after each test
    document.body.innerHTML = ''
  })

  describe('constructor', () => {
    it('constructs without throwing when WebGL2 is available', () => {
      const canvas = makeCanvas()
      expect(() => new TrenchRunRenderer(canvas, defaultConfig)).not.toThrow()
    })

    it('throws with descriptive message when WebGL2 is unavailable', () => {
      const canvas = makeCanvas(null)
      expect(() => new TrenchRunRenderer(canvas, defaultConfig)).toThrow('WebGL2 not supported')
    })

    it('throws when canvas is not mounted in the DOM', () => {
      const canvas = makeCanvas(makeGlStub(), false)
      expect(() => new TrenchRunRenderer(canvas, defaultConfig)).toThrow('canvas must be mounted')
    })

    it('injects overlay canvas as sibling with pointer-events:none', () => {
      const canvas = makeCanvas()
      new TrenchRunRenderer(canvas, defaultConfig)
      const siblings = Array.from(canvas.parentElement!.children)
      expect(siblings.length).toBe(2) // original canvas + overlay
      const overlay = siblings[1] as HTMLCanvasElement
      expect(overlay.tagName).toBe('CANVAS')
      expect(overlay.style.pointerEvents).toBe('none')
    })

    it('initialises public properties from config', () => {
      const canvas = makeCanvas()
      const config: TrenchRunConfig = { ...defaultConfig, scrollSpeed: 1.5, bankIntensity: 0.3, hudOpacity: 0.4 }
      const r = new TrenchRunRenderer(canvas, config)
      expect(r.scrollSpeed).toBe(1.5)
      expect(r.bankIntensity).toBe(0.3)
      expect(r.hudOpacity).toBe(0.4)
    })
  })

  describe('lifecycle', () => {
    it('resize() updates WebGL viewport', () => {
      const gl = makeGlStub()
      const canvas = makeCanvas(gl)
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      r.resize(1920, 1080)
      expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1920, 1080)
    })

    it('resize() updates overlay canvas dimensions', () => {
      const canvas = makeCanvas()
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      r.resize(1920, 1080)
      const overlay = canvas.parentElement!.children[1] as HTMLCanvasElement
      expect(overlay.width).toBe(1920)
      expect(overlay.height).toBe(1080)
    })

    it('destroy() removes overlay canvas from DOM', () => {
      const canvas = makeCanvas()
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      const parent = canvas.parentElement!
      expect(parent.children.length).toBe(2)
      r.destroy()
      expect(parent.children.length).toBe(1)
      expect(parent.contains(canvas)).toBe(true)
    })

    it('can be rebuilt on the same canvas after destroy (no loseContext)', () => {
      let contextLost = false
      const gl = makeGlStub()
      gl.getExtension.mockImplementation((name: string) => {
        if (name === 'WEBGL_lose_context') return { loseContext: () => { contextLost = true } }
        return null
      })
      const canvas = document.createElement('canvas')
      canvas.width = 800; canvas.height = 600
      jest.spyOn(canvas, 'getContext').mockImplementation((id: string) => {
        if (id === 'webgl2') return contextLost ? null : gl as unknown as WebGL2RenderingContext
        if (id === '2d') return document.createElement('canvas').getContext('2d')
        return null
      })
      const wrapper = document.createElement('div')
      wrapper.appendChild(canvas)
      document.body.appendChild(wrapper)

      const r1 = new TrenchRunRenderer(canvas, defaultConfig)
      r1.destroy()
      expect(() => new TrenchRunRenderer(canvas, defaultConfig)).not.toThrow()
    })
  })

  describe('render', () => {
    it('render() with NULL_FEATURES completes without throwing', () => {
      const canvas = makeCanvas()
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      const fft = new Float32Array(2048)
      const wave = new Float32Array(2048)
      expect(() => r.render(fft, wave, { ...NULL_FEATURES })).not.toThrow()
    })

    it('render() with full features completes without throwing', () => {
      const canvas = makeCanvas()
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      const fft = new Float32Array(2048)
      const wave = new Float32Array(2048)
      expect(() => r.render(fft, wave, {
        ...NULL_FEATURES,
        rms: 0.7,
        isOnset: true,
        buildupIntensity: 0.8,
        bandEnergy: [0.1, 0.6, 0.3, 0.2],
        spectralCentroid: 3000,
        bpm: 120,
      })).not.toThrow()
    })

    it('calls gl.drawArrays on render', () => {
      const gl = makeGlStub()
      const canvas = makeCanvas(gl)
      const r = new TrenchRunRenderer(canvas, defaultConfig)
      const fft = new Float32Array(2048)
      const wave = new Float32Array(2048)
      r.render(fft, wave, { ...NULL_FEATURES })
      expect(gl.drawArrays).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify new tests fail**

```bash
npx jest TrenchRunRenderer.test.ts --no-coverage
```

Expected: Pure function tests still PASS. All `TrenchRunRenderer` describe tests FAIL (constructor throws "not yet implemented").

- [ ] **Step 3: Commit the test file**

```bash
git add components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts
git commit -m "test: add TrenchRunRenderer constructor/lifecycle/render tests (red)"
```

---

### Task 6: Implement TrenchRunRenderer (WebGL core)

**Files:**
- Modify: `components/visualizer/renderers/TrenchRunRenderer.ts`

- [ ] **Step 1: Replace the placeholder with the full implementation**

Replace the entire contents of `TrenchRunRenderer.ts` with:

```ts
import type { BaseRenderer } from './BaseRenderer'
import type { TrenchRunConfig } from '@/lib/validations/preset'
import type { AudioFeatures } from '../AudioFeatures'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RING_COUNT = 32
const TUNNEL_LENGTH = 80.0
const TUNNEL_RADIUS = 5.0
const FLOOR_Y = -5.0

// ---------------------------------------------------------------------------
// Shaders — WebGL2 GLSL ES 3.00
// (Intentional departure from PlasmaRenderer's WebGL1 dialect)
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SRC = `#version 300 es
in vec3 a_position;
out float v_depth;

uniform mat4 u_mvp;
uniform float u_zOffset;
uniform float u_bassBreath;
uniform float u_warpAmount;

const float TUNNEL_LENGTH = 80.0;

void main() {
  vec3 pos = a_position;
  // Seamless scroll: wrap z positions modulo tunnel length
  pos.z = mod(pos.z + u_zOffset, TUNNEL_LENGTH) - TUNNEL_LENGTH * 0.5;
  // Bass breath: scale ring radius
  pos.xy *= 1.0 + u_bassBreath * 0.08;
  // Perspective projection
  gl_Position = u_mvp * vec4(pos, 1.0);
  // Stylistic barrel warp in clip space (intentional approximation —
  // distortion is stronger for distant geometry, which is the desired
  // visual result for a drop-arrival warp burst)
  float r2 = dot(gl_Position.xy, gl_Position.xy);
  gl_Position.xy *= 1.0 + u_warpAmount * r2;
  // Forward depth for fragment fade (0 = nearest ring)
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

void main() {
  float depthFade = 1.0 / (1.0 + v_depth * v_depth * 0.001); // 0->1.0, 40->0.38
  float brightness = 1.0 + u_beatFlash * 0.5;
  fragColor = vec4(u_color * brightness, u_alpha * depthFade);
}
`

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

type RGB = [number, number, number]

interface TrenchPalette { grid: RGB; hud: RGB }

const PALETTES: Record<string, TrenchPalette> = {
  'neon-dark': { grid: [0.000, 0.898, 1.000], hud: [1.000, 0.702, 0.000] },
  'ocean':     { grid: [0.000, 0.314, 1.000], hud: [0.000, 1.000, 0.533] },
  'mono':      { grid: [0.224, 1.000, 0.078], hud: [1.000, 1.000, 1.000] },
  'sunset':    { grid: [1.000, 0.271, 0.000], hud: [1.000, 1.000, 1.000] },
}

// ---------------------------------------------------------------------------
// Pure audio-reactive math (exported for unit testing)
// ---------------------------------------------------------------------------

export function computeScrollDelta(
  smoothedRms: number,
  isOnset: boolean,
  scrollSpeed: number,
  dt: number,
): number {
  const baseSpeed = (30 + smoothedRms * 90) * scrollSpeed
  return baseSpeed * dt + (isOnset ? 8.0 : 0.0)
}

export function computeBankAngle(
  smoothedRms: number,
  time: number,
  bankIntensity: number,
): number {
  return Math.sin(time * 0.15 * 2 * Math.PI) * smoothedRms * bankIntensity * (25 * Math.PI / 180)
}

export function computeWarpAmount(buildupIntensity: number, warpIntensity: number): number {
  if (buildupIntensity <= 0.6) return 0
  return warpIntensity * 0.4 * ((buildupIntensity - 0.6) / 0.4)
}

export function computeReticleRadius(beatFlash: number): number {
  return 1.0 + beatFlash * 0.3
}

// ---------------------------------------------------------------------------
// mat4 utilities (column-major Float32Array for gl.uniformMatrix4fv)
// ---------------------------------------------------------------------------

type V3 = [number, number, number]

function v3sub(a: V3, b: V3): V3 { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]] }
function v3cross(a: V3, b: V3): V3 {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]
}
function v3dot(a: V3, b: V3): number { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }
function v3norm(a: V3): V3 {
  const l = Math.sqrt(v3dot(a, a))
  return l > 0 ? [a[0]/l, a[1]/l, a[2]/l] : [0, 0, 0]
}

function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Float32Array {
  const f  = 1.0 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  const m  = new Float32Array(16)
  m[0]  = f / aspect
  m[5]  = f
  m[10] = (far + near) * nf
  m[11] = -1
  m[14] = 2 * far * near * nf
  return m
}

function mat4LookAt(eye: V3, center: V3, up: V3): Float32Array {
  const f = v3norm(v3sub(center, eye))
  const s = v3norm(v3cross(f, up))
  const u = v3cross(s, f)
  const m = new Float32Array(16)
  m[0]=s[0];  m[4]=s[1];  m[8]=s[2];   m[12]=-v3dot(s, eye)
  m[1]=u[0];  m[5]=u[1];  m[9]=u[2];   m[13]=-v3dot(u, eye)
  m[2]=-f[0]; m[6]=-f[1]; m[10]=-f[2]; m[14]=v3dot(f, eye)
  m[15]=1
  return m
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const r = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += a[k*4+i] * b[j*4+k]
      r[j*4+i] = s
    }
  }
  return r
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

interface GeometryResult {
  buffer: Float32Array
  railOffset: number
  floorOffset: number
  floorVertexCount: number
}

function buildTunnelGeometry(segmentCount: number): GeometryResult {
  const floorCols      = Math.floor(segmentCount / 2)
  const ringVerts      = RING_COUNT * segmentCount
  const railVerts      = segmentCount * 2
  const floorVerts     = (floorCols + 8) * 2
  const buf            = new Float32Array((ringVerts + railVerts + floorVerts) * 3)
  let i = 0

  // Rings: RING_COUNT × segmentCount vertices around circumference
  for (let r = 0; r < RING_COUNT; r++) {
    const z = (r / RING_COUNT) * TUNNEL_LENGTH
    for (let s = 0; s < segmentCount; s++) {
      const angle = (s / segmentCount) * Math.PI * 2
      buf[i++] = Math.cos(angle) * TUNNEL_RADIUS
      buf[i++] = Math.sin(angle) * TUNNEL_RADIUS
      buf[i++] = z
    }
  }

  // Rails: segmentCount near/far pairs
  for (let s = 0; s < segmentCount; s++) {
    const angle = (s / segmentCount) * Math.PI * 2
    const x = Math.cos(angle) * TUNNEL_RADIUS
    const y = Math.sin(angle) * TUNNEL_RADIUS
    buf[i++] = x; buf[i++] = y; buf[i++] = 0
    buf[i++] = x; buf[i++] = y; buf[i++] = TUNNEL_LENGTH
  }

  // Floor forward lines (parallel to Z, at even X intervals)
  for (let c = 0; c < floorCols; c++) {
    const x = floorCols > 1
      ? -TUNNEL_RADIUS + (c / (floorCols - 1)) * TUNNEL_RADIUS * 2
      : 0
    buf[i++] = x; buf[i++] = FLOOR_Y; buf[i++] = 0
    buf[i++] = x; buf[i++] = FLOOR_Y; buf[i++] = TUNNEL_LENGTH
  }

  // Floor cross-lines (8 horizontal lines at even Z depths)
  for (let cr = 0; cr < 8; cr++) {
    const z = ((cr + 1) / 9) * TUNNEL_LENGTH
    buf[i++] = -TUNNEL_RADIUS; buf[i++] = FLOOR_Y; buf[i++] = z
    buf[i++] =  TUNNEL_RADIUS; buf[i++] = FLOOR_Y; buf[i++] = z
  }

  return {
    buffer: buf,
    railOffset:       RING_COUNT * segmentCount,
    floorOffset:      RING_COUNT * segmentCount + segmentCount * 2,
    floorVertexCount: (floorCols + 8) * 2,
  }
}

// ---------------------------------------------------------------------------
// Shader compiler helper (same pattern as PlasmaRenderer)
// ---------------------------------------------------------------------------

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type)!
  gl.shaderSource(shader, src)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`TrenchRun shader compile error: ${log}`)
  }
  return shader
}

// ---------------------------------------------------------------------------
// Scanline pre-bake
// ---------------------------------------------------------------------------

function buildScanlineCanvas(w: number, h: number): OffscreenCanvas {
  const c   = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = 'rgba(0,0,0,0.08)'
  for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 2)
  return c
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export class TrenchRunRenderer implements BaseRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private vbo: WebGLBuffer
  private segmentCount: number
  private railOffset: number
  private floorOffset: number
  private floorVertexCount: number

  // Cached uniform locations
  private uMvp:        WebGLUniformLocation
  private uZOffset:    WebGLUniformLocation
  private uBassBreath: WebGLUniformLocation
  private uWarpAmount: WebGLUniformLocation
  private uBeatFlash:  WebGLUniformLocation
  private uColor:      WebGLUniformLocation
  private uAlpha:      WebGLUniformLocation

  // Perspective matrix (recomputed on resize)
  private perspective = new Float32Array(16)
  private aspectRatio = 1

  // CPU-side frame state
  private zOffset       = 0
  private beatFlash     = 0
  private smoothedRms   = 0
  private smoothedBass  = 0
  private time          = 0
  private lastTimestamp = 0
  private tgtLockTimer  = 0
  private sweepY        = 0

  // Public in-place config properties (set without rebuild)
  scrollSpeed:   number
  bankIntensity: number
  warpIntensity: number
  hudOpacity:    number

  // HUD overlay
  private overlay:       HTMLCanvasElement
  private ctx:           CanvasRenderingContext2D
  private scanlineCanvas: OffscreenCanvas
  private palette:       TrenchPalette

  constructor(canvas: HTMLCanvasElement, config: TrenchRunConfig) {
    const parent = canvas.parentElement
    if (!parent) throw new Error('TrenchRunRenderer: canvas must be mounted in the DOM before construction')

    const gl = canvas.getContext('webgl2')
    if (!gl) throw new Error('WebGL2 not supported in this browser.')
    this.gl = gl

    this.segmentCount  = config.gridDensity
    this.scrollSpeed   = config.scrollSpeed
    this.bankIntensity = config.bankIntensity
    this.warpIntensity = config.warpIntensity
    this.hudOpacity    = config.hudOpacity
    this.palette       = PALETTES[config.colorScheme] ?? PALETTES['neon-dark']
    this.aspectRatio   = canvas.width / canvas.height

    // Compile + link shaders
    const vert    = compileShader(gl, gl.VERTEX_SHADER,   VERTEX_SHADER_SRC)
    const frag    = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SRC)
    const program = gl.createProgram()!
    gl.attachShader(program, vert)
    gl.attachShader(program, frag)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`TrenchRun program link error: ${gl.getProgramInfoLog(program)}`)
    }
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    this.program = program
    gl.useProgram(program)

    // Upload geometry
    const { buffer, railOffset, floorOffset, floorVertexCount } = buildTunnelGeometry(this.segmentCount)
    this.railOffset       = railOffset
    this.floorOffset      = floorOffset
    this.floorVertexCount = floorVertexCount

    const vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, buffer, gl.STATIC_DRAW)
    this.vbo = vbo

    const aPos = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0)

    // Cache uniform locations
    const ul = (name: string) => gl.getUniformLocation(program, name)!
    this.uMvp        = ul('u_mvp')
    this.uZOffset    = ul('u_zOffset')
    this.uBassBreath = ul('u_bassBreath')
    this.uWarpAmount = ul('u_warpAmount')
    this.uBeatFlash  = ul('u_beatFlash')
    this.uColor      = ul('u_color')
    this.uAlpha      = ul('u_alpha')

    // Initial perspective
    this.perspective = mat4Perspective(60 * Math.PI / 180, this.aspectRatio, 0.1, 200.0)

    gl.clearColor(0, 0, 0, 1)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
    gl.viewport(0, 0, canvas.width, canvas.height)

    // Create and inject HUD overlay canvas
    const overlay = document.createElement('canvas')
    overlay.width  = canvas.width
    overlay.height = canvas.height
    overlay.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:10'
    parent.appendChild(overlay)
    this.overlay = overlay
    this.ctx     = overlay.getContext('2d')!

    // Pre-bake scanlines
    this.scanlineCanvas = buildScanlineCanvas(canvas.width, canvas.height)
  }

  render(_fft: Float32Array, _wave: Float32Array, features: AudioFeatures): void {
    const { gl } = this

    // Frame timing
    const now = performance.now()
    const dt  = this.lastTimestamp === 0 ? 0 : (now - this.lastTimestamp) * 0.001
    this.lastTimestamp = now
    this.time += dt

    // Exponential moving average smoothing (τ = 150ms)
    const alpha       = dt > 0 ? dt / (0.15 + dt) : 0
    this.smoothedRms  += alpha * (features.rms           - this.smoothedRms)
    this.smoothedBass += alpha * (features.bandEnergy[1] - this.smoothedBass)

    // Beat flash and HUD state
    if (features.isOnset) {
      this.beatFlash    = 1.0
      this.tgtLockTimer = 0.4
      this.sweepY       = 0
    }
    this.beatFlash    *= Math.exp(-dt / 0.06)  // τ ≈ 60ms
    this.tgtLockTimer  = Math.max(0, this.tgtLockTimer - dt)

    // Scroll
    this.zOffset += computeScrollDelta(this.smoothedRms, features.isOnset, this.scrollSpeed, dt)

    // Compute MVP
    const bankAngle  = computeBankAngle(this.smoothedRms, this.time, this.bankIntensity)
    const warpAmount = computeWarpAmount(features.buildupIntensity, this.warpIntensity)
    const upX        = Math.sin(bankAngle)
    const upY        = Math.cos(bankAngle)
    const view       = mat4LookAt([0, 0, -10], [0, 0, 0], [upX, upY, 0])
    const mvp        = mat4Multiply(this.perspective, view)

    // Compute grid colour with spectralCentroid tint
    const centroidN = Math.min(features.spectralCentroid / 8000, 1.0)
    let [gr, gg, gb] = this.palette.grid
    if (centroidN < 0.4) {
      const t = (0.4 - centroidN) / 0.4
      gr = gr * (1 - t * 0.2)
      gg = gg * (1 - t * 0.2)
      gb = Math.min(1, gb + t * 0.2)
    } else if (centroidN > 0.6) {
      const t = (centroidN - 0.6) / 0.4
      gr = Math.min(1, gr + t * 0.2)
      gg = Math.min(1, gg + t * 0.2)
      gb = Math.min(1, gb + t * 0.2)
    }

    // Upload uniforms
    gl.uniformMatrix4fv(this.uMvp, false, mvp)
    gl.uniform1f(this.uZOffset,    this.zOffset % TUNNEL_LENGTH)
    gl.uniform1f(this.uBassBreath, this.smoothedBass)
    gl.uniform1f(this.uWarpAmount, warpAmount)
    gl.uniform1f(this.uBeatFlash,  this.beatFlash)
    gl.uniform3f(this.uColor,      gr, gg, gb)

    gl.clear(gl.COLOR_BUFFER_BIT)

    // Draw geometry (called twice — halo + core)
    const drawAll = () => {
      for (let i = 0; i < RING_COUNT; i++) {
        gl.drawArrays(gl.LINE_LOOP, i * this.segmentCount, this.segmentCount)
      }
      gl.drawArrays(gl.LINES, this.railOffset,  this.segmentCount * 2)
      gl.drawArrays(gl.LINES, this.floorOffset, this.floorVertexCount)
    }

    // Halo pass (20% alpha — glow halo)
    gl.uniform1f(this.uAlpha, 0.2)
    drawAll()

    // Core pass (100% alpha — sharp line)
    gl.uniform1f(this.uAlpha, 1.0)
    drawAll()

    // HUD overlay
    this.drawHUD(features, dt)
  }

  private drawHUD(features: AudioFeatures, dt: number): void {
    const { ctx, overlay } = this
    const w = overlay.width
    const h = overlay.height
    const [hr, hg, hb] = this.palette.hud
    const hudColor = `rgb(${Math.round(hr*255)},${Math.round(hg*255)},${Math.round(hb*255)})`

    ctx.globalAlpha = this.hudOpacity
    ctx.clearRect(0, 0, w, h)

    // Scanlines (pre-baked single blit)
    ctx.drawImage(this.scanlineCanvas as unknown as CanvasImageSource, 0, 0)

    ctx.strokeStyle = hudColor
    ctx.fillStyle   = hudColor
    ctx.lineWidth   = 1

    // --- Corner brackets ---
    const arm = Math.max(20, Math.min(40, w * 0.04))
    const pad = 16
    ctx.beginPath()
    ctx.moveTo(pad, pad + arm);         ctx.lineTo(pad, pad);         ctx.lineTo(pad + arm, pad)
    ctx.moveTo(w-pad-arm, pad);         ctx.lineTo(w-pad, pad);       ctx.lineTo(w-pad, pad+arm)
    ctx.moveTo(pad, h-pad-arm);         ctx.lineTo(pad, h-pad);       ctx.lineTo(pad+arm, h-pad)
    ctx.moveTo(w-pad-arm, h-pad);       ctx.lineTo(w-pad, h-pad);     ctx.lineTo(w-pad, h-pad-arm)
    ctx.stroke()

    // --- Targeting reticle ---
    const cx        = w / 2
    const cy        = h / 2
    const baseR     = Math.min(w, h) * 0.12
    const outerR    = baseR * computeReticleRadius(this.beatFlash)
    const midR      = baseR * 0.65
    const innerR    = baseR * 0.3
    const crossLen  = baseR * 1.4

    ctx.beginPath()
    ctx.arc(cx, cy, outerR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, midR, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, innerR, 0, Math.PI * 2)
    ctx.stroke()

    // Crosshairs
    ctx.beginPath()
    ctx.moveTo(cx - crossLen, cy); ctx.lineTo(cx - outerR, cy)
    ctx.moveTo(cx + outerR, cy);   ctx.lineTo(cx + crossLen, cy)
    ctx.moveTo(cx, cy - crossLen); ctx.lineTo(cx, cy - outerR)
    ctx.moveTo(cx, cy + outerR);   ctx.lineTo(cx, cy + crossLen)
    ctx.stroke()

    // Inner dot — pulses with rms
    ctx.globalAlpha = this.hudOpacity * (0.3 + this.smoothedRms * 0.7)
    ctx.beginPath()
    ctx.arc(cx, cy, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = this.hudOpacity

    // --- Data readouts ---
    ctx.font      = '11px "Courier New", monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign    = 'left'

    const bpmStr = features.bpm !== null ? `BPM: ${Math.round(features.bpm)}` : 'BPM: ---'
    const rmsStr = `RMS: ${features.rms.toFixed(2)}`
    const velStr = `VEL: ${this.scrollSpeed.toFixed(1)}\u00d7`
    const tgtStr = this.tgtLockTimer > 0 ? 'TGT: LOCK' : 'TGT: SCAN'

    ctx.fillText(bpmStr, pad + arm + 8, pad)

    ctx.textAlign = 'right'
    ctx.fillText(rmsStr, w - pad - arm - 8, pad)

    ctx.textBaseline = 'bottom'
    ctx.textAlign    = 'left'
    ctx.fillText(velStr, pad + arm + 8, h - pad)

    ctx.textAlign = 'right'
    ctx.fillText(tgtStr, w - pad - arm - 8, h - pad)

    // Reset
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'top'

    // --- Radar sweep line ---
    this.sweepY += dt * (h / 2)       // completes one sweep in ~2 seconds
    if (this.sweepY > h) this.sweepY = h
    const sweepAlpha = 1.0 - this.sweepY / h
    ctx.globalAlpha = this.hudOpacity * sweepAlpha * 0.6
    ctx.beginPath()
    ctx.moveTo(0, this.sweepY)
    ctx.lineTo(w, this.sweepY)
    ctx.stroke()

    ctx.globalAlpha = 1
  }

  resize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height)
    this.aspectRatio = width / height
    this.perspective = mat4Perspective(60 * Math.PI / 180, this.aspectRatio, 0.1, 200.0)

    this.overlay.width  = width
    this.overlay.height = height

    // Rebuild scanlines at new dimensions (must resize canvas BEFORE redrawing)
    this.scanlineCanvas = buildScanlineCanvas(width, height)
  }

  destroy(): void {
    const { gl, program, vbo } = this
    gl.deleteProgram(program)
    gl.deleteBuffer(vbo)
    // Do NOT call loseContext() — it permanently invalidates the canvas's
    // WebGL context, preventing rebuilding a new renderer on the same canvas.
    this.overlay.parentElement?.removeChild(this.overlay)
  }
}
```

- [ ] **Step 2: Run tests**

```bash
npx jest TrenchRunRenderer.test.ts --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 3: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add components/visualizer/renderers/TrenchRunRenderer.ts \
        components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts
git commit -m "feat: implement TrenchRunRenderer with WebGL2 tunnel and HUD overlay"
```

---

## Chunk 4: VisualizerCanvas wiring

### Task 7: Wire TrenchRunRenderer into VisualizerCanvas

**Files:**
- Modify: `components/visualizer/VisualizerCanvas.tsx`

- [ ] **Step 1: Add import**

At the top of `VisualizerCanvas.tsx`, add alongside the other renderer imports:

```ts
import { TrenchRunRenderer } from './renderers/TrenchRunRenderer'
```

Also add `TrenchRunConfig` to the preset imports:

```ts
import type { PresetConfig, BarsConfig, SpectrumConfig, FeaturesConfig, ChordsConfig, PlasmaConfig, TrenchRunConfig } from '@/lib/validations/preset'
```

- [ ] **Step 2: Add buildRenderer case**

In `buildRenderer`, add the case before the final `WaveformRenderer` fallback:

```ts
if (cfg.type === 'trenchRun') return new TrenchRunRenderer(glCanvas, cfg as TrenchRunConfig)
```

- [ ] **Step 3: Fix canvas visibility**

Replace the two canvas JSX lines in the return statement:

```tsx
// Before:
<canvas ref={canvasRef}   className="absolute inset-0" style={{ display: config.type === 'plasma' ? 'none' : 'block' }} />
<canvas ref={glCanvasRef} className="absolute inset-0" style={{ display: config.type === 'plasma' ? 'block' : 'none' }} />

// After:
<canvas ref={canvasRef}   className="absolute inset-0" style={{ display: usesGl ? 'none' : 'block' }} />
<canvas ref={glCanvasRef} className="absolute inset-0" style={{ display: usesGl ? 'block' : 'none' }} />
```

And just above the return, add (near the other config-derived constants like `barCount`):

```ts
const usesGl = config.type === 'plasma' || config.type === 'trenchRun'
```

- [ ] **Step 4: Add in-place config update effect**

Add this `useEffect` **before** the existing rebuild `useEffect` (React runs effects in declaration order — the in-place effect must fire before the rebuild effect):

```ts
// Update TrenchRun slider values in-place — no rebuild needed
// (gridDensity changes go through the rebuild effect below)
useEffect(() => {
  if (config.type !== 'trenchRun') return
  const r = rendererRef.current as TrenchRunRenderer | null
  if (!r) return
  r.scrollSpeed   = (config as TrenchRunConfig).scrollSpeed
  r.bankIntensity = (config as TrenchRunConfig).bankIntensity
  r.warpIntensity = (config as TrenchRunConfig).warpIntensity
  r.hudOpacity    = (config as TrenchRunConfig).hudOpacity
}, [config])
```

- [ ] **Step 5: Add gridDensity rebuild trigger**

Add a derived constant alongside `barCount` and `mirrorBars`:

```ts
const trenchGridDensity = config.type === 'trenchRun' ? (config as TrenchRunConfig).gridDensity : 0
```

Add `trenchGridDensity` to the existing rebuild `useEffect` dependency array:

```ts
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [config.type, config.colorScheme, barCount, mirrorBars, trenchGridDensity, started, buildRenderer])
```

- [ ] **Step 6: Run TypeScript check and all tests**

```bash
npx tsc --noEmit && npx jest --no-coverage
```

Expected: No TypeScript errors. All tests pass.

- [ ] **Step 7: Commit**

```bash
git add components/visualizer/VisualizerCanvas.tsx
git commit -m "feat: wire TrenchRunRenderer into VisualizerCanvas"
```

---

## Chunk 5: Integration smoke test

### Task 8: Verify the full stack

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests pass. Zero failures.

- [ ] **Step 2: Run TypeScript check across the project**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Start the dev server and manually verify**

```bash
npm run dev
```

Open `http://localhost:3000`. Click to start. Select `trenchRun` from the type bar.

Verify:
- [ ] Neon wireframe cylinder is visible on a black background
- [ ] Tunnel scrolls forward as audio plays
- [ ] HUD overlay shows corner brackets, targeting reticle, and data readouts (BPM, RMS, VEL, TGT)
- [ ] Open settings panel — five trenchRun sliders appear
- [ ] Moving the **scroll speed** slider changes forward speed immediately (no reload)
- [ ] Moving the **grid density** slider rebuilds the tunnel geometry
- [ ] Switching to another type and back to `trenchRun` preserves slider values
- [ ] Saving as a preset and reloading it restores all values

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: TrenchRunRenderer — neon wireframe tunnel visualiser complete"
```
