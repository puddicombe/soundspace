/**
 * @jest-environment node
 */

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
