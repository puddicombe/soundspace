# TrenchRun Rectangular Geometry + Scanner Range

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cylindrical tunnel geometry with an open rectangular trench (floor + two side walls, no ceiling) and add audio-driven scanner range that controls how far ahead the player can see.

**Architecture:** All changes are confined to `TrenchRunRenderer.ts`. Geometry is rebuilt from scratch in the constructor; the fragment shader gets a new `u_scanRange` uniform replacing the hardcoded depth-fade constant; render() computes scanRange from smoothed RMS each frame.

**Tech Stack:** TypeScript, WebGL2 (GLSL ES 3.00), Jest

---

## File Structure

| File | Action |
|---|---|
| `components/visualizer/renderers/TrenchRunRenderer.ts` | Modify — replace geometry, update shader, add scanRange |
| `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts` | Modify — add scanRange test, update geometry test |

---

## Task 1: Update tests first (TDD red phase)

**Files:**
- Modify: `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts`

### Background

The existing test at line ~151 checks `expect(gl.drawArrays).toHaveBeenCalled()`. After this change, `drawArrays` will be called 6 times per frame (3 faces × 2 glow passes), so that test still passes unchanged.

Add **two new tests** inside the existing `describe('TrenchRunRenderer', ...)` block:

- [ ] **Step 1: Add geometry size test**

After the `calls gl.drawArrays on render` test, add:

```ts
it('builds geometry for 3 rectangular faces (floor + 2 walls)', () => {
  const gl = makeGlStub()
  const canvas = makeCanvas(gl)
  new TrenchRunRenderer(canvas, defaultConfig)
  // gridDensity=16 → 12 * 16 = 192 vertices → 576 floats
  const call = gl.bufferData.mock.calls[0]
  expect(call[1]).toBeInstanceOf(Float32Array)
  expect((call[1] as Float32Array).length).toBe(12 * defaultConfig.gridDensity * 3)
})
```

- [ ] **Step 2: Add scanRange upload test**

```ts
it('uploads u_scanRange uniform on each render call', () => {
  const gl = makeGlStub()
  const canvas = makeCanvas(gl)
  const renderer = new TrenchRunRenderer(canvas, defaultConfig)
  const fft = new Float32Array(2048)
  const wave = new Float32Array(2048)
  renderer.render(fft, wave, { ...NULL_FEATURES })
  // uniform1f should have been called with the scan range location
  const scanRangeLoc = gl.getUniformLocation.mock.results.find(
    (_: unknown, i: number) => gl.getUniformLocation.mock.calls[i][1] === 'u_scanRange'
  )
  expect(scanRangeLoc).toBeDefined()
  expect(gl.uniform1f).toHaveBeenCalled()
})
```

- [ ] **Step 3: Run tests to confirm new tests fail**

```
npx jest components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts --no-coverage 2>&1 | tail -15
```

Expected: 2 new tests FAIL (geometry test fails because bufferData is called with wrong size; scanRange test fails because uniform doesn't exist yet). Existing 15 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts
git commit -m "test: TDD red — rectangular geometry size + scanRange upload tests"
```

---

## Task 2: Replace geometry and add scanner range

**Files:**
- Modify: `components/visualizer/renderers/TrenchRunRenderer.ts`

### 2a — Update constants

- [ ] **Step 1: Replace tunnel geometry constants**

Find lines 172–174:
```ts
const TUNNEL_LENGTH = 80.0
const RING_COUNT = 32
const RADIUS = 5.0
```

Replace with:
```ts
const TUNNEL_LENGTH    = 80.0
const TRENCH_W         = 6.0   // half-width; walls at x = ±TRENCH_W
const TRENCH_H         = 3.0   // floor at y = -TRENCH_H
const TRENCH_TOP       = 5.0   // walls extend to y = +TRENCH_TOP (open above)
const BASE_SCAN_RANGE  = 20.0  // visible distance at silence
const SCAN_RANGE_DELTA = 40.0  // additional range added at full RMS
```

### 2b — Update fragment shader

- [ ] **Step 2: Add `u_scanRange` uniform to fragment shader**

Find `FRAGMENT_SHADER_SRC`. Replace the `void main()` block:

```glsl
// OLD:
void main() {
  float depthFade = 1.0 / (1.0 + v_depth * v_depth * 0.001);
  float brightness = 1.0 + u_beatFlash * 0.5;
  fragColor = vec4(u_color * brightness, u_alpha * depthFade);
}

// NEW (also add `uniform float u_scanRange;` after `uniform float u_beatFlash;`):
uniform float u_scanRange;

void main() {
  float nd = v_depth / u_scanRange;
  float depthFade = 1.0 / (1.0 + nd * nd);
  float brightness = 1.0 + u_beatFlash * 0.5;
  fragColor = vec4(u_color * brightness, u_alpha * depthFade);
}
```

The full updated `FRAGMENT_SHADER_SRC`:
```ts
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
```

### 2c — Add uniform location field

- [ ] **Step 3: Add `u_scanRangeLoc` field**

In the class field declarations (around line 207–214), add:
```ts
private u_scanRangeLoc: WebGLUniformLocation | null
```

Also **remove** the now-unused fields:
```ts
// Remove these two:
private floorOffset: number
private floorVertexCount: number
```

### 2d — Replace geometry construction in constructor

- [ ] **Step 4: Replace the geometry build block**

Find the block from `// Build tunnel geometry` (line 269) down to (but NOT including) the `// Upload buffer` comment (line 319). Replace lines 269–318 with the following — the `gl.createBuffer / gl.bindBuffer / gl.bufferData` upload block stays intact:

```ts
// Build rectangular trench geometry
// Layout: [floor | left wall | right wall], each face = gridDensity*4 vertices
const N = config.gridDensity

const totalVertices = N * 4 * 3  // 3 faces × 4N verts
const positions = new Float32Array(totalVertices * 3)
let idx = 0

// Face helper: forward lines (parallel to Z) + cross lines (perpendicular to Z)
// Forward line at fixed (x,y): two vertices (z=0, z=TUNNEL_LENGTH)
// Cross line at fixed z: two vertices at the face endpoints

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
```

### 2e — Cache scanRange uniform location

- [ ] **Step 5: Add `u_scanRangeLoc` to the uniform location cache block**

After:
```ts
this.u_alphaLoc = gl.getUniformLocation(program, 'u_alpha')
```

Add:
```ts
this.u_scanRangeLoc = gl.getUniformLocation(program, 'u_scanRange')
```

### 2f — Replace drawGeometry

- [ ] **Step 6: Replace `drawGeometry` method**

Find the `drawGeometry` method (lines 441–450). Replace with:

```ts
private drawGeometry(gl: WebGL2RenderingContext, N: number): void {
  gl.drawArrays(gl.LINES, 0,       N * 4)  // floor
  gl.drawArrays(gl.LINES, N * 4,   N * 4)  // left wall
  gl.drawArrays(gl.LINES, N * 8,   N * 4)  // right wall
}
```

### 2g — Upload scanRange in render()

- [ ] **Step 7: Compute and upload scanRange in render()**

In `render()`, after the existing uniform uploads (after `gl.uniform3fv` for color), add:

```ts
const scanRange = BASE_SCAN_RANGE + this.smoothedRms * SCAN_RANGE_DELTA
gl.uniform1f(this.u_scanRangeLoc, scanRange)
```

### 2h — Run tests

- [ ] **Step 8: Run the full test suite**

```
npx jest --no-coverage 2>&1 | tail -15
```

Expected: all 17 tests pass (15 original + 2 new). Fix any failures before committing.

- [ ] **Step 9: TypeScript check**

```
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 10: Commit**

```bash
git add components/visualizer/renderers/TrenchRunRenderer.ts
git commit -m "feat: rectangular open trench geometry + audio-driven scanner range"
```

---

## Chunk 1 ends here. All changes are in one logical chunk since they're tightly coupled (shader ↔ uniform ↔ geometry are all part of the same renderer rebuild).
