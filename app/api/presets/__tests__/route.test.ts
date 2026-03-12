/**
 * @jest-environment node
 */

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
      body: JSON.stringify({ name: 'Test', config: { type: 'waveform', colorScheme: 'mono', sensitivity: 1.0, fftSize: 2048 } }),
      headers: { 'Content-Type': 'application/json' },
    }))
    expect(res.status).toBe(401)
  })

  it('creates preset and returns 201', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.create as jest.Mock).mockResolvedValue({ id: 'p1', name: 'Test' })
    const res = await POST(new NextRequest('http://localhost/api/presets', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', config: { type: 'waveform', colorScheme: 'mono', sensitivity: 1.0, fftSize: 2048 } }),
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
