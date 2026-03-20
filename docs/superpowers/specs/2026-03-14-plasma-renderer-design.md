# Plasma Renderer — Design Spec

**Date:** 2026-03-14
**Status:** Approved

---

## Overview

A new visualizer type called `plasma` that renders a full-screen animated plasma field using WebGL2. The field continuously shifts colour and motion in response to the music's emotional state, creating an immersive, experiential visualization that invokes emotions appropriate to what is being played.

The design is dual-layer:
- **Atmospheric layer**: a slow-evolving plasma field driven by affective features (`valence`, `arousal`, `tension`, `warmth`) — the emotional "weather"
- **Reactive layer**: beat-responsive shock wave rings spawned on `isOnset`, layered additively on top

---

## Goals

- Evoke genuine emotional response in the viewer that mirrors the music
- Calm/happy music → warm, slow-drifting aurora-like plasma
- Tense/intense music → chaotic, red-shifted, electrically distorted field
- Melancholic music → dim, cool, slow-pooling indigo plasma
- Euphoric music → fast-churning warm golds and rose
- Clean fade to black during silence
- Fit naturally into the existing renderer architecture without changing any other system

---

## Non-Goals

- No text labels or analytical overlays (this is purely abstract/emotional)
- No audio-reactive camera movement or canvas transforms
- No WebGL features beyond WebGL2 baseline (no extensions required)
- No per-preset configuration parameters beyond the standard base config

---

## Architecture

### Files changed

| File | Change |
|---|---|
| `components/visualizer/renderers/PlasmaRenderer.ts` | **New** — the renderer class |
| `lib/validations/preset.ts` | Add `plasmaConfigSchema` (type `'plasma'`); add to `presetConfigSchema` union |
| `components/visualizer/VisualizerCanvas.tsx` | Add `plasma` case to `buildRenderer`; wrap `buildRenderer` call in a try/catch; update import to include `PlasmaConfig` |
| `components/controls/TypeBar.tsx` | Add `'plasma'` to `TYPES` array; add `plasma` case to `buildConfigForType` |

### Interface

`PlasmaRenderer` implements `BaseRenderer`:

```typescript
class PlasmaRenderer implements BaseRenderer {
  render(fft: Float32Array, wave: Float32Array, features: AudioFeatures): void
  resize(width: number, height: number): void
  destroy(): void
}
```

Constructor takes `(canvas: HTMLCanvasElement, config: PlasmaConfig)`. Obtains a `WebGL2RenderingContext` via `canvas.getContext('webgl2')`. Throws if WebGL2 is unavailable.

### Preset schema

```typescript
export const plasmaConfigSchema = baseConfigSchema.extend({
  type: z.literal('plasma'),
})
export type PlasmaConfig = z.infer<typeof plasmaConfigSchema>
```

No additional parameters — the drama comes entirely from the audio features.

---

## TypeBar changes

`TypeBar.tsx` exports a `TYPES` array (the source of truth for the discriminated union of type names) and a `buildConfigForType(type, current)` function that constructs a default config for each type. Add:

```typescript
// In TYPES array:
'plasma'

// In buildConfigForType switch:
case 'plasma':
  return { ...baseConfig, type: 'plasma' }
```

`plasma` has no fftSize minimum requirement. Use the same default fftSize as `bars` and `waveform` (2048).

---

## Error Handling

### WebGL2 unavailable

`PlasmaRenderer` constructor throws `new Error('WebGL2 not supported in this browser.')` if `canvas.getContext('webgl2')` returns null.

`VisualizerCanvas.tsx` currently only wraps `handleStart` (mic acquisition) in a try/catch. Extend `handleStart` to also catch renderer construction errors:

```typescript
async function handleStart() {
  try {
    const engine = new AudioEngine(config)
    await engine.start()
    engineRef.current = engine
    rendererRef.current = buildRenderer(canvas, config)  // may throw for WebGL2
    setStarted(true)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    setMicError(msg.includes('WebGL2')
      ? 'WebGL2 is not supported in this browser. Try Chrome or Firefox.'
      : 'Microphone access denied. Please allow mic access and refresh.')
  }
}
```

Also wrap the `buildRenderer` call in the config-change `useEffect` (the one that rebuilds the renderer when `config.type` changes) in a try/catch that sets `micError`.

### Shader compilation errors

Shader source strings are inline TypeScript template literals inside `PlasmaRenderer.ts`. No webpack loader or `next.config.js` changes are required.

In the constructor, after `gl.compileShader(shader)`, check `gl.getShaderParameter(shader, gl.COMPILE_STATUS)`. If false, throw `new Error('Plasma shader compile error: ' + gl.getShaderInfoLog(shader))`. This surfaces GLSL errors immediately during development.

---

## Rendering Pipeline

### Per-frame sequence

1. Compute `deltaTime` (ms) from `performance.now()`
2. Advance `plasmaTime` by `deltaTime * 0.001 * (0.3 + arousal * 1.4)`
3. Advance each shock wave's `age` by `deltaTime * 0.001` (wall-clock seconds, independent of arousal)
4. Remove shock waves where `age > 1.5` (i.e. 1.5 real seconds after spawn, regardless of tempo)
5. If `features.isOnset`, push a new shock wave with `age = 0`
6. Upload all uniforms
7. Draw fullscreen quad

**Note on time units**: `plasmaTime` is arousal-modulated and drives the plasma field animation speed. Shock wave `age` is plain wall-clock seconds so that beat rings always expand and fade over a consistent 1.5 seconds regardless of music tempo. These are two separate clocks intentionally.

### Fullscreen quad

Two triangles covering NDC clip space `[-1, 1]²`. Vertex shader passes through position and computes `v_uv` in `[0, 1]²`:

```glsl
// vertex shader
attribute vec2 a_position; // [-1,1]²
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

### Fragment shader pipeline

**Step 1 — Domain warp**

Distort the UV coordinates before computing the plasma field:

```glsl
float warpAmt = u_tension * 0.35 + u_buildupIntensity * 0.2;
float wx = sin(v_uv.y * 4.1 + u_time * 0.7) * warpAmt;
float wy = cos(v_uv.x * 3.7 + u_time * 0.5) * warpAmt;
vec2 warpedUV = v_uv + vec2(wx, wy);
```

At `tension = 0` the field is smooth. At `tension = 1` the field is visibly torn and unstable.

**Step 2 — Plasma field value**

Four sinusoidal interference waves summed in warped UV space:

```glsl
float v = 0.0;
v += sin(warpedUV.x * 5.0 + u_time);
v += sin(warpedUV.y * 4.0 + u_time * 0.9);
v += sin((warpedUV.x + warpedUV.y) * 3.5 + u_time * 1.1);
float cx = warpedUV.x + 0.5 * sin(u_time * 0.33);
float cy = warpedUV.y + 0.5 * cos(u_time * 0.25);
v += sin(sqrt(cx * cx + cy * cy) * 5.0 + u_time * 0.8);
// Map from [-4,4] range to [0,1] for palette input
float t = v * 0.125 + 0.5;
```

The sum of four `sin` waves ranges `[-4, 4]`. Multiplying by `0.125` and adding `0.5` maps it to `[0, 1]`, which is what the cosine palette function expects.

**Step 3 — Colour palette**

Inigo Quilez cosine palette: `colour = a + b·cos(2π(c·t + d))`

```glsl
vec3 colour = u_paletteA + u_paletteB * cos(6.28318 * (u_paletteC * t + u_paletteD));
```

Two anchor palette sets are defined as TypeScript constants and interpolated CPU-side before upload:

```typescript
const WARM_PALETTE = { // high valence
  a: [0.5, 0.4, 0.3], b: [0.5, 0.4, 0.3],
  c: [1.0, 1.0, 1.0], d: [0.0, 0.1, 0.2],
}
const COOL_PALETTE = { // low valence
  a: [0.3, 0.3, 0.5], b: [0.3, 0.3, 0.4],
  c: [1.0, 1.0, 1.0], d: [0.5, 0.6, 0.7],
}
// Interpolate and upload as u_paletteA/B/C/D
const p = lerp(COOL_PALETTE, WARM_PALETTE, features.valence)
// then nudge 'a' toward amber using features.warmth
p.a[0] += features.warmth * 0.15
p.a[1] += features.warmth * 0.08
```

**Step 4 — Tension red-shift**

At high tension, shift the hue toward red-orange:

```glsl
colour.r += u_tension * 0.25;
colour.b -= u_tension * 0.15;
colour = clamp(colour, 0.0, 1.0);
```

**Step 5 — Shock waves**

Up to 8 shock wave rings passed as uniform arrays. For each active shock wave:

```glsl
// u_swOrigin[i], u_swAge[i], u_swStrength[i] are the per-ring uniforms
float dist = length(v_uv - u_swOrigin[i]);
float radius = u_swAge[i] * 0.6;              // ring expands over wall-clock time
float ringWidth = 0.04;
float ring = exp(-pow((dist - radius) / ringWidth, 2.0));
float fade = 1.0 - u_swAge[i] / 1.5;         // fades to 0 at 1.5s
// Tint shock wave with warm palette colour at t=0.1 (golden-white)
vec3 swColour = u_paletteA + u_paletteB * cos(6.28318 * (u_paletteC * 0.1 + u_paletteD));
colour += ring * max(fade, 0.0) * u_swStrength[i] * swColour * 1.5;
```

`swColour` is computed inline using the same palette uniforms, sampled at `t = 0.1` which lands in the warm/bright region of the palette for both warm and cool palette anchors.

**Step 6 — Brightness, beat pulse & gate**

```glsl
float beatPulse = pow(1.0 - u_beatPhase, 2.0) * u_rms * 0.3;
float brightness = 0.2 + u_rms * 0.8 + beatPulse;
colour *= brightness * u_signalPresence;
```

**Step 7 — High-frequency shimmer**

Sparkle layer driven by `bandEnergy[3]` (high band):

```glsl
float sparkle = fract(sin(dot(v_uv * 200.0, vec2(12.9898, 78.233))) * 43758.5453);
colour += vec3(sparkle) * u_highBand * 0.15;
```

**Step 8 — Chord change flash**

`u_chromaNovelty` briefly desaturates toward luminance white on harmonic changes:

```glsl
float lum = dot(colour, vec3(0.299, 0.587, 0.114));
colour = mix(colour, vec3(lum), u_chromaNovelty * 0.4);
```

**Final output:**

```glsl
gl_FragColor = vec4(clamp(colour, 0.0, 1.0), 1.0);
```

---

## JavaScript State

```typescript
private plasmaTime = 0
private lastTimestamp = 0
private shockwaves: Array<{
  x: number       // UV x in [0,1] — random spawn position, no spatial weighting
  y: number       // UV y in [0,1] — random spawn position, no spatial weighting
  age: number     // wall-clock seconds elapsed since spawn
  strength: number // features.rms at spawn time
}> = []
```

Shock wave origins are uniformly random across the canvas with no spatial bias based on emotional state. The "filaments drift downward" description in the emotional state table refers to the plasma field's slow drift direction under low-arousal conditions, not to shock wave positioning.

On each `render()` call:
1. Compute `deltaTime = now - this.lastTimestamp`; update `lastTimestamp`
2. Advance `plasmaTime += deltaTime * 0.001 * (0.3 + features.arousal * 1.4)`
3. Increment `age` of each shock wave by `deltaTime * 0.001` (wall-clock seconds)
4. Remove shock waves where `age >= 1.5`
5. On `features.isOnset`: push `{ x: Math.random(), y: Math.random(), age: 0, strength: features.rms }`; cap array at 8 (drop oldest if over)

---

## Uniform Reference

| Uniform | Type | Source |
|---|---|---|
| `u_time` | float | `plasmaTime` |
| `u_valence` | float | `features.valence` (used CPU-side for palette interpolation only) |
| `u_arousal` | float | `features.arousal` (used CPU-side for time advance only) |
| `u_tension` | float | `features.tension` |
| `u_buildupIntensity` | float | `features.buildupIntensity` |
| `u_rms` | float | `features.rms` |
| `u_signalPresence` | float | `features.signalPresence` |
| `u_beatPhase` | float | `features.beatPhase` |
| `u_highBand` | float | `features.bandEnergy[3]` |
| `u_chromaNovelty` | float | `features.chromaNovelty` |
| `u_swOrigin[8]` | vec2[8] | shock wave positions (UV) |
| `u_swAge[8]` | float[8] | shock wave ages (wall-clock seconds) |
| `u_swStrength[8]` | float[8] | shock wave rms strengths |
| `u_swCount` | int | active shock wave count |
| `u_paletteA` | vec3 | interpolated palette `a` (CPU-side blend of WARM/COOL + warmth nudge) |
| `u_paletteB` | vec3 | interpolated palette `b` |
| `u_paletteC` | vec3 | interpolated palette `c` |
| `u_paletteD` | vec3 | interpolated palette `d` |

Note: `u_valence` and `u_arousal` drive CPU-side logic only and are not uploaded as GPU uniforms. `u_resolution` is not needed — all UVs are computed in `[0,1]²` from the vertex shader and do not require pixel-space resolution.

---

## Emotional State Summary

| State | Valence | Arousal | Tension | Visual result |
|---|---|---|---|---|
| Joyful/Euphoric | High | High | Low | Fast warm golds/rose, frequent bright shock waves |
| Serene/Peaceful | High | Low | Low | Slow soft aquamarine/mint, wide gentle rings |
| Tense/Intense | Low | High | High | Fast crimson/purple, chaotic warp, many filaments |
| Melancholic | Low | Low | Low | Slow dim indigo, plasma drifts languidly, faint rings |

The plasma drift direction is purely a function of the time-varying sine terms in the field formula and is not spatially directed by emotional state.

---

## Initialisation & Cleanup

**Constructor sequence:**
1. Call `canvas.getContext('webgl2')` — throw `new Error('WebGL2 not supported in this browser.')` if null
2. Compile vertex shader from inline template literal string
3. Compile fragment shader from inline template literal string — check `COMPILE_STATUS`, throw with `getShaderInfoLog` on failure
4. Link program — check `LINK_STATUS`, throw with `getProgramInfoLog` on failure
5. Create fullscreen quad: a `Float32Array` of 6 vertices (two triangles), upload to a VBO, bind to `a_position`
6. Cache all uniform locations via `gl.getUniformLocation`
7. Set `gl.clearColor(0, 0, 0, 1)` and `gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE)` for additive shock wave blending

**`resize(w, h)`**: call `gl.viewport(0, 0, w, h)`.

**`destroy()`**: delete program, both shaders, VBO. Call `gl.getExtension('WEBGL_lose_context')?.loseContext()` to release GPU memory explicitly.

---

## Shader Source Location

Both vertex and fragment GLSL sources are inline TypeScript template literal strings defined as private constants at the top of `PlasmaRenderer.ts`. No webpack loader, no `.glsl` files, no `next.config.js` changes required.

```typescript
const VERTEX_SHADER_SRC = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() { ... }
`

const FRAGMENT_SHADER_SRC = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  // ... all uniforms declared
  void main() { ... }
`
```

---

## Out of Scope

- WebGL extensions (float textures, anisotropic filtering) — not needed
- Offscreen rendering or post-processing passes — single-pass is sufficient
- Saving/exporting frames
- Any changes to the audio pipeline or feature extractor
