# TrenchRunRenderer — Design Spec

**Date:** 2026-03-16
**Status:** Approved

## Overview

A new visualiser renderer blending the aesthetic of the Star Wars starfighter targeting computer, the Atari Star Wars arcade game's wireframe vector graphics, Tron's neon grid, and a curved cylindrical grid geometry. The result is a first-person flight through a neon wireframe tunnel with a HUD overlay, driven by audio features.

**Aesthetic reference:**
- Star Wars cockpit targeting computer (amber reticle, corner brackets, data readouts)
- Atari Star Wars arcade (1983) — crisp wireframe vector geometry on black
- Tron — cyan/blue neon lines, glowing grid
- Curved grid — cylindrical tunnel with perspective convergence

---

## Architecture

### Rendering surfaces

Two surfaces managed by the renderer:

1. **WebGL2 canvas** — passed in from `VisualizerCanvas` as the primary canvas (`glCanvas`). Owns all 3D wireframe geometry (grid rings, rails, floor plane). Same lifecycle pattern as `PlasmaRenderer`.
2. **Canvas 2D overlay** — a transparent `<canvas>` the renderer creates itself at construction time, injected as an absolutely-positioned sibling in `canvas.parentElement`. The renderer throws a descriptive error if `canvas.parentElement` is null. The overlay is styled `position: absolute; top: 0; left: 0; pointer-events: none; z-index: 10` so it sits above the WebGL canvas without intercepting pointer events. On `destroy()` the overlay is removed from the DOM.

The React-managed 2D `canvasRef` in `VisualizerCanvas` is **not** used by TrenchRun — it is hidden for this type (same as `plasma`). The HUD is drawn exclusively on the injected overlay canvas.

### Files

| File | Purpose |
|---|---|
| `components/visualizer/renderers/TrenchRunRenderer.ts` | Renderer implementation |
| `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts` | Test suite |
| `lib/validations/preset.ts` | Add `trenchRunConfigSchema` + `TrenchRunConfig` type |
| `components/controls/ControlPanel.tsx` | Add `isTrenchRun` settings block |
| `components/controls/TypeBar.tsx` | Add `trenchRun` to `TYPES`, add `buildConfigForType` branch |
| `components/visualizer/VisualizerCanvas.tsx` | Wire `trenchRun` into `buildRenderer`, canvas visibility, in-place config effect, `gridDensity` rebuild trigger |

Adding `'trenchRun'` to `TYPES` in `TypeBar.tsx` changes the exported `VisualizerType` union. Any file that imports `VisualizerType` (`ControlPanel.tsx`, `page.tsx`) should be checked for exhaustiveness — no functional changes expected, but TypeScript may surface narrowing gaps.

### Interface

Implements `BaseRenderer` unchanged:

```ts
render(fftData: Float32Array, waveData: Float32Array, features: AudioFeatures): void
resize(width: number, height: number): void
destroy(): void
```

`destroy()` removes the overlay canvas from the DOM. It does **not** call `loseContext()` — doing so permanently invalidates the canvas's WebGL context and prevents rebuilding a new renderer on the same canvas element. Consistent with `PlasmaRenderer`.

---

## 3D Geometry & WebGL Rendering

### GLSL version

All shaders declare `#version 300 es` and use WebGL2 GLSL syntax (`in`/`out`, named `out vec4 fragColor`). This is an **intentional departure from `PlasmaRenderer`**, which uses legacy WebGL1 GLSL (`attribute`/`varying`, implicit `gl_FragColor`) for historical reasons. TrenchRunRenderer uses proper WebGL2 dialect throughout.

**Vertex shader skeleton:**
```glsl
#version 300 es
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
  // seamless scroll: wrap z positions modulo tunnel length
  pos.z = mod(pos.z + u_zOffset, TUNNEL_LENGTH) - TUNNEL_LENGTH * 0.5;
  // bass breath: scale ring radius
  pos.xy *= 1.0 + u_bassBreath * 0.08;
  // perspective projection
  gl_Position = u_mvp * vec4(pos, 1.0);
  // stylistic barrel warp — applied in clip space (intentional approximation;
  // operates on clip-space xy before perspective divide, so distortion strength
  // varies with depth, creating a stronger effect for distant geometry which
  // is the desired visual result for a drop-arrival warp burst)
  float r2 = dot(gl_Position.xy, gl_Position.xy);
  gl_Position.xy *= 1.0 + u_warpAmount * r2;
  // pass forward depth for fragment fade — clamp to 0 for geometry behind camera
  v_depth = max(0.0, pos.z); // 0 at nearest ring, TUNNEL_LENGTH/2 at farthest
}
```

**Fragment shader skeleton:**
```glsl
#version 300 es
precision mediump float;
in float v_depth;
out vec4 fragColor;

uniform vec3 u_color;
uniform float u_alpha;
uniform float u_beatFlash;

void main() {
  float depthFade = 1.0 / (1.0 + v_depth * v_depth * 0.001); // 0→1.0, 40→0.38
  float brightness = 1.0 + u_beatFlash * 0.5;
  fragColor = vec4(u_color * brightness, u_alpha * depthFade);
}
```

### MVP matrix

The `u_mvp` uniform is a `mat4` computed on the CPU each frame and uploaded via `gl.uniformMatrix4fv`. Three components:

- **Perspective matrix** — 60° FOV, aspect = canvas width / height, near = 0.1, far = 200.0. Recomputed on `resize()`.
- **View matrix** — camera at `(0, 0, -10)` looking at `(0, 0, 0)`. The `bankAngle` value (computed from audio) is applied as a roll: the camera up-vector is rotated by `bankAngle` radians around the Z axis before constructing the lookAt matrix.
- **Model matrix** — identity (geometry is in world space).

`mvp = perspective × view × model`. Use a small inline mat4 utility (no external library).

### GPU uniforms table

| Uniform | Type | Set by |
|---|---|---|
| `u_mvp` | mat4 | CPU, each frame |
| `u_zOffset` | float | CPU, each frame |
| `u_bassBreath` | float | CPU, each frame |
| `u_beatFlash` | float | CPU, each frame |
| `u_warpAmount` | float | CPU, each frame |
| `u_color` | vec3 | CPU, each frame (palette lookup) |
| `u_alpha` | float | CPU, per draw pass (0.2 halo / 1.0 core) |

### Renderer public properties (CPU-side state)

These are JavaScript class properties updated in-place without rebuilding the renderer:

| Property | Type | Maps to |
|---|---|---|
| `scrollSpeed` | number | Multiplies computed scroll delta before applying to `u_zOffset` |
| `bankIntensity` | number | Scales computed bank angle amplitude |
| `warpIntensity` | number | Scales computed warp amount ceiling |
| `hudOpacity` | number | Sets `ctx.globalAlpha` before drawing the HUD overlay |

`gridDensity` is **not** an in-place property — changing it requires rebuilding the geometry buffer. It is therefore added to the `useEffect` dependency array in `VisualizerCanvas` alongside `config.type`, causing a full renderer rebuild on change (same pattern as `barCount` for `BarsRenderer`).

### Tunnel structure

A wireframe cylinder — no solid mesh, only lines. Three geometry groups stored in a single `Float32Array` of `vec3` positions:

Where `segmentCount = gridDensity` (the preset value, default 16) and `RING_COUNT = 32` (a named constant, fixed — not configurable, not a schema field).

- **Rings** — `RING_COUNT` rings, each with `segmentCount` vertices evenly distributed around the circumference at radius 5.0. Drawn as `LINE_LOOP` — one `gl.drawArrays(gl.LINE_LOOP, i * segmentCount, segmentCount)` call per ring, iterating `i` from 0 to `RING_COUNT - 1`. All rings share the single VBO; the vertex-count offset selects the correct ring data.
- **Rails** — `segmentCount` rails running the full tunnel length (Z from 0 to `TUNNEL_LENGTH`). Each rail is a `LINES` pair: near vertex (`z = 0`) + far vertex (`z = TUNNEL_LENGTH`). Drawn as a single `gl.drawArrays(gl.LINES, railOffset, segmentCount × 2)` call.
- **Floor plane** — `floorCols` forward lines (where `floorCols = Math.floor(segmentCount / 2)`) and 8 cross-lines, stored as independent `LINES` pairs (not `LINE_STRIP`) to avoid phantom connectors between logically separate lines. The floor plane sits at `y = -5.0` (the bottom of the cylinder). Forward lines run from `z = 0` to `z = TUNNEL_LENGTH` at evenly-spaced X positions across the floor. Cross-lines run across the full floor width at 8 evenly-spaced Z depths. Each line is two vertices. Drawn as a single `gl.drawArrays(gl.LINES, floorOffset, floorVertexCount)` call.

**Buffer layout:**
```
[ring_0 ... ring_(RING_COUNT-1) | rail_pairs | floor_lines]
```
- `ringOffset = 0`, each ring has `segmentCount` vertices → `RING_COUNT × segmentCount` vertices total
- `railOffset = RING_COUNT × segmentCount`, rails = `segmentCount × 2` vertices
- `floorOffset = railOffset + segmentCount × 2`
- `floorVertexCount = (floorCols + 8) × 2` (each line = 2 vertices)

Buffer follows the same VBO pattern as `PlasmaRenderer` (no VAO): `gl.createBuffer()`, `gl.bindBuffer(gl.ARRAY_BUFFER, ...)`, `gl.bufferData(...)`, one `vertexAttribPointer` call for `a_position` as `gl.FLOAT, false, stride=12, offset=0`.

### Glow effect

WebGL2 line width is capped at 1px on most modern implementations (`gl.lineWidth()` is silently clamped). Glow is approximated by two draw passes per frame:

1. **Halo pass** — set `u_alpha = 0.2`, draw all geometry. The semi-transparent halo layer.
2. **Core pass** — set `u_alpha = 1.0`, draw all geometry. The sharp bright core.

GL blending must be enabled: `gl.enable(gl.BLEND)`, `gl.blendFunc(gl.SRC_ALPHA, gl.ONE)` (additive blending — halo and core add together for a brighter combined line). `u_beatFlash` drives the `u_color` brightness multiplier in the fragment shader, orthogonal to `u_alpha`.

---

## Audio Reactivity Mapping

### Frame timing

`render()` does not receive a timestamp. Frame delta time (`dt`) is computed internally via `performance.now()`, same pattern as `PlasmaRenderer`. The smoothed values (`smoothedRms`, `smoothedBass`) are maintained as private class state and updated each frame using an exponential moving average with τ = 150ms.

The exported pure functions (`computeScrollDelta`, `computeBankAngle`, etc.) accept **already-smoothed** values as parameters — the caller (the renderer's `render()` method) is responsible for computing and passing `smoothedRms`. This keeps the pure functions side-effect-free and testable without simulating multiple frames.

`AudioFeatures` field names used (corrected to actual interface):

| Visual parameter | `AudioFeatures` field | Behaviour |
|---|---|---|
| `u_zOffset` scroll speed | `rms` | Continuous. Base speed = `(30 + smoothedRms × 90) × scrollSpeed` units/s. |
| `u_zOffset` beat snap | `isOnset` (boolean) | Flat +8 unit addition on the single onset frame only (no per-frame decay). Additive with RMS scroll. |
| `u_mvp` view bank | `rms` + time | Bank angle = `sin(time × 0.15 × 2π) × smoothedRms × bankIntensity × (25° in radians)`. `time` is wall-clock elapsed seconds accumulated via `this.time += dt` each frame (not arousal-modulated). Applied to camera up-vector roll before computing view matrix. |
| `u_warpAmount` barrel distortion | `buildupIntensity` | 0 when `buildupIntensity ≤ 0.6`. Ramps to `warpIntensity × 0.4` linearly above threshold. |
| `u_beatFlash` | `isOnset` (boolean) | Set to 1.0 on onset frame, exponential decay τ ≈ 60ms. Drives colour brightness burst + reticle snap. |
| `u_bassBreath` | `bandEnergy[1]` (bass band) | Smoothed bass band energy. Drives ±8% tunnel radius pulse. |
| `u_color` hue | `spectralCentroid` | Normalise centroid to [0, 1] via `Math.min(centroid / 8000, 1.0)`. Values < 0.4 shift the grid colour toward blue (darker); values > 0.6 shift toward white (brighter). Middle range 0.4–0.6 uses the base palette colour unchanged. Unknown `colorScheme` values fall back to the `neon-dark` palette. |

---

## Preset Schema

Extends `baseConfigSchema` following the same pattern as `plasmaConfigSchema`:

```ts
export const trenchRunConfigSchema = baseConfigSchema.extend({
  type: z.literal('trenchRun'),
  scrollSpeed:   z.number().min(0.5).max(2.0).default(1.0),
  bankIntensity: z.number().min(0.0).max(1.0).default(0.6),
  warpIntensity: z.number().min(0.0).max(1.0).default(0.5),
  gridDensity:   z.number().int().min(8).max(32).default(16),
  hudOpacity:    z.number().min(0.0).max(1.0).default(0.9),
})
export type TrenchRunConfig = z.infer<typeof trenchRunConfigSchema>
```

Added to the `presetConfigSchema` discriminated union alongside existing types.

### Color scheme palette mapping

`colorScheme` (from base config) maps to TrenchRun-specific palettes:

| colorScheme | Grid colour | Reticle / HUD colour |
|---|---|---|
| `neon-dark` | Cyan `#00E5FF` | Amber `#FFB300` |
| `ocean` | Deep blue `#0050FF` | Green `#00FF88` |
| `mono` | Phosphor green `#39FF14` | White `#FFFFFF` |
| `sunset` | Orange-red `#FF4500` | White `#FFFFFF` |

---

## Settings Panel

`ControlPanel.tsx` gains an `isTrenchRun` block alongside the existing `isPlasma` block. Five sliders, same range-input pattern as plasma brightness/dynamic range:

- **Scroll speed** — 0.5×–2.0×
- **Bank intensity** — 0–100%
- **Warp intensity** — 0–100%
- **Grid density** — 8–32 segments
- **HUD opacity** — 0–100%

### TypeBar changes

`TypeBar.tsx`: add `'trenchRun'` to the `TYPES` array. Add a branch to `buildConfigForType` **before** the `bars` fallback:

```ts
if (type === 'trenchRun') {
  const scrollSpeed   = current.type === 'trenchRun' ? current.scrollSpeed   : 1.0
  const bankIntensity = current.type === 'trenchRun' ? current.bankIntensity : 0.6
  const warpIntensity = current.type === 'trenchRun' ? current.warpIntensity : 0.5
  const gridDensity   = current.type === 'trenchRun' ? current.gridDensity   : 16
  const hudOpacity    = current.type === 'trenchRun' ? current.hudOpacity    : 0.9
  return { ...base, type: 'trenchRun', fftSize: current.fftSize,
           scrollSpeed, bankIntensity, warpIntensity, gridDensity, hudOpacity } as PresetConfig
}
```

### VisualizerCanvas changes

Four changes to `VisualizerCanvas.tsx`:

**1. `buildRenderer`** — add case (plus import):
```ts
if (cfg.type === 'trenchRun') return new TrenchRunRenderer(glCanvas, cfg as TrenchRunConfig)
```

**2. Canvas visibility** — introduce a `usesGl` flag:
```tsx
const usesGl = config.type === 'plasma' || config.type === 'trenchRun'
<canvas ref={canvasRef}   style={{ display: usesGl ? 'none' : 'block' }} />
<canvas ref={glCanvasRef} style={{ display: usesGl ? 'block' : 'none' }} />
```

**3. In-place config update effect** — following the plasma pattern, push the four in-place properties without a rebuild:
```ts
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

**4. Rebuild trigger for `gridDensity`** — add `gridDensity` to the type-change `useEffect` dependency array:
```ts
const trenchGridDensity = config.type === 'trenchRun' ? (config as TrenchRunConfig).gridDensity : 0
useEffect(() => {
  // existing rebuild effect
}, [config.type, config.colorScheme, barCount, mirrorBars, trenchGridDensity, started, buildRenderer])
```

**Constructor initialisation:** The `TrenchRunRenderer` constructor must read `scrollSpeed`, `bankIntensity`, `warpIntensity`, and `hudOpacity` from the passed config and set the corresponding class properties. This ensures a newly built renderer (e.g. after a `gridDensity` change) reflects the current slider values without relying on the in-place update effect firing again.

**Effect interaction note:** when `gridDensity` changes, both the in-place effect (#3) and the rebuild effect (#4) will fire on the same render cycle. React runs effects in declaration order: the in-place effect fires first (writes to the old renderer — harmless, it's about to be destroyed), then the rebuild effect creates a fresh renderer. Because the constructor initialises properties from config (above), the new renderer is correctly configured without requiring an additional in-place effect cycle.

---

## HUD Overlay (Canvas 2D)

### Scanlines optimisation

Scanlines are static. They are drawn once to an offscreen `OffscreenCanvas` at construction time (and re-drawn on `resize()`). On `resize(w, h)`, the `OffscreenCanvas` dimensions must be updated to `w × h` **before** re-drawing the scanlines, otherwise the composited `drawImage` will silently scale incorrectly. Each frame the scanline image is composited onto the overlay with `ctx.drawImage(scanlineCanvas, 0, 0)` — a single GPU texture blit rather than hundreds of individual line draws.

### Per-frame draw

Redrawn every frame after the WebGL pass. Global `hudOpacity` set once via `ctx.globalAlpha`. Draw order:

1. `ctx.clearRect` (clear overlay from last frame)
2. `ctx.drawImage(scanlineCanvas, 0, 0)` — composite pre-baked scanlines
3. Corner brackets
4. Targeting reticle
5. Data readouts
6. Radar sweep line

### Elements

**1. Corner brackets**
L-shaped lines (~40px arms) in each corner. Colour = HUD colour from palette. Static position. Scale arm length proportionally on `resize()`.

**2. Targeting reticle**
Three concentric circles with crosshair lines, centred on canvas.
- Outer ring radius: snaps to 1.3× base on `beatFlash = 1.0`, exponential decay back to 1.0× over ~80ms.
- Inner dot opacity: pulses with smoothed `rms`.

**3. Data readouts**
Monospace HUD-colour text, ~11px, four positions:

| Position | Content | Notes |
|---|---|---|
| Top-left | `BPM: 124` | `BPM: ---` when `features.bpm === null`; `Math.round(bpm)` when present |
| Top-right | `RMS: 0.72` | Updates each frame |
| Bottom-left | `VEL: 1.4×` | Current effective scroll speed multiplier |
| Bottom-right | `TGT: LOCK` / `TGT: SCAN` | `LOCK` for ~400ms after `isOnset`, otherwise `SCAN` |

**4. Radar sweep line**
Single horizontal line travelling top→bottom over ~2 seconds. Resets on each `isOnset` frame.

---

## Testing

Pattern follows `PlasmaRenderer.test.ts`. jsdom environment with mock WebGL2 context.

### Test stub requirements

The WebGL2 mock (following `PlasmaRenderer.test.ts` pattern) must include `uniformMatrix4fv` since the renderer calls it every frame. Add `uniformMatrix4fv: jest.fn()` to the `makeGlStub()` helper alongside the existing uniform setters (`uniform1f`, `uniform3fv`, etc.).

### Constructor
- Creates WebGL2 context on provided canvas; throws descriptive error if WebGL2 is unavailable
- Injects overlay canvas as sibling in `canvas.parentElement`, with `pointer-events: none` and `z-index: 10`
- Throws if `canvas.parentElement` is null
- Compiles `#version 300 es` vertex + fragment shaders without error

### Lifecycle
- `resize(w, h)` sets the overlay canvas width and height to match `w` and `h`
- `resize(w, h)` updates the WebGL viewport
- `destroy()` removes the overlay canvas from the DOM (assert `!canvas.parentElement.contains(overlay)`)
- `destroy()` does NOT call `loseContext`

### Render
- `render()` with `NULL_FEATURES` completes without throwing
- `render()` with a full `AudioFeatures` object completes without throwing

### Pure function unit tests

Core audio→visual math extracted as pure exported functions, tested without WebGL. All angles in **radians**.

| Function | Assertion |
|---|---|
| `computeScrollDelta(smoothedRms=0.5, isOnset=false, scrollSpeed=1.0, dt=0.016)` | Returns ≈ 1.2 (base: 75 units/s × 0.016s); snap is 0 when `isOnset=false` |
| `computeScrollDelta(smoothedRms=0.5, isOnset=true, scrollSpeed=1.0, dt=0.016)` | Returns ≈ 9.2 (base 1.2 + flat snap 8.0 added on this one frame) |
| `computeBankAngle(smoothedRms=1.0, time=0, bankIntensity=1.0)` | Returns 0 (sin(0) = 0) |
| `computeBankAngle(smoothedRms=1.0, time=1/(0.15×4), bankIntensity=1.0)` | Returns ≈ 0.436 rad (sin(π/2) = 1.0, tolerance ±0.001) |
| `computeWarpAmount(buildupIntensity=0.5, warpIntensity=1.0)` | Returns 0 (below 0.6 threshold) |
| `computeWarpAmount(buildupIntensity=0.8, warpIntensity=1.0)` | Returns 0.4 × ((0.8-0.6)/0.4) = 0.2 |
| `computeReticleRadius(beatFlash=1.0)` | Returns 1.3 |
| `computeReticleRadius(beatFlash=0.0)` | Returns 1.0 |
