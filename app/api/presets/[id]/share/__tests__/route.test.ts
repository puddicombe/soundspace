/**
 * @jest-environment node
 */
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

  it('generates a slug and returns { slug, url }', async () => {
    ;(getServerSession as jest.Mock).mockResolvedValue(mockSession)
    ;(prisma.preset.findUnique as jest.Mock).mockResolvedValue(mockPreset)
    ;(prisma.preset.update as jest.Mock).mockResolvedValue({ ...mockPreset, shareSlug: 'abc123', isPublic: true })
    const res = await sharePost(new NextRequest('http://localhost'), { params: { id: 'p1' } })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.slug).toBeDefined()
    expect(data.url).toBeDefined()
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
