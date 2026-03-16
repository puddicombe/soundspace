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

1. **WebGL2 canvas** — passed in from `VisualizerCanvas` as the primary canvas. Owns all 3D wireframe geometry (grid rings, rails, floor plane). Same lifecycle pattern as `PlasmaRenderer`.
2. **Canvas 2D overlay** — a transparent `<canvas>` the renderer creates itself at construction time, injected as an absolutely-positioned sibling in the DOM over the WebGL canvas, `pointer-events: none`. Draws all HUD chrome. Removed from DOM on `destroy()`.

### Files

| File | Purpose |
|---|---|
| `components/visualizer/renderers/TrenchRunRenderer.ts` | Renderer implementation |
| `components/visualizer/renderers/__tests__/TrenchRunRenderer.test.ts` | Test suite |
| `lib/validations/preset.ts` | Add `trenchRunConfigSchema` + `TrenchRunConfig` type |
| `components/controls/ControlPanel.tsx` | Add `isTrenchRun` settings block |
| `components/controls/TypeBar.tsx` | Add `trenchRun` to type list |

### Interface

Implements `BaseRenderer` unchanged:

```ts
render(fftData: Float32Array, waveData: Float32Array, features: AudioFeatures): void
resize(width: number, height: number): void
destroy(): void
```

---

## 3D Geometry & WebGL Rendering

### Tunnel structure

A wireframe cylinder — no solid mesh, only lines:

- **Rings** — circles (polygons) at evenly-spaced Z depth intervals. These are the cross-section "walls" rushing toward the camera.
- **Rails** — straight lines running the full tunnel length parallel to Z. The longitudinal Tron-style stripes.
- **Floor plane** — a flat perspective grid below the cylinder centre line. Lines converge to the vanishing point, giving the canyon floor feel.

All geometry is computed once at init and uploaded to a static vertex buffer. The vertex shader handles all animation via uniforms — no per-frame JS recomputation of vertices.

### Vertex shader uniforms

| Uniform | Type | Effect |
|---|---|---|
| `u_zOffset` | float | Scroll position. Shader wraps ring Z positions modulo tunnel length for seamless looping. |
| `u_bankAngle` | float | Rotates the camera up-vector, tilting the scene left/right. |
| `u_warpAmount` | float | Barrel-distorts vertex positions by pushing screen-edge vertices outward. |
| `u_beatFlash` | float | 0→1 value decaying after each beat onset. Drives line brightness burst. |
| `u_bassBreath` | float | Scales tunnel radius ±8% for a breathing pulse on bass hits. |
| `u_scrollSpeedMult` | float | User-configurable speed multiplier from preset. |
| `u_bankAmp` | float | User-configurable VP drift amplitude ceiling. |
| `u_warpMax` | float | User-configurable barrel distortion ceiling. |

### Glow effect

Each line drawn twice:
1. 3× width, ~20% alpha — the bloom halo
2. 1px, 100% alpha — the sharp core

No framebuffer or post-process pass required. Keeps implementation simple.

### Depth fade

Ring alpha scales with `1/z²` in the vertex shader. Distant rings fade toward black, creating the vanishing point illusion without a fog uniform.

---

## Audio Reactivity Mapping

| Visual parameter | Audio feature | Behaviour |
|---|---|---|
| `u_zOffset` scroll speed | `rms` | Continuous. Base speed scales 30–120 units/s with RMS. 150ms smoothing lag. |
| `u_zOffset` beat snap | `beatOnset` | Sharp +8 unit lurch on each onset, decays over ~80ms. Additive with RMS scroll. |
| `u_bankAngle` VP drift | `rms` + time | Slow sinusoid (~0.15 Hz) whose amplitude scales with smoothed RMS. Range ±(bankIntensity × 25°). |
| `u_warpAmount` barrel distortion | `buildupIntensity` | 0 normally. Ramps to `warpMax` when `buildupIntensity` > 0.6. Snaps back when it drops. |
| `u_beatFlash` | `beatOnset` | Set to 1.0 on onset, exponential decay τ ≈ 60ms. Drives line brightness + reticle snap. |
| `u_bassBreath` | `lowBand` | Smoothed low-band energy. Drives ±8% tunnel radius pulse. |
| Grid line hue | `spectralCentroid` | Subtly interpolates cyan toward blue (low centroid) or white (high centroid). |

All audio features used (`rms`, `beatOnset`, `buildupIntensity`, `lowBand`, `spectralCentroid`) are already present in `AudioFeatures` — no new extraction work required.

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

`TypeBar.tsx` gets `trenchRun` added to the type array and `buildConfigForType` switch.

---

## HUD Overlay (Canvas 2D)

Redrawn every frame after the WebGL pass. All elements scale proportionally to canvas dimensions. Global `hudOpacity` applied once per frame via `ctx.globalAlpha`.

### Elements

**1. Corner brackets**
L-shaped amber lines (~40px arms) in all four corners. Static position. Classic SW targeting computer framing.

**2. Targeting reticle**
Three concentric circles with crosshair lines, centred on canvas.
- Outer ring radius: snaps to 1.3× on `beatFlash = 1.0`, exponential decay back to 1.0× over ~80ms.
- Inner dot opacity: pulses with smoothed RMS.

**3. Scanlines**
Horizontal stripes every 4px at ~8% alpha. Always static. CRT screen texture.

**4. Data readouts**
Monospace amber text, ~11px, four positions:

| Position | Content | Dynamic |
|---|---|---|
| Top-left | `BPM: 124` | Updates from detected tempo |
| Top-right | `RMS: 0.72` | Updates each frame |
| Bottom-left | `VEL: 1.4×` | Current scroll speed multiplier |
| Bottom-right | `TGT: LOCK` / `TGT: SCAN` | `LOCK` for ~400ms after beat onset, otherwise `SCAN` |

**5. Radar sweep line**
Single horizontal line travelling top→bottom over ~2 seconds. Resets on each beat onset, creating a pulse-locked sweep feel at higher BPM.

---

## Testing

Pattern follows `PlasmaRenderer.test.ts`. jsdom environment with mock WebGL2 context.

### Constructor
- Creates WebGL2 context; throws descriptive error if unavailable
- Injects overlay canvas as DOM sibling
- Compiles shaders without error

### Lifecycle
- `resize(w, h)` updates both canvases and WebGL viewport
- `destroy()` removes overlay canvas from DOM, calls `loseContext`

### Render
- `render()` with zeroed `AudioFeatures` completes without throwing
- `render()` with full `AudioFeatures` completes without throwing

### Pure function unit tests

Core audio→visual math extracted as pure exported functions, tested without WebGL:

| Function | Assertion |
|---|---|
| `computeScrollDelta(rms, beatOnset, scrollSpeed, dt)` | Correct base + snap contribution |
| `computeBankAngle(smoothedRms, time, bankIntensity)` | Stays within ±(bankIntensity × 25°) |
| `computeWarpAmount(buildupIntensity, warpIntensity)` | 0 below threshold, scales correctly above |
| `computeReticleRadius(beatFlash)` | 1.3 at beatFlash=1.0, 1.0 at beatFlash=0.0 |
