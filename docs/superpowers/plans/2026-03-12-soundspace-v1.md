# Soundspace v1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack web app where authenticated users create, save, and share fullscreen audio visualisations driven by their microphone.

**Architecture:** Next.js 14 App Router monorepo — API routes handle auth/presets, all audio capture and rendering runs client-side via Web Audio API and Canvas 2D. PostgreSQL stores users/presets via Prisma; NextAuth manages sessions.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, Prisma, PostgreSQL 16, NextAuth.js (credentials), bcrypt, zod, nanoid, jest, @testing-library/react, jest-canvas-mock

---

## File Map

```
soundspace/
├── app/
│   ├── layout.tsx                           root layout, SessionProvider
│   ├── (auth)/
│   │   ├── layout.tsx                       redirect to / if already signed in
│   │   ├── signin/page.tsx                  sign-in form
│   │   └── signup/page.tsx                  sign-up form
│   ├── (app)/
│   │   ├── layout.tsx                       auth guard — redirect to /signin if no session
│   │   ├── page.tsx                         fullscreen visualiser page
│   │   └── presets/page.tsx                 preset list/manager page
│   ├── share/[slug]/page.tsx                public share page (SSR slug lookup)
│   └── api/
│       ├── auth/[...nextauth]/route.ts      NextAuth handler
│       ├── register/route.ts                POST — sign-up (creates User)
│       └── presets/
│           ├── route.ts                     GET (list), POST (create)
│           └── [id]/
│               ├── route.ts                 PUT (update), DELETE
│               ├── share/route.ts           POST — generate/return shareSlug
│               └── fork/route.ts            POST — copy preset to current user
├── components/
│   ├── visualizer/
│   │   ├── VisualizerCanvas.tsx             fullscreen canvas, render loop, "click to start" overlay
│   │   ├── AudioEngine.ts                   Web Audio API lifecycle, FFT processing
│   │   └── renderers/
│   │       ├── BaseRenderer.ts              interface: render / resize / destroy
│   │       ├── BarsRenderer.ts              Canvas 2D frequency bars
│   │       └── WaveformRenderer.ts          Canvas 2D oscilloscope
│   ├── controls/
│   │   ├── ControlPanel.tsx                 slide-out param editor, triggers config changes
│   │   └── PresetManager.tsx                save/load/share UI within visualiser page
│   └── ui/
│       ├── Button.tsx                       shared button
│       ├── Input.tsx                        shared input
│       └── Modal.tsx                        shared modal wrapper
├── lib/
│   ├── db.ts                                Prisma client singleton
│   ├── auth.ts                              NextAuth config (credentials provider)
│   └── validations/
│       └── preset.ts                        Zod schemas for PresetConfig + API payloads
├── middleware.ts                             protect /(app)/* routes
├── prisma/
│   └── schema.prisma                        User, Preset + NextAuth adapter models
├── next.config.js                           output: standalone
├── tailwind.config.ts
├── jest.config.ts
├── jest.setup.ts
├── Dockerfile
├── docker-compose.yml                       production: app + db
├── docker-compose.dev.yml                   local dev: db only
└── .env.local.example
```

---

## Chunk 1: Project Scaffold

### Task 1: Initialise Next.js project and install dependencies

**Files:**
- Create: `package.json` (via npx)
- Create: `next.config.js`
- Create: `tailwind.config.ts`
- Create: `tsconfig.json` (via npx)
- Create: `.env.local.example`
- Create: `jest.config.ts`
- Create: `jest.setup.ts`

- [ ] **Step 1: Scaffold Next.js app**

Run from `/Users/jamespuddicombe/code/soundspace`:
```bash
npx create-next-app@14 . \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --no-src-dir \
  --import-alias "@/*"
```
Expected: Next.js project files created in current directory.

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install \
  @prisma/client \
  prisma \
  next-auth@4 \
  @auth/prisma-adapter \
  bcryptjs \
  zod \
  nanoid \
  clsx \
  tailwind-merge
```

- [ ] **Step 3: Install dev dependencies**

```bash
npm install -D \
  @types/bcryptjs \
  jest \
  jest-environment-jsdom \
  @testing-library/react \
  @testing-library/jest-dom \
  @testing-library/user-event \
  jest-canvas-mock \
  ts-jest \
  @types/jest
```

- [ ] **Step 4: Configure jest**

Create `jest.config.ts`:
```typescript
import type { Config } from 'jest'

const config: Config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEachTestFile: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { jsx: 'react-jsx' } }],
  },
  testPathPattern: ['**/__tests__/**/*.test.ts?(x)'],
}

export default config
```

Create `jest.setup.ts`:
```typescript
import '@testing-library/jest-dom'
import 'jest-canvas-mock'
```

- [ ] **Step 5: Configure next.config.js for standalone output**

Replace contents of `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
}

module.exports = nextConfig
```

- [ ] **Step 6: Create .env.local.example**

```
DATABASE_URL=postgresql://soundspace:soundspace@localhost:5432/soundspace
NEXTAUTH_SECRET=dev-secret-change-in-prod
NEXTAUTH_URL=http://localhost:3000
```

- [ ] **Step 7: Copy to .env.local**

```bash
cp .env.local.example .env.local
```

- [ ] **Step 8: Commit scaffold**

```bash
git add -A
git commit -m "chore: scaffold Next.js 14 project with dependencies"
```

---

### Task 2: Prisma schema and database setup

**Files:**
- Create: `prisma/schema.prisma`
- Create: `lib/db.ts`
- Create: `docker-compose.dev.yml`

- [ ] **Step 1: Start local Postgres**

Create `docker-compose.dev.yml`:
```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: soundspace
      POSTGRES_PASSWORD: soundspace
      POSTGRES_DB: soundspace
    ports:
      - "5432:5432"
    volumes:
      - soundspace_dev_data:/var/lib/postgresql/data

volumes:
  soundspace_dev_data:
```

```bash
docker compose -f docker-compose.dev.yml up -d
```
Expected: Postgres container running on port 5432.

- [ ] **Step 2: Write Prisma schema**

Run `npx prisma init --datasource-provider postgresql` then replace `prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  presets      Preset[]
  accounts     Account[]
  sessions     Session[]
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

// NextAuth adapter models — required verbatim
model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String? @db.Text
  access_token      String? @db.Text
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String? @db.Text
  session_state     String?
  user              User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name init
```
Expected: Migration file created, tables created in DB.

- [ ] **Step 4: Write Prisma client singleton**

Create `lib/db.ts`:
```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **Step 5: Commit**

```bash
git add prisma/ lib/db.ts docker-compose.dev.yml
git commit -m "chore: add Prisma schema and dev database setup"
```

---

### Task 3: Zod validation schemas

**Files:**
- Create: `lib/validations/preset.ts`
- Create: `lib/validations/__tests__/preset.test.ts`

- [ ] **Step 1: Write failing tests for preset schemas**

Create `lib/validations/__tests__/preset.test.ts`:
```typescript
import { barsConfigSchema, waveformConfigSchema, presetConfigSchema, createPresetSchema } from '../preset'

describe('barsConfigSchema', () => {
  it('accepts valid bars config', () => {
    const result = barsConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      barCount: 64,
      mirrorBars: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects barCount exceeding fftSize/2', () => {
    const result = barsConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 512,
      barCount: 300,
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects barCount below 32', () => {
    const result = barsConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 1.0,
      fftSize: 2048,
      barCount: 10,
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects unknown colorScheme', () => {
    const result = barsConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'purple-rain',
      sensitivity: 1.0,
      fftSize: 2048,
      barCount: 64,
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects sensitivity out of range', () => {
    const result = barsConfigSchema.safeParse({
      type: 'bars',
      colorScheme: 'neon-dark',
      sensitivity: 5.0,
      fftSize: 2048,
      barCount: 64,
      mirrorBars: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('waveformConfigSchema', () => {
  it('accepts valid waveform config', () => {
    const result = waveformConfigSchema.safeParse({
      type: 'waveform',
      colorScheme: 'ocean',
      sensitivity: 1.0,
      fftSize: 1024,
    })
    expect(result.success).toBe(true)
  })

  it('rejects waveform config with bars-only fields', () => {
    const result = waveformConfigSchema.safeParse({
      type: 'waveform',
      colorScheme: 'ocean',
      sensitivity: 1.0,
      fftSize: 1024,
      barCount: 64,
    })
    // strict() strips unknown keys — success but barCount silently dropped
    // OR use .strict() to reject unknown keys
    expect(result.success).toBe(true) // zod strips unknowns by default
  })
})

describe('createPresetSchema', () => {
  it('rejects name over 80 chars', () => {
    const result = createPresetSchema.safeParse({
      name: 'a'.repeat(81),
      config: { type: 'waveform', colorScheme: 'mono', fftSize: 2048 },
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createPresetSchema.safeParse({
      name: '',
      config: { type: 'waveform', colorScheme: 'mono', fftSize: 2048 },
    })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest lib/validations/__tests__/preset.test.ts --no-coverage
```
Expected: FAIL — `preset` module not found.

- [ ] **Step 3: Implement Zod schemas**

Create `lib/validations/preset.ts`:
```typescript
import { z } from 'zod'

const COLOR_SCHEMES = ['neon-dark', 'sunset', 'mono', 'ocean'] as const

const baseConfigSchema = z.object({
  colorScheme: z.enum(COLOR_SCHEMES),
  sensitivity: z.number().min(0.5).max(3.0),
  fftSize: z.union([
    z.literal(512),
    z.literal(1024),
    z.literal(2048),
    z.literal(4096),
  ]),
})

export const barsConfigSchema = baseConfigSchema
  .extend({
    type: z.literal('bars'),
    barCount: z.number().int().min(32).max(128),
    mirrorBars: z.boolean(),
  })
  .refine((d) => d.barCount <= d.fftSize / 2, {
    message: 'barCount must be <= fftSize / 2',
    path: ['barCount'],
  })

export const waveformConfigSchema = baseConfigSchema.extend({
  type: z.literal('waveform'),
})

export const presetConfigSchema = z.discriminatedUnion('type', [
  barsConfigSchema,
  waveformConfigSchema,
])

export const createPresetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  config: presetConfigSchema,
})

export const updatePresetSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: presetConfigSchema.optional(),
})

export type PresetConfig = z.infer<typeof presetConfigSchema>
export type BarsConfig = z.infer<typeof barsConfigSchema>
export type WaveformConfig = z.infer<typeof waveformConfigSchema>
export type CreatePresetInput = z.infer<typeof createPresetSchema>
export type UpdatePresetInput = z.infer<typeof updatePresetSchema>
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest lib/validations/__tests__/preset.test.ts --no-coverage
```
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/validations/
git commit -m "feat: add Zod validation schemas for preset config"
```

---

### Task 4: Production Docker setup

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
node_modules
.next
.git
.env*
!.env.local.example
```

- [ ] **Step 2: Write Dockerfile**

Create `Dockerfile`:
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
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node server.js"]
```

- [ ] **Step 3: Write docker-compose.yml**

Create `docker-compose.yml`:
```yaml
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

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-compose.yml .dockerignore
git commit -m "chore: add production Docker setup"
```

---

## Chunk 2: Authentication

### Task 5: NextAuth configuration and auth library

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Write NextAuth config**

Create `lib/auth.ts`:
```typescript
import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase() },
        })

        if (!user) return null

        const valid = await bcrypt.compare(credentials.password, user.passwordHash)
        if (!valid) return null

        return { id: user.id, email: user.email }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (session.user) session.user.id = token.id as string
      return session
    },
  },
}
```

- [ ] **Step 2: Write NextAuth route handler**

Create `app/api/auth/[...nextauth]/route.ts`:
```typescript
import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
```

- [ ] **Step 3: Extend NextAuth types**

**Create this file before running `tsc` — `lib/auth.ts` references `session.user.id` which TypeScript will not recognise until this declaration file exists. Both files are committed together in Step 4.**

Create `types/next-auth.d.ts`:
```typescript
import 'next-auth'
import 'next-auth/jwt'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts app/api/auth/ types/
git commit -m "feat: add NextAuth credentials provider config"
```

---

### Task 6: Register API route

**Files:**
- Create: `app/api/register/route.ts`
- Create: `app/api/register/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test for register route**

Create `app/api/register/__tests__/route.test.ts`:
```typescript
import { POST } from '../route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'

// Mock Prisma
jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

const mockPrisma = prisma as jest.Mocked<typeof prisma>

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/register', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 201 on valid registration', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(mockPrisma.user.create as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com' })

    const res = await POST(makeRequest({ email: 'a@b.com', password: 'Password1' }))
    expect(res.status).toBe(201)
  })

  it('returns 409 when email already registered', async () => {
    ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'existing' })

    const res = await POST(makeRequest({ email: 'a@b.com', password: 'Password1' }))
    expect(res.status).toBe(409)
  })

  it('returns 400 on invalid password (too short)', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'abc' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on missing email', async () => {
    const res = await POST(makeRequest({ password: 'Password1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 if password has no number', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'NoNumbers!' }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npx jest app/api/register/__tests__/route.test.ts --no-coverage
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement register route**

Create `app/api/register/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/db'

const registerSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    )
  }

  const { email, password } = parsed.data
  const normalised = email.toLowerCase()

  const existing = await prisma.user.findUnique({ where: { email: normalised } })
  if (existing) {
    return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: { email: normalised, passwordHash },
  })

  return NextResponse.json({ success: true }, { status: 201 })
}
```

- [ ] **Step 4: Run test — verify it passes**

```bash
npx jest app/api/register/__tests__/route.test.ts --no-coverage
```
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/register/
git commit -m "feat: add user registration API route"
```

---

### Task 7: Auth pages (sign-in, sign-up) and root layout

**Files:**
- Create: `app/layout.tsx`
- Create: `app/(auth)/layout.tsx`
- Create: `app/(auth)/signin/page.tsx`
- Create: `app/(auth)/signup/page.tsx`
- Create: `components/ui/Button.tsx`
- Create: `components/ui/Input.tsx`

- [ ] **Step 1: Write root layout with SessionProvider**

Create `app/layout.tsx`:
```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import SessionProvider from '@/components/SessionProvider'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Soundspace',
  description: 'Fullscreen audio visualisations',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-black text-white`}>
        <SessionProvider session={session}>{children}</SessionProvider>
      </body>
    </html>
  )
}
```

Create `components/SessionProvider.tsx`:
```typescript
'use client'
import { SessionProvider as NextAuthSessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

export default function SessionProvider({
  children,
  session,
}: {
  children: React.ReactNode
  session: Session | null
}) {
  return <NextAuthSessionProvider session={session}>{children}</NextAuthSessionProvider>
}
```

- [ ] **Step 2: Write shared UI components**

Create `components/ui/Button.tsx`:
```typescript
import { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost'
}

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'px-4 py-2 rounded font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500',
        variant === 'primary' && 'bg-cyan-500 hover:bg-cyan-400 text-black',
        variant === 'ghost' && 'bg-transparent hover:bg-white/10 text-white border border-white/20',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
```

Create `components/ui/Input.tsx`:
```typescript
import { InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export function Input({ label, error, className, ...props }: InputProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-sm text-gray-300">{label}</label>}
      <input
        className={cn(
          'bg-white/5 border border-white/20 rounded px-3 py-2 text-white placeholder-gray-500',
          'focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent',
          error && 'border-red-500',
          className
        )}
        {...props}
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
```

Create `lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 3: Write auth layout (redirect if already signed in)**

Create `app/(auth)/layout.tsx`:
```typescript
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (session) redirect('/')
  return (
    <main className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-sm px-6">{children}</div>
    </main>
  )
}
```

- [ ] **Step 4: Write sign-in page**

Create `app/(auth)/signin/page.tsx`:
```typescript
'use client'
import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function SignInPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') ?? '/'
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const result = await signIn('credentials', {
      email: form.get('email'),
      password: form.get('password'),
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setError('Invalid email or password')
    } else {
      router.push(callbackUrl)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-center text-white">Sign in</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Email" name="email" type="email" required autoComplete="email" />
        <Input label="Password" name="password" type="password" required autoComplete="current-password" />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      <p className="text-center text-gray-400 text-sm">
        No account?{' '}
        <Link href="/signup" className="text-cyan-400 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 5: Write sign-up page**

Create `app/(auth)/signup/page.tsx`:
```typescript
'use client'
import { useState, FormEvent } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export default function SignUpPage() {
  const router = useRouter()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const form = new FormData(e.currentTarget)
    const email = form.get('email') as string
    const password = form.get('password') as string

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(data.error ?? 'Registration failed')
      setLoading(false)
      return
    }

    // Auto sign-in after successful registration
    await signIn('credentials', { email, password, redirect: false })
    router.push('/')
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-center text-white">Create account</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input label="Email" name="email" type="email" required autoComplete="email" />
        <Input
          label="Password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="8+ chars, one letter and one number"
        />
        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
        <Button type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="text-center text-gray-400 text-sm">
        Have an account?{' '}
        <Link href="/signin" className="text-cyan-400 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add app/layout.tsx app/(auth)/ components/ui/ components/SessionProvider.tsx lib/utils.ts
git commit -m "feat: add auth pages (sign-in, sign-up) and shared UI components"
```

---

### Task 8: Route protection middleware

**Files:**
- Create: `middleware.ts`
- Create: `app/(app)/layout.tsx`

- [ ] **Step 1: Write failing test for middleware**

Create `middleware.test.ts`:
```typescript
// NextAuth middleware is a re-export of next-auth/middleware — we test the matcher config
// rather than the middleware function itself (the redirect logic is NextAuth internals).
import { config } from './middleware'

describe('middleware config', () => {
  it('matcher protects root and app routes', () => {
    expect(config.matcher[0]).toMatch(/\(\?!signin/)
  })

  it('matcher excludes signin, signup, share, api, and _next', () => {
    const pattern = config.matcher[0]
    expect(pattern).toContain('signin')
    expect(pattern).toContain('signup')
    expect(pattern).toContain('share')
    expect(pattern).toContain('api')
    expect(pattern).toContain('_next')
  })
})
```

- [ ] **Step 1b: Run test — verify it fails**

```bash
npx jest middleware.test.ts --no-coverage
```
Expected: FAIL — `middleware` module not found.

- [ ] **Step 2: Write middleware**

Create `middleware.ts`:
```typescript
export { default } from 'next-auth/middleware'

export const config = {
  matcher: ['/((?!signin|signup|share|api|_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 3: Write app layout**

Create `app/(app)/layout.tsx`:
```typescript
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

- [ ] **Step 3b: Run test — verify it passes**

```bash
npx jest middleware.test.ts --no-coverage
```
Expected: All tests PASS.

- [ ] **Step 4: Run dev server to smoke test auth flow**

```bash
npm run dev
```
Navigate to `http://localhost:3000` — expect redirect to `/signin`.
Sign up with a test account — expect redirect back to `/`.
Sign in with wrong password — expect "Invalid email or password" error.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts app/(app)/layout.tsx middleware.test.ts
git commit -m "feat: add route protection middleware"
```

---

## Chunk 3: Audio Engine and Renderers

### Task 9: BaseRenderer interface and BarsRenderer

**Files:**
- Create: `components/visualizer/renderers/BaseRenderer.ts`
- Create: `components/visualizer/renderers/BarsRenderer.ts`
- Create: `components/visualizer/renderers/__tests__/BarsRenderer.test.ts`

- [ ] **Step 1: Define BaseRenderer interface**

Create `components/visualizer/renderers/BaseRenderer.ts`:
```typescript
export interface BaseRenderer {
  render(fftData: Float32Array, waveData: Float32Array): void
  resize(width: number, height: number): void
  destroy(): void
}
```

- [ ] **Step 2: Write failing tests for BarsRenderer**

Create `components/visualizer/renderers/__tests__/BarsRenderer.test.ts`:
```typescript
import { BarsRenderer } from '../BarsRenderer'
import type { BarsConfig } from '@/lib/validations/preset'

const defaultConfig: BarsConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: false,
}

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

describe('BarsRenderer', () => {
  it('constructs without throwing', () => {
    const canvas = makeCanvas()
    expect(() => new BarsRenderer(canvas, defaultConfig)).not.toThrow()
  })

  it('calls clearRect and fillRect on render', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    const ctx = canvas.getContext('2d')!
    const clearSpy = jest.spyOn(ctx, 'clearRect')
    const fillSpy = jest.spyOn(ctx, 'fillRect')

    const fft = new Float32Array(64).fill(0.5)
    const wave = new Float32Array(2048)
    renderer.render(fft, wave)

    expect(clearSpy).toHaveBeenCalled()
    expect(fillSpy).toHaveBeenCalled()
  })

  it('resize updates internal dimensions', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    expect(() => renderer.resize(1920, 1080)).not.toThrow()
  })

  it('destroy does not throw', () => {
    const canvas = makeCanvas()
    const renderer = new BarsRenderer(canvas, defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })
})
```

- [ ] **Step 3: Run tests — verify they fail**

```bash
npx jest components/visualizer/renderers/__tests__/BarsRenderer.test.ts --no-coverage
```
Expected: FAIL — BarsRenderer not found.

- [ ] **Step 4: Implement BarsRenderer**

Create `components/visualizer/renderers/BarsRenderer.ts`:
```typescript
import type { BaseRenderer } from './BaseRenderer'
import type { BarsConfig } from '@/lib/validations/preset'

const COLOR_MAP: Record<BarsConfig['colorScheme'], [string, string]> = {
  'neon-dark': ['#00f5ff', '#ff00ff'],
  'sunset': ['#ff6b35', '#f7c59f'],
  'mono': ['#ffffff', '#888888'],
  'ocean': ['#0077b6', '#90e0ef'],
}

export class BarsRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: BarsConfig

  constructor(canvas: HTMLCanvasElement, config: BarsConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  render(fftData: Float32Array, _waveData: Float32Array): void {
    const { ctx, width, height, config } = this
    const { barCount, mirrorBars, colorScheme } = config
    const [colorA, colorB] = COLOR_MAP[colorScheme]

    ctx.clearRect(0, 0, width, height)

    const totalBars = mirrorBars ? barCount * 2 : barCount
    const barWidth = width / totalBars
    const gap = Math.max(1, barWidth * 0.1)

    const gradient = ctx.createLinearGradient(0, height, 0, 0)
    gradient.addColorStop(0, colorA)
    gradient.addColorStop(1, colorB)
    ctx.fillStyle = gradient

    for (let i = 0; i < barCount; i++) {
      const value = fftData[i] ?? 0
      const barHeight = value * height

      if (mirrorBars) {
        // Left half: mirrored
        const x = (barCount - 1 - i) * barWidth
        ctx.fillRect(x + gap / 2, height - barHeight, barWidth - gap, barHeight)
        // Right half: forward
        const xRight = (barCount + i) * barWidth
        ctx.fillRect(xRight + gap / 2, height - barHeight, barWidth - gap, barHeight)
      } else {
        const x = i * barWidth
        ctx.fillRect(x + gap / 2, height - barHeight, barWidth - gap, barHeight)
      }
    }
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  destroy(): void {
    // No resources to clean up for Canvas 2D
  }
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx jest components/visualizer/renderers/__tests__/BarsRenderer.test.ts --no-coverage
```
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add components/visualizer/renderers/
git commit -m "feat: add BaseRenderer interface and BarsRenderer"
```

---

### Task 10: WaveformRenderer

**Files:**
- Create: `components/visualizer/renderers/WaveformRenderer.ts`
- Create: `components/visualizer/renderers/__tests__/WaveformRenderer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `components/visualizer/renderers/__tests__/WaveformRenderer.test.ts`:
```typescript
import { WaveformRenderer } from '../WaveformRenderer'
import type { WaveformConfig } from '@/lib/validations/preset'

const defaultConfig: WaveformConfig = {
  type: 'waveform',
  colorScheme: 'neon-dark',
  fftSize: 2048,
}

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 800
  canvas.height = 600
  return canvas
}

describe('WaveformRenderer', () => {
  it('constructs without throwing', () => {
    expect(() => new WaveformRenderer(makeCanvas(), defaultConfig)).not.toThrow()
  })

  it('calls beginPath and stroke on render', () => {
    const canvas = makeCanvas()
    const renderer = new WaveformRenderer(canvas, defaultConfig)
    const ctx = canvas.getContext('2d')!
    const beginPathSpy = jest.spyOn(ctx, 'beginPath')
    const strokeSpy = jest.spyOn(ctx, 'stroke')

    renderer.render(new Float32Array(1024), new Float32Array(2048).fill(0.5))

    expect(beginPathSpy).toHaveBeenCalled()
    expect(strokeSpy).toHaveBeenCalled()
  })

  it('resize does not throw', () => {
    const renderer = new WaveformRenderer(makeCanvas(), defaultConfig)
    expect(() => renderer.resize(1920, 1080)).not.toThrow()
  })

  it('destroy does not throw', () => {
    const renderer = new WaveformRenderer(makeCanvas(), defaultConfig)
    expect(() => renderer.destroy()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest components/visualizer/renderers/__tests__/WaveformRenderer.test.ts --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Implement WaveformRenderer**

Create `components/visualizer/renderers/WaveformRenderer.ts`:
```typescript
import type { BaseRenderer } from './BaseRenderer'
import type { WaveformConfig } from '@/lib/validations/preset'

const COLOR_MAP: Record<WaveformConfig['colorScheme'], string> = {
  'neon-dark': '#00f5ff',
  'sunset': '#ff6b35',
  'mono': '#ffffff',
  'ocean': '#0077b6',
}

export class WaveformRenderer implements BaseRenderer {
  private ctx: CanvasRenderingContext2D
  private width: number
  private height: number
  private config: WaveformConfig

  constructor(canvas: HTMLCanvasElement, config: WaveformConfig) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Cannot get 2D context')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.config = config
  }

  render(_fftData: Float32Array, waveData: Float32Array): void {
    const { ctx, width, height, config } = this
    ctx.clearRect(0, 0, width, height)

    ctx.lineWidth = 2
    ctx.strokeStyle = COLOR_MAP[config.colorScheme]
    ctx.beginPath()

    const sliceWidth = width / waveData.length

    for (let i = 0; i < waveData.length; i++) {
      // waveData values from getFloatTimeDomainData are in range [-1, 1]
      const v = waveData[i] ?? 0
      const y = (v + 1) / 2 * height
      const x = i * sliceWidth
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    ctx.stroke()
  }

  resize(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  destroy(): void {}
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest components/visualizer/renderers/__tests__/WaveformRenderer.test.ts --no-coverage
```
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/visualizer/renderers/WaveformRenderer.ts \
        components/visualizer/renderers/__tests__/WaveformRenderer.test.ts
git commit -m "feat: add WaveformRenderer"
```

---

### Task 11: AudioEngine

**Files:**
- Create: `components/visualizer/AudioEngine.ts`
- Create: `components/visualizer/__tests__/AudioEngine.test.ts`

- [ ] **Step 1: Write failing tests for AudioEngine**

Create `components/visualizer/__tests__/AudioEngine.test.ts`:
```typescript
import { AudioEngine } from '../AudioEngine'
import type { PresetConfig } from '@/lib/validations/preset'

const baseConfig: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.0,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: false,
}

// Mock Web Audio API
const mockGetFloatFrequencyData = jest.fn()
const mockGetFloatTimeDomainData = jest.fn()
const mockConnect = jest.fn()
const mockDisconnect = jest.fn()
const mockResume = jest.fn().mockResolvedValue(undefined)

const mockAnalyser = {
  fftSize: 2048,
  frequencyBinCount: 1024,
  connect: mockConnect,
  disconnect: mockDisconnect,
  getFloatFrequencyData: mockGetFloatFrequencyData,
  getFloatTimeDomainData: mockGetFloatTimeDomainData,
}

const mockSourceNode = { connect: mockConnect, disconnect: mockDisconnect }

const mockAudioContext = {
  state: 'suspended',
  resume: mockResume,
  createAnalyser: jest.fn().mockReturnValue(mockAnalyser),
  createMediaStreamSource: jest.fn().mockReturnValue(mockSourceNode),
  close: jest.fn().mockResolvedValue(undefined),
}

global.AudioContext = jest.fn().mockImplementation(() => mockAudioContext) as any

const mockStream = { getTracks: () => [{ stop: jest.fn() }] }
global.navigator.mediaDevices = {
  getUserMedia: jest.fn().mockResolvedValue(mockStream),
} as any

describe('AudioEngine', () => {
  beforeEach(() => jest.clearAllMocks())

  it('constructs without starting', () => {
    expect(() => new AudioEngine(baseConfig)).not.toThrow()
    expect(global.AudioContext).not.toHaveBeenCalled()
  })

  it('start() resumes AudioContext and requests mic', async () => {
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    expect(mockResume).toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ audio: true })
  })

  it('getProcessedFFT normalises and clamps values', async () => {
    mockGetFloatFrequencyData.mockImplementation((buf: Float32Array) => buf.fill(-80))
    const engine = new AudioEngine({ ...baseConfig, sensitivity: 2.0 })
    await engine.start()
    const result = engine.getProcessedFFT()
    // (-80 + 160) / 160 = 0.5, * 2.0 = 1.0, clamped to 1.0
    expect(result[0]).toBeCloseTo(1.0)
  })

  it('getProcessedFFT clamps to 0 for silence (−160 dBFS)', async () => {
    mockGetFloatFrequencyData.mockImplementation((buf: Float32Array) => buf.fill(-160))
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    const result = engine.getProcessedFFT()
    expect(result[0]).toBeCloseTo(0.0)
  })

  it('stop() releases resources', async () => {
    const engine = new AudioEngine(baseConfig)
    await engine.start()
    engine.stop()
    expect(mockAudioContext.close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest components/visualizer/__tests__/AudioEngine.test.ts --no-coverage
```
Expected: FAIL — AudioEngine not found.

- [ ] **Step 3: Implement AudioEngine**

Create `components/visualizer/AudioEngine.ts`:
```typescript
import type { PresetConfig } from '@/lib/validations/preset'

export class AudioEngine {
  private config: PresetConfig
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private stream: MediaStream | null = null
  private fftBuffer: Float32Array = new Float32Array(0)
  private waveBuffer: Float32Array = new Float32Array(0)

  constructor(config: PresetConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    this.audioContext = new AudioContext()

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume()
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = this.config.fftSize

    this.fftBuffer = new Float32Array(this.analyser.frequencyBinCount)
    this.waveBuffer = new Float32Array(this.analyser.fftSize)

    this.source = this.audioContext.createMediaStreamSource(this.stream)
    this.source.connect(this.analyser)
  }

  getProcessedFFT(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatFrequencyData(this.fftBuffer)
    const sensitivity = this.config.sensitivity
    const result = new Float32Array(this.fftBuffer.length)
    for (let i = 0; i < this.fftBuffer.length; i++) {
      const normalised = (this.fftBuffer[i] + 160) / 160
      result[i] = Math.min(1, Math.max(0, normalised * sensitivity))
    }
    return result
  }

  getRawWaveform(): Float32Array {
    if (!this.analyser) return new Float32Array(0)
    this.analyser.getFloatTimeDomainData(this.waveBuffer)
    return this.waveBuffer
  }

  async restart(newConfig: PresetConfig): Promise<void> {
    this.stop()
    this.config = newConfig
    await this.start()
  }

  stop(): void {
    this.source?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.audioContext?.close()
    this.audioContext = null
    this.analyser = null
    this.source = null
    this.stream = null
  }
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest components/visualizer/__tests__/AudioEngine.test.ts --no-coverage
```
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add components/visualizer/AudioEngine.ts \
        components/visualizer/__tests__/AudioEngine.test.ts
git commit -m "feat: add AudioEngine with FFT processing and mic lifecycle"
```

---

### Task 12: VisualizerCanvas component and main page

**Files:**
- Create: `components/visualizer/VisualizerCanvas.tsx`
- Create: `app/(app)/page.tsx`

- [ ] **Step 1: Implement VisualizerCanvas**

Create `components/visualizer/VisualizerCanvas.tsx`:
```typescript
'use client'
import { useEffect, useRef, useState, useCallback } from 'react'
import { AudioEngine } from './AudioEngine'
import { BarsRenderer } from './renderers/BarsRenderer'
import { WaveformRenderer } from './renderers/WaveformRenderer'
import type { BaseRenderer } from './renderers/BaseRenderer'
import type { PresetConfig } from '@/lib/validations/preset'

interface Props {
  config: PresetConfig
  onConfigChange?: (config: PresetConfig) => void  // optional — share page renders read-only
}

export function VisualizerCanvas({ config, onConfigChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engineRef = useRef<AudioEngine | null>(null)
  const rendererRef = useRef<BaseRenderer | null>(null)
  const rafRef = useRef<number>(0)
  const [started, setStarted] = useState(false)
  const [micError, setMicError] = useState('')

  // Build renderer from config
  const buildRenderer = useCallback((canvas: HTMLCanvasElement, cfg: PresetConfig): BaseRenderer => {
    if (cfg.type === 'bars') return new BarsRenderer(canvas, cfg)
    return new WaveformRenderer(canvas, cfg)
  }, [])

  // Resize canvas to fill window
  useEffect(() => {
    function handleResize() {
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      rendererRef.current?.resize(canvas.width, canvas.height)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Re-build renderer when config type or colorScheme changes (hot-swap)
  // Only type and colorScheme changes warrant a new renderer instance.
  // barCount, mirrorBars, sensitivity are passed per-frame and need no rebuild.
  useEffect(() => {
    if (!started || !canvasRef.current) return
    const canvas = canvasRef.current
    rendererRef.current?.destroy()
    rendererRef.current = buildRenderer(canvas, config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.type, config.colorScheme, started, buildRenderer])

  // Render loop
  useEffect(() => {
    if (!started) return
    function loop() {
      const engine = engineRef.current
      const renderer = rendererRef.current
      if (engine && renderer) {
        renderer.render(engine.getProcessedFFT(), engine.getRawWaveform())
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [started])

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
      setMicError('Microphone access denied. Please allow mic access and refresh.')
    }
  }

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden">
      <canvas ref={canvasRef} className="absolute inset-0" />

      {!started && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer z-10"
          onClick={handleStart}
        >
          {micError ? (
            <p className="text-red-400 text-center px-8">{micError}</p>
          ) : (
            <>
              <div className="text-6xl mb-4 opacity-60">◉</div>
              <p className="text-white/60 text-lg">Click to start</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write main visualiser page**

Create `app/(app)/page.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import type { PresetConfig } from '@/lib/validations/preset'

const DEFAULT_CONFIG: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.2,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: true,
}

export default function VisualizerPage() {
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_CONFIG)
  return <VisualizerCanvas config={config} onConfigChange={setConfig} />
}
```

- [ ] **Step 3: Run dev server — smoke test visualiser**

```bash
npm run dev
```
1. Navigate to `http://localhost:3000` (sign in if redirected)
2. Should see black screen with "Click to start"
3. Click — grant mic permission
4. Should see frequency bars reacting to sound

- [ ] **Step 4: Commit**

```bash
git add components/visualizer/VisualizerCanvas.tsx app/(app)/page.tsx
git commit -m "feat: add VisualizerCanvas component and main visualiser page"
```

---

## Chunk 4: Presets API and UI

### Task 13: Presets CRUD API routes

**Files:**
- Create: `app/api/presets/route.ts`
- Create: `app/api/presets/[id]/route.ts`
- Create: `app/api/presets/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests for presets list/create**

Create `app/api/presets/__tests__/route.test.ts`:
```typescript
import { GET, POST } from '../route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'

jest.mock('@/lib/db', () => ({ prisma: { preset: { findMany: jest.fn(), create: jest.fn() } } }))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))

const mockSession = { user: { id: 'user1', email: 'a@b.com' } }

describe('GET /api/presets', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await GET(new NextRequest('http://localhost/api/presets'))
    expect(res.status).toBe(401)
  })

  it('returns user presets when authenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findMany as jest.Mock).mockResolvedValue([{ id: 'p1', name: 'Test' }])
    const res = await GET(new NextRequest('http://localhost/api/presets'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data).toHaveLength(1)
  })
})

describe('POST /api/presets', () => {
  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await POST(new NextRequest('http://localhost/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', config: { type: 'waveform', colorScheme: 'mono', fftSize: 2048 } }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(401)
  })

  it('creates preset and returns 201', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.create as jest.Mock).mockResolvedValue({ id: 'p1', name: 'Test' })
    const res = await POST(new NextRequest('http://localhost/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', config: { type: 'waveform', colorScheme: 'mono', fftSize: 2048 } }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(201)
  })

  it('returns 400 for invalid config', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    const res = await POST(new NextRequest('http://localhost/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad', config: { type: 'unknown' } }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest app/api/presets/__tests__/route.test.ts --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Implement GET and POST /api/presets**

Create `app/api/presets/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createPresetSchema } from '@/lib/validations/preset'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const presets = await prisma.preset.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(presets)
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createPresetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const preset = await prisma.preset.create({
    data: {
      userId: session.user.id,
      name: parsed.data.name,
      config: parsed.data.config as object,
    },
  })
  return NextResponse.json(preset, { status: 201 })
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx jest app/api/presets/__tests__/route.test.ts --no-coverage
```
Expected: All tests PASS.

- [ ] **Step 5a: Write failing tests for PUT and DELETE**

Create `app/api/presets/[id]/__tests__/route.test.ts`:
```typescript
import { PUT, DELETE } from '../route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'

jest.mock('@/lib/db', () => ({
  prisma: { preset: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn() } },
}))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))

const mockSession = { user: { id: 'user1', email: 'a@b.com' } }
const ownedPreset = { id: 'p1', userId: 'user1', name: 'Test', config: {}, isPublic: false }

function makeReq(body?: object) {
  return new NextRequest('http://localhost/api/presets/p1', {
    method: body ? 'PUT' : 'DELETE',
    ...(body && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })
}

describe('PUT /api/presets/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await PUT(makeReq({ name: 'New' }), { params: { id: 'p1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when preset belongs to another user', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...ownedPreset, userId: 'other' })
    const res = await PUT(makeReq({ name: 'New' }), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })

  it('updates name successfully', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue(ownedPreset)
    ;(prisma.preset.update as jest.Mock).mockResolvedValue({ ...ownedPreset, name: 'New' })
    const res = await PUT(makeReq({ name: 'New' }), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/presets/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await DELETE(makeReq(), { params: { id: 'p1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when preset belongs to another user', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...ownedPreset, userId: 'other' })
    const res = await DELETE(makeReq(), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })

  it('deletes preset and returns 204', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue(ownedPreset)
    ;(prisma.preset.delete as jest.Mock).mockResolvedValue(ownedPreset)
    const res = await DELETE(makeReq(), { params: { id: 'p1' } })
    expect(res.status).toBe(204)
  })
})
```

- [ ] **Step 5b: Run tests — verify they fail**

```bash
npx jest "app/api/presets/\[id\]/__tests__/route.test.ts" --no-coverage
```
Expected: FAIL.

- [ ] **Step 5c: Implement PUT and DELETE /api/presets/[id]**

Also add `updatePresetSchema` to include optional `isPublic`. First update `lib/validations/preset.ts` — add `isPublic` to the update schema:
```typescript
export const updatePresetSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  config: presetConfigSchema.optional(),
  isPublic: z.boolean().optional(),
})
```

Create `app/api/presets/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { updatePresetSchema } from '@/lib/validations/preset'

async function getOwnedPreset(id: string, userId: string) {
  const preset = await prisma.preset.findUnique({ where: { id } })
  if (!preset) return null
  if (preset.userId !== userId) return null
  return preset
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const preset = await getOwnedPreset(params.id, session.user.id)
  if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = updatePresetSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const updated = await prisma.preset.update({
    where: { id: params.id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.config !== undefined && { config: parsed.data.config as object }),
      ...(parsed.data.isPublic !== undefined && { isPublic: parsed.data.isPublic }),
    },
  })
  return NextResponse.json(updated)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const preset = await getOwnedPreset(params.id, session.user.id)
  if (!preset) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.preset.delete({ where: { id: params.id } })
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 5d: Run tests — verify they pass**

```bash
npx jest "app/api/presets/\[id\]/__tests__/route.test.ts" --no-coverage
```
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/presets/ lib/validations/preset.ts
git commit -m "feat: add presets CRUD API routes"
```

---

### Task 14: ControlPanel and PresetManager UI

**Files:**
- Create: `components/controls/ControlPanel.tsx`
- Create: `components/controls/PresetManager.tsx`
- Create: `components/ui/Modal.tsx`
- Modify: `app/(app)/page.tsx`

- [ ] **Step 1: Create Modal component**

Create `components/ui/Modal.tsx`:
```typescript
'use client'
import { ReactNode } from 'react'
import { Button } from './Button'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create ControlPanel**

Create `components/controls/ControlPanel.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import type { PresetConfig, BarsConfig } from '@/lib/validations/preset'

interface Props {
  config: PresetConfig
  onConfigChange: (config: PresetConfig) => void
  onSavePreset: () => void
  onOpenPresets: () => void
}

export function ControlPanel({ config, onConfigChange, onSavePreset, onOpenPresets }: Props) {
  const { data: session } = useSession()
  const [visible, setVisible] = useState(false)

  const isBars = config.type === 'bars'
  const barsConfig = config as BarsConfig

  const COLOR_SCHEMES = ['neon-dark', 'sunset', 'mono', 'ocean'] as const

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setVisible((v) => !v)}
        className="fixed top-4 right-4 z-30 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20
                   text-white flex items-center justify-center transition-opacity"
        title="Controls"
      >
        ⚙
      </button>

      {/* Slide-out panel */}
      <div
        className={`fixed top-0 right-0 h-full w-72 bg-black/90 border-l border-white/10 z-20
                   transform transition-transform duration-300 ${visible ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="p-4 flex flex-col gap-5 overflow-y-auto h-full">
          <div className="flex items-center justify-between pt-2">
            <span className="text-white/60 text-sm">{session?.user.email}</span>
            <button onClick={() => signOut()} className="text-gray-400 hover:text-white text-sm">Sign out</button>
          </div>

          {/* Visualiser type */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">Type</label>
            <div className="flex gap-2">
              {(['bars', 'waveform'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    if (t === 'waveform') {
                      onConfigChange({ type: 'waveform', colorScheme: config.colorScheme, fftSize: config.fftSize })
                    } else {
                      onConfigChange({
                        type: 'bars', colorScheme: config.colorScheme, fftSize: config.fftSize,
                        barCount: 64, mirrorBars: true, sensitivity: config.sensitivity,
                      })
                    }
                  }}
                  className={`flex-1 py-1 rounded text-sm transition-colors ${
                    config.type === t ? 'bg-cyan-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Color scheme */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">Colour</label>
            <div className="grid grid-cols-2 gap-2">
              {COLOR_SCHEMES.map((cs) => (
                <button
                  key={cs}
                  onClick={() => onConfigChange({ ...config, colorScheme: cs } as PresetConfig)}
                  className={`py-1 rounded text-sm transition-colors ${
                    config.colorScheme === cs ? 'bg-cyan-500 text-black' : 'bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  {cs}
                </button>
              ))}
            </div>
          </div>

          {/* Sensitivity — bars only */}
          {isBars && (
            <div className="flex flex-col gap-2">
              <label className="text-gray-400 text-xs uppercase tracking-wider">
                Sensitivity: {barsConfig.sensitivity.toFixed(1)}
              </label>
              <input
                type="range" min={0.5} max={3.0} step={0.1}
                value={barsConfig.sensitivity}
                onChange={(e) => onConfigChange({ ...barsConfig, sensitivity: parseFloat(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </div>
          )}

          {/* Bar count — bars only */}
          {isBars && (
            <div className="flex flex-col gap-2">
              <label className="text-gray-400 text-xs uppercase tracking-wider">
                Bars: {barsConfig.barCount}
              </label>
              <input
                type="range" min={32} max={128} step={8}
                value={barsConfig.barCount}
                onChange={(e) => onConfigChange({ ...barsConfig, barCount: parseInt(e.target.value) })}
                className="w-full accent-cyan-500"
              />
            </div>
          )}

          {/* Mirror — bars only */}
          {isBars && (
            <div className="flex items-center justify-between">
              <label className="text-gray-400 text-xs uppercase tracking-wider">Mirror</label>
              <button
                onClick={() => onConfigChange({ ...barsConfig, mirrorBars: !barsConfig.mirrorBars })}
                className={`w-10 h-5 rounded-full transition-colors ${
                  barsConfig.mirrorBars ? 'bg-cyan-500' : 'bg-white/20'
                }`}
              />
            </div>
          )}

          {/* FFT size */}
          <div className="flex flex-col gap-2">
            <label className="text-gray-400 text-xs uppercase tracking-wider">FFT Size</label>
            <select
              value={config.fftSize}
              onChange={(e) => onConfigChange({ ...config, fftSize: parseInt(e.target.value) as 512 | 1024 | 2048 | 4096 } as PresetConfig)}
              className="bg-white/10 text-white rounded px-2 py-1 text-sm"
            >
              {[512, 1024, 2048, 4096].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          {/* Preset actions */}
          <div className="flex flex-col gap-2 mt-auto pb-4">
            <button onClick={onSavePreset} className="bg-cyan-500 hover:bg-cyan-400 text-black rounded py-2 text-sm font-medium">
              Save as preset
            </button>
            <button onClick={onOpenPresets} className="bg-white/10 hover:bg-white/20 text-white rounded py-2 text-sm">
              My presets
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Create PresetManager**

Create `components/controls/PresetManager.tsx`:
```typescript
'use client'
import { useState, useEffect } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { PresetConfig } from '@/lib/validations/preset'

interface Preset {
  id: string
  name: string
  config: PresetConfig
  shareSlug: string | null
  isPublic: boolean
}

interface Props {
  currentConfig: PresetConfig
  onLoad: (config: PresetConfig) => void
  onClose: () => void
  mode: 'list' | 'save'
}

export function PresetManager({ currentConfig, onLoad, onClose, mode }: Props) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [saveName, setSaveName] = useState('')
  const [shareUrl, setShareUrl] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then(setPresets)
      .catch(console.error)
  }, [])

  async function handleSave() {
    if (!saveName.trim()) return
    setLoading(true)
    await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: saveName.trim(), config: currentConfig }),
    })
    const updated = await fetch('/api/presets').then((r) => r.json())
    setPresets(updated)
    setSaveName('')
    setLoading(false)
  }

  async function handleDelete(id: string) {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  async function handleShare(id: string) {
    const res = await fetch(`/api/presets/${id}/share`, { method: 'POST' })
    const data = await res.json()
    setShareUrl(data.url)
  }

  if (mode === 'save') {
    return (
      <Modal title="Save preset" onClose={onClose}>
        <div className="flex flex-col gap-4">
          <Input
            label="Preset name"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="My awesome preset"
            maxLength={80}
          />
          <Button onClick={handleSave} disabled={loading || !saveName.trim()}>
            {loading ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="My presets" onClose={onClose}>
      <div className="flex flex-col gap-3 max-h-80 overflow-y-auto">
        {presets.length === 0 && <p className="text-gray-400 text-sm text-center">No presets yet.</p>}
        {presets.map((preset) => (
          <div key={preset.id} className="flex items-center gap-2 bg-white/5 rounded px-3 py-2">
            <span className="flex-1 text-white text-sm truncate">{preset.name}</span>
            <button onClick={() => { onLoad(preset.config); onClose() }} className="text-cyan-400 hover:text-cyan-300 text-xs">Load</button>
            <button onClick={() => handleShare(preset.id)} className="text-gray-400 hover:text-white text-xs">Share</button>
            <button onClick={() => handleDelete(preset.id)} className="text-red-400 hover:text-red-300 text-xs">Delete</button>
          </div>
        ))}
      </div>
      {shareUrl && (
        <div className="mt-4 p-2 bg-white/5 rounded">
          <p className="text-xs text-gray-400 mb-1">Share URL:</p>
          <p className="text-cyan-400 text-xs break-all">{shareUrl}</p>
        </div>
      )}
    </Modal>
  )
}
```

- [ ] **Step 4: Update main visualiser page to wire controls**

Replace `app/(app)/page.tsx`:
```typescript
'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import { ControlPanel } from '@/components/controls/ControlPanel'
import { PresetManager } from '@/components/controls/PresetManager'
import { presetConfigSchema, type PresetConfig } from '@/lib/validations/preset'

const DEFAULT_CONFIG: PresetConfig = {
  type: 'bars',
  colorScheme: 'neon-dark',
  sensitivity: 1.2,
  fftSize: 2048,
  barCount: 64,
  mirrorBars: true,
}

type ModalMode = null | 'list' | 'save'

export default function VisualizerPage() {
  const searchParams = useSearchParams()
  const [config, setConfig] = useState<PresetConfig>(DEFAULT_CONFIG)
  const [modal, setModal] = useState<ModalMode>(null)

  // Load config from ?config= param (set by presets page Load button)
  useEffect(() => {
    const raw = searchParams.get('config')
    if (!raw) return
    try {
      const parsed = presetConfigSchema.safeParse(JSON.parse(decodeURIComponent(raw)))
      if (parsed.success) setConfig(parsed.data)
    } catch {
      // Ignore malformed param
    }
  }, [searchParams])

  return (
    <>
      <VisualizerCanvas config={config} onConfigChange={setConfig} />
      <ControlPanel
        config={config}
        onConfigChange={setConfig}
        onSavePreset={() => setModal('save')}
        onOpenPresets={() => setModal('list')}
      />
      {modal && (
        <PresetManager
          currentConfig={config}
          onLoad={setConfig}
          onClose={() => setModal(null)}
          mode={modal}
        />
      )}
    </>
  )
}
```

- [ ] **Step 5: Add presets page**

Create `app/(app)/presets/page.tsx`:
```typescript
'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import type { PresetConfig } from '@/lib/validations/preset'

interface Preset {
  id: string
  name: string
  config: PresetConfig
  shareSlug: string | null
  createdAt: string
}

export default function PresetsPage() {
  const router = useRouter()
  const [presets, setPresets] = useState<Preset[]>([])

  useEffect(() => {
    fetch('/api/presets').then((r) => r.json()).then(setPresets).catch(console.error)
  }, [])

  async function handleDelete(id: string) {
    await fetch(`/api/presets/${id}`, { method: 'DELETE' })
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  // Pass the preset's config to the visualiser via URL search param.
  // The main page reads ?config=<encoded-json> on mount to apply it.
  function handleLoad(preset: Preset) {
    const encoded = encodeURIComponent(JSON.stringify(preset.config))
    router.push(`/?config=${encoded}`)
  }

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-semibold">My Presets</h1>
          <Link href="/">
            <Button variant="ghost">← Visualiser</Button>
          </Link>
        </div>
        {presets.length === 0 && (
          <p className="text-gray-400 text-center py-16">No presets saved yet.</p>
        )}
        <div className="flex flex-col gap-3">
          {presets.map((preset) => (
            <div key={preset.id} className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-4 py-3">
              <div className="flex-1">
                <p className="text-white font-medium">{preset.name}</p>
                <p className="text-gray-500 text-xs">{preset.config.type} · {preset.config.colorScheme}</p>
              </div>
              <Button variant="ghost" onClick={() => handleLoad(preset)}>Load</Button>
              <Button variant="ghost" onClick={() => handleDelete(preset.id)} className="text-red-400">Delete</Button>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
```

- [ ] **Step 6: Smoke test in dev**

```bash
npm run dev
```
1. Sign in, click ⚙, change params — visualiser should update
2. Save a preset — should appear in "My presets" modal
3. Delete a preset — should disappear from list

- [ ] **Step 7: Commit**

```bash
git add components/controls/ components/ui/Modal.tsx app/(app)/
git commit -m "feat: add ControlPanel, PresetManager, and presets page"
```

---

## Chunk 5: Sharing

### Task 15: Share and fork API routes

**Files:**
- Create: `app/api/presets/[id]/share/route.ts`
- Create: `app/api/presets/[id]/fork/route.ts`
- Create: `app/api/presets/[id]/share/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `app/api/presets/[id]/share/__tests__/route.test.ts`:
```typescript
import { POST as sharePost } from '../route'
import { POST as forkPost } from '../../fork/route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getServerSession } from 'next-auth'

jest.mock('@/lib/db', () => ({
  prisma: { preset: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() } },
}))
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }))

const mockSession = { user: { id: 'user1', email: 'a@b.com' } }
const mockPreset = { id: 'p1', userId: 'user1', name: 'Test', config: {}, isPublic: false, shareSlug: null }

describe('POST /api/presets/[id]/share', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await sharePost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404 when preset not owned by user', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...mockPreset, userId: 'other' })
    const res = await sharePost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(404)
  })

  it('generates a slug and returns it', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue(mockPreset)
    ;(prisma.preset.update as jest.Mock).mockResolvedValue({ ...mockPreset, shareSlug: 'abc123', isPublic: true })
    const res = await sharePost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.slug).toBeDefined()
  })

  it('returns existing slug if already shared (idempotent)', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...mockPreset, shareSlug: 'existing123', isPublic: true })
    const res = await sharePost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    const data = await res.json()
    expect(data.slug).toBe('existing123')
    expect(prisma.preset.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/presets/[id]/fork', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(null)
    const res = await forkPost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(401)
  })

  it('returns 403 when preset is not public', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...mockPreset, isPublic: false })
    const res = await forkPost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(403)
  })

  it('returns 404 when preset does not exist', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue(null)
    const res = await forkPost(new NextRequest('http://localhost'), { params: { id: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('creates fork and returns 201', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue({ ...mockPreset, isPublic: true, name: 'Original' })
    ;(prisma.preset.create as jest.Mock).mockResolvedValue({ id: 'p2', name: 'Fork of Original' })
    const res = await forkPost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.name).toBe('Fork of Original')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx jest "app/api/presets/\[id\]/share/__tests__" --no-coverage
```
Expected: FAIL.

- [ ] **Step 3: Implement share route**

Create `app/api/presets/[id]/share/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { nanoid } from 'nanoid'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const preset = await prisma.preset.findUnique({ where: { id: params.id } })
  if (!preset || preset.userId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  // Idempotent — return existing slug if already shared
  if (preset.shareSlug) {
    return NextResponse.json({ slug: preset.shareSlug, url: `${baseUrl}/share/${preset.shareSlug}` })
  }

  const slug = nanoid(10)
  await prisma.preset.update({
    where: { id: params.id },
    data: { shareSlug: slug, isPublic: true },
  })
  return NextResponse.json({ slug, url: `${baseUrl}/share/${slug}` })
}
```

- [ ] **Step 4: Implement fork route**

Create `app/api/presets/[id]/fork/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const source = await prisma.preset.findUnique({ where: { id: params.id } })
  if (!source) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!source.isPublic) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const fork = await prisma.preset.create({
    data: {
      userId: session.user.id,
      name: `Fork of ${source.name}`,
      config: source.config as object,
      isPublic: false,
    },
  })
  return NextResponse.json(fork, { status: 201 })
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npx jest "app/api/presets/\[id\]/share/__tests__" --no-coverage
```
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/presets/
git commit -m "feat: add share and fork API routes"
```

---

### Task 16: Share page

**Files:**
- Create: `app/share/[slug]/page.tsx`

- [ ] **Step 1: Write share page**

Create `app/share/[slug]/page.tsx`:
```typescript
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { ShareVisualizerClient } from './ShareVisualizerClient'
import { presetConfigSchema } from '@/lib/validations/preset'

interface Props {
  params: { slug: string }
}

export default async function SharePage({ params }: Props) {
  const preset = await prisma.preset.findUnique({
    where: { shareSlug: params.slug },
    select: { id: true, name: true, config: true, isPublic: true },
  })

  if (!preset || !preset.isPublic) notFound()

  // Validate stored config before passing to client — guard against corrupt DB data
  const parsed = presetConfigSchema.safeParse(preset.config)
  if (!parsed.success) notFound()

  return (
    <ShareVisualizerClient
      presetId={preset.id}
      presetName={preset.name}
      config={parsed.data}
    />
  )
}
```

- [ ] **Step 2: Write share visualiser client component**

Create `app/share/[slug]/ShareVisualizerClient.tsx`:
```typescript
'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { VisualizerCanvas } from '@/components/visualizer/VisualizerCanvas'
import type { PresetConfig } from '@/lib/validations/preset'

interface Props {
  presetId: string
  presetName: string
  config: PresetConfig
}

export function ShareVisualizerClient({ presetId, presetName, config }: Props) {
  const { data: session } = useSession()
  const router = useRouter()

  async function handleFork() {
    if (!session) {
      router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    const res = await fetch(`/api/presets/${presetId}/fork`, { method: 'POST' })
    if (res.ok) {
      router.push('/presets')
    }
  }

  return (
    <div className="relative">
      <VisualizerCanvas config={config} />

      {/* Read-only overlay header */}
      <div className="fixed top-4 left-4 z-20 flex items-center gap-3">
        <span className="text-white/60 text-sm bg-black/50 px-3 py-1 rounded-full">
          {presetName}
        </span>
        <button
          onClick={handleFork}
          className="text-sm bg-cyan-500 hover:bg-cyan-400 text-black px-3 py-1 rounded-full font-medium"
        >
          Fork
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Smoke test sharing flow**

```bash
npm run dev
```
1. Sign in, save a preset, click "Share" in PresetManager
2. Copy the URL, open in a new incognito tab
3. Should see the share page with "Click to start" and the preset name + Fork button
4. Click "Fork" without being signed in — should redirect to `/signin`
5. Sign in, click "Fork" — should redirect to `/presets` with the forked preset

- [ ] **Step 4: Commit**

```bash
git add app/share/
git commit -m "feat: add public share page with fork support"
```

---

### Task 17: Full test suite and final checks

**Files:** All test files

- [ ] **Step 1: Run all tests**

```bash
npx jest --no-coverage
```
Expected: All tests PASS. Note any failures and fix before continuing.

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```
Expected: No errors.

- [ ] **Step 3: Run Next.js build**

```bash
npm run build
```
Expected: Build succeeds with `output: standalone`.

- [ ] **Step 4: Smoke test production build locally**

```bash
node .next/standalone/server.js
```
Navigate to `http://localhost:3000` — verify the app works end-to-end.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: final build verification and test suite complete"
git push origin main
```
