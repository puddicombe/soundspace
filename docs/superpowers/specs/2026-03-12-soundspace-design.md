# Soundspace — Design Spec
**Date:** 2026-03-12
**Status:** Approved

---

## Overview

Soundspace is a web application that generates full-screen, real-time audio visualisations driven by the user's microphone or system audio. It is public-facing (anyone can sign up), supports saving and sharing visualisation presets, and is designed to run on Ripper (Docker) behind Diamond's reverse proxy. All audio capture and rendering is client-side — the server handles only identity and persistence.

---

## Goals

- Fullscreen audio visualisations that react to mic/system audio in real time
- User accounts (email + password) to gate access and enable personalisation
- Save, load, and share named visualisation presets via public URL
- Extensible renderer architecture: Canvas 2D (v1) → WebGL/GLSL shaders (v2) → optional CUDA sidecar (v3)
- No server-side audio processing — fully distributed, zero audio latency

---

## Non-Goals (v1)

- OAuth sign-in (email/password only for now)
- Mobile optimisation (desktop-first)
- Social features (follows, likes, feeds)
- Video export or recording
- CUDA / server-side rendering
- Rate limiting / brute-force protection (deferred to v2 — add `express-rate-limit` or middleware at that point)
- Share revocation (un-sharing a preset) — delete the preset to remove its share link in v1
- Preset list pagination — no pagination in v1; add if user preset counts become large

---

## Architecture

```
CLIENT (browser)                         SERVER (Next.js on Ripper)
─────────────────────────────────        ──────────────────────────
Web Audio API (mic capture)              Auth   → NextAuth + PostgreSQL
  └─ AnalyserNode (FFT)                  Presets → CRUD via API routes
       └─ Float32Array (60fps)           Sharing → slug → preset lookup
            └─ BarsRenderer (v1)
            └─ WaveformRenderer (v1)
            └─ [WebGLRenderer] (v2)
```

The server never touches audio data. Each connected browser does its own capture and rendering independently. This keeps latency at zero and scales trivially — server load is driven only by API calls (auth, preset reads/writes).

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | Next.js 14 (App Router, TypeScript) | Full-stack in one project, API routes, easy Docker |
| Auth | NextAuth.js (credentials provider) | Handles sessions, hashing, DB adapter |
| ORM | Prisma | Type-safe DB access, easy migrations |
| Database | PostgreSQL 16 | Reliable, good JSONB support for preset configs |
| Audio | Web Audio API (AnalyserNode) | Native browser, zero dependencies |
| Rendering v1 | Canvas 2D | Simple, universal, fast enough for bars/waveform |
| Rendering v2 | WebGL / GLSL | Client GPU shaders, no server involvement |
| Styling | Tailwind CSS | Fast, consistent, dark-mode-first |
| Slug generation | nanoid | Compact, URL-safe random IDs for share slugs |

---

## Data Model

The full Prisma schema includes the NextAuth adapter models (`Account`, `Session`, `VerificationToken`) alongside the app models. Reference the [NextAuth Prisma adapter docs](https://authjs.dev/reference/adapter/prisma) for the exact adapter model shapes — copy them verbatim. The app-specific models are:

```prisma
model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  presets      Preset[]
  // NextAuth adapter relations (Account, Session) added alongside these
}

model Preset {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  config    Json
  isPublic  Boolean  @default(false)
  shareSlug String?  @unique
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Preset config shape (v1)

Use a discriminated union so type-specific fields are unambiguous:

```ts
type BaseConfig = {
  colorScheme: 'neon-dark' | 'sunset' | 'mono' | 'ocean'
  sensitivity: number       // 0.5 – 3.0; multiplier applied to normalised FFT values before rendering
  fftSize: 512 | 1024 | 2048 | 4096
}

type BarsConfig = BaseConfig & {
  type: 'bars'
  barCount: number          // 32 – 128; must satisfy barCount <= fftSize / 2
  mirrorBars: boolean
}

type WaveformConfig = BaseConfig & {
  type: 'waveform'
}

type PresetConfig = BarsConfig | WaveformConfig
```

**Invariant (`bars` only):** `barCount <= fftSize / 2`. `frequencyBinCount` on `AnalyserNode` equals `fftSize / 2`, so bar counts beyond this silently read zeros. Valid combinations:

| fftSize | max barCount |
|---|---|
| 512 | 256 (cap UI at 128 for usability) |
| 1024 | 512 |
| 2048 | 1024 |
| 4096 | 2048 |

Enforce this constraint both client-side in `ControlPanel` and server-side in the preset API route.

**`sensitivity` application:** `sensitivity` is a multiplier applied to each normalised FFT value (0–1 range) inside `AudioEngine` before the buffer is passed to renderers. `AudioEngine` clamps the result to [0, 1] after multiplication. Renderers receive pre-multiplied data and do not apply sensitivity themselves.

**`colorScheme`** is an enumerated set (not a free string) — validated server-side against the allowed values.

**`name`** — max 80 characters, min 1 character, trimmed. Validated server-side.

**Validation approach:** Use [Zod](https://zod.dev) schemas that mirror the TypeScript types. The same schema is used server-side in API route handlers and can be imported client-side for form validation.

The `config` field is stored as a JSON blob. Adding new visualiser types only requires defining their config shape — no schema migrations needed.

---

## Application Routes

| Route | Auth | Description |
|---|---|---|
| `/` | Required | Main fullscreen visualiser |
| `/signin` | Public | Sign in form |
| `/signup` | Public | Create account |
| `/presets` | Required | Browse and manage your presets |
| `/share/[slug]` | Public | View a shared preset (live, visitor's own mic) |

**Protected route behaviour:** Next.js middleware redirects unauthenticated requests for `/(app)/*` to `/signin?callbackUrl=<original-path>`. On session expiry, the same redirect fires. After successful sign-in, NextAuth redirects to `callbackUrl`.

**Sign-out:** A sign-out button (visible in the nav/controls overlay) calls NextAuth's `signOut()` client function, which hits `/api/auth/signout` and redirects to `/signin`.

**Unknown share slug:** `/share/[slug]` calls Next.js `notFound()` when the slug does not match any row, rendering the standard 404 page. No slug enumeration hints are returned.

---

## API Routes

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/presets` | Required | List current user's presets |
| POST | `/api/presets` | Required | Create a new preset |
| PUT | `/api/presets/[id]` | Required (owner) | Update preset name/config/visibility |
| DELETE | `/api/presets/[id]` | Required (owner) | Delete a preset |
| POST | `/api/presets/[id]/share` | Required (owner) | Generate (or return existing) shareSlug, set `isPublic: true` |
| POST | `/api/presets/[id]/fork` | Required | Copy a public preset to the current user's account |

### Share endpoint detail

`POST /api/presets/[id]/share` — owner only:
- If `shareSlug` already exists, return it (idempotent)
- Otherwise generate a `nanoid(10)` slug, set `isPublic: true`, persist, return `{ slug, url }`

### Fork endpoint detail

`POST /api/presets/[id]/fork` — any authenticated user:
- Load the source preset; verify `isPublic === true` (return 403 otherwise)
- Create a new `Preset` for the current user with the same `name` (prefixed "Fork of …"), same `config`, `isPublic: false`, no `shareSlug`
- Return the new preset

**Note:** The `/share/[slug]` page receives the preset `id` in the server-rendered data (the slug lookup response must include `id`). The Fork button uses this `id` to call `/api/presets/[id]/fork`.

---

## Component Structure

```
app/
├── (auth)/
│   ├── signin/page.tsx
│   └── signup/page.tsx
├── (app)/
│   ├── page.tsx                  ← fullscreen visualiser
│   └── presets/page.tsx
├── share/[slug]/page.tsx
└── api/
    ├── auth/[...nextauth]/route.ts
    └── presets/
        ├── route.ts              ← GET, POST
        └── [id]/
            ├── route.ts          ← PUT, DELETE
            ├── share/route.ts    ← POST (generate slug)
            └── fork/route.ts     ← POST (copy to own account)

components/
├── visualizer/
│   ├── VisualizerCanvas.tsx      ← owns render loop, fullscreen canvas
│   ├── AudioEngine.ts            ← Web Audio API, produces FFT/waveform arrays
│   └── renderers/
│       ├── BaseRenderer.ts       ← interface all renderers implement
│       ├── BarsRenderer.ts       ← Canvas 2D frequency bars
│       └── WaveformRenderer.ts   ← Canvas 2D oscilloscope
├── controls/
│   ├── ControlPanel.tsx          ← slide-out panel for param tweaking
│   └── PresetManager.tsx         ← save / load / share UI
└── ui/                           ← shared: Button, Input, Modal, etc.

lib/
├── db.ts                         ← Prisma client singleton
└── auth.ts                       ← NextAuth config

prisma/
└── schema.prisma
```

### Renderer interface

```ts
interface BaseRenderer {
  render(fftData: Float32Array, waveData: Float32Array): void
  resize(width: number, height: number): void
  destroy(): void
}
```

All renderers (Canvas, WebGL, future CUDA stream consumer) implement this interface. `VisualizerCanvas` holds a reference to the active renderer and calls `render()` on each animation frame. Swapping renderers is a single assignment.

---

## Audio Engine

`AudioEngine.ts` owns the Web Audio API lifecycle:

1. **User gesture gate:** `AudioContext` cannot start without a user gesture. On first load, `VisualizerCanvas` renders a fullscreen "Click to start" overlay. The first click dismisses the overlay and calls `AudioEngine.start()`, satisfying the browser's autoplay policy. If `AudioContext` is in `suspended` state, `AudioEngine.start()` calls `audioContext.resume()` before proceeding.
2. Request mic access (`getUserMedia({ audio: true })`)
3. Create `AudioContext` → connect source → `AnalyserNode`
4. Set `analyser.fftSize` from preset config
5. Allocate `Float32Array` buffers: `new Float32Array(analyser.frequencyBinCount)` for FFT, `new Float32Array(analyser.fftSize)` for waveform
6. On each animation frame: call `analyser.getFloatFrequencyData(fftBuffer)` and `analyser.getFloatTimeDomainData(waveBuffer)`
7. Normalise FFT values from dBFS (−160 to 0) to 0–1: `normalised = (value + 160) / 160`
8. Apply sensitivity multiplier: `processed = clamp(normalised * sensitivity, 0, 1)`
9. Pass processed FFT buffer and raw waveform buffer to the active renderer's `render()` call

Renderers receive pre-processed data and do not apply sensitivity themselves.

**Sensitivity and waveform:** Sensitivity is a frequency-domain concept. When `type === 'waveform'`, the sensitivity slider is hidden in `ControlPanel` and `AudioEngine` passes the waveform buffer unmodified. This is intentional.

**Config changes while running:** When any preset config param changes via `ControlPanel`:
- `colorScheme`, `sensitivity`, `barCount`, `mirrorBars` — applied immediately; no restart needed
- `fftSize` — requires `AudioEngine` teardown and reinitialisation (disconnect nodes, recreate `AnalyserNode` with new `fftSize`, reallocate `Float32Array` buffers). `VisualizerCanvas` calls `audioEngine.restart(newConfig)` when `fftSize` changes.

No audio data leaves the browser.

---

## Sharing

When a user clicks "Share" on a preset:
1. Client calls `POST /api/presets/[id]/share`
2. Server generates (or returns existing) `nanoid(10)` slug, sets `isPublic: true`
3. Client displays the URL: `https://soundspace.indigotide.ai/share/<slug>`

The `/share/[slug]` page:
- Loads the preset config server-side (public read, no auth required)
- Renders the fullscreen visualiser **live against the visitor's own microphone** — visitors get a mic permission prompt just like authenticated users
- Shows a read-only control panel (preset params visible but not editable)
- Shows a "Fork" button — clicking it redirects to `/signin?callbackUrl=/share/<slug>` if not authenticated, otherwise calls `POST /api/presets/[id]/fork` and redirects to `/presets` (the fork is highlighted/selected on arrival)

---

## Auth & Validation

### Password policy (enforced client + server)
- Minimum 8 characters
- At least one letter and one number
- Maximum 72 characters (bcrypt limit)

### Sign-up flow
1. Validate email format and password policy
2. Check email not already registered (return 409 if taken)
3. Hash password with `bcrypt` (cost factor 12)
4. Create `User` record, return `{ success: true }`
5. Client receives success, immediately calls `signIn('credentials', { email, password, redirect: false })` with the submitted credentials — NextAuth creates the session. Client then redirects to `/`.

### Sign-in flow
- NextAuth credentials provider calls `bcrypt.compare`
- On failure: return generic "Invalid email or password" (no enumeration)

---

## Local Development Setup

```bash
# 1. Postgres via Docker (only)
docker run -d \
  --name soundspace-db \
  -e POSTGRES_USER=soundspace \
  -e POSTGRES_PASSWORD=soundspace \
  -e POSTGRES_DB=soundspace \
  -p 5432:5432 \
  postgres:16-alpine

# 2. .env.local
DATABASE_URL=postgresql://soundspace:soundspace@localhost:5432/soundspace
NEXTAUTH_SECRET=dev-secret-change-in-prod
NEXTAUTH_URL=http://localhost:3000

# 3. Run
npm install
npx prisma migrate dev
npm run dev
```

---

## Production Docker Setup (Ripper)

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://soundspace:${POSTGRES_PASSWORD}@db:5432/soundspace
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      NEXTAUTH_URL: ${NEXTAUTH_URL}
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: soundspace
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: soundspace
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U soundspace"]
      interval: 5s
      retries: 5
    restart: unless-stopped

volumes:
  postgres_data:
```

`.env` on Ripper (not committed to git):
```
POSTGRES_PASSWORD=<strong random password>
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=https://soundspace.indigotide.ai
```

### Dockerfile (multi-stage, production-optimised)

Requires `output: 'standalone'` in `next.config.js`.

`NEXTAUTH_SECRET` is **not** required at build time for this setup — it is only read at runtime by NextAuth. Pass it only as a runtime environment variable (via `docker-compose.yml`). Do not add it as a build arg.

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma schema + migrations needed for `prisma migrate deploy` at startup
COPY --from=builder /app/prisma ./prisma
# Prisma CLI and engine binaries needed to run migrations
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
EXPOSE 3000
# Run migrations then start the app
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
```

Note: `prisma` must be listed in `dependencies` (not `devDependencies`) in `package.json` so it is available in production builds.

Diamond reverse proxy → `http://ripper-tailscale-hostname:3000`, TLS via Let's Encrypt, DNS record for `soundspace.indigotide.ai`.

---

## Extensibility Path

| Version | Renderer | Notes |
|---|---|---|
| v1 | Canvas 2D | Bars, waveform — ships now |
| v2 | WebGL / GLSL shaders | Client GPU, reactive cinematic effects |
| v3 | CUDA sidecar (opt-in) | Server-side ML audio analysis, generative AI visuals — additive only, doesn't change core distributed model |

---

## Visual Aesthetic

Dark neon. Black background, vibrant colour accents (cyan, magenta, electric blue). Minimal UI chrome — controls hidden by default, revealed on hover/interaction. Fullscreen is the primary experience.
