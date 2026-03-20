# Testing Patterns

Lessons learned from writing tests in this codebase.

---

## WebGL stubs must model stateful side-effects

### The pattern

When stubbing a WebGL context, the default approach is to return static mocks:

```typescript
getExtension: jest.fn().mockReturnValue(null),
```

This silently passes tests even when the code under test has destructive side-effects — because the side-effect never executes.

### The bug this missed

`PlasmaRenderer.destroy()` originally called `WEBGL_lose_context.loseContext()`. In the browser this permanently invalidates the canvas's WebGL context: subsequent `canvas.getContext('webgl2')` calls return `null`, making it impossible to rebuild a renderer on the same canvas (triggered, for example, when the user changes the colour scheme).

The static stub (`getExtension → null`) meant `loseContext()` was never invoked in tests. The "destroy does not throw" test passed cleanly. The bug was only found at runtime.

### The fix: stateful stubs

For any API where side-effects change the observable state of the system, use a stateful stub that models those effects:

```typescript
let contextLost = false
const gl = makeGlStub()
gl.getExtension.mockImplementation((name: string) => {
  if (name === 'WEBGL_lose_context') return { loseContext: () => { contextLost = true } }
  return null
})
jest.spyOn(canvas, 'getContext').mockImplementation((id: string) => {
  if (id === 'webgl2') return contextLost ? null : gl as unknown as WebGL2RenderingContext
  return null
})
```

Then write a lifecycle test that exercises the full create → destroy → recreate sequence:

```typescript
it('can be rebuilt on the same canvas after destroy', () => {
  const r1 = new PlasmaRenderer(canvas, config)
  r1.destroy()
  expect(() => new PlasmaRenderer(canvas, config)).not.toThrow()
})
```

### General rule

**Static stubs test that code runs without error. Stateful stubs test that code leaves the system in the right state.**

Ask for each stubbed API: *does calling this method change what future calls return?* If yes, the stub must model that change.

Examples of APIs that need stateful stubs in this codebase:

| API | Side-effect to model |
|---|---|
| `WEBGL_lose_context.loseContext()` | Makes `getContext('webgl2')` return `null` |
| `AudioContext.close()` | Makes subsequent method calls throw |
| `MediaStream.getTracks()[n].stop()` | Changes `track.readyState` to `'ended'` |

---

## Prefer lifecycle tests over unit tests for renderer classes

Renderers have a clear lifecycle: **construct → render (N times) → destroy → optionally reconstruct**. Tests that only cover construction and a single render call miss the most common real-world failure modes, which occur at lifecycle transitions.

Minimum useful test set for any renderer:

- Constructs without throwing (happy path)
- Throws a descriptive error on missing dependency (e.g. no WebGL2)
- `render()` calls the expected draw primitive
- `resize()` updates the viewport
- `destroy()` does not throw
- Can be **rebuilt on the same canvas after destroy** (lifecycle regression)
