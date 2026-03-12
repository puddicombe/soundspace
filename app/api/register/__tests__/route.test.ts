/**
 * @jest-environment node
 */

import { POST } from '../route'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import bcrypt from 'bcryptjs'

jest.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  },
}))

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('hashedPassword'),
  compare: jest.fn(),
}))

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/register', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/register', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 400 for missing email', async () => {
    const res = await POST(makeRequest({ password: 'password1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for short password', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'abc' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for password without a number', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'passwordonly' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 for password without a letter', async () => {
    const res = await POST(makeRequest({ email: 'a@b.com', password: '12345678' }))
    expect(res.status).toBe(400)
  })

  it('returns 409 when email already registered', async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'u1', email: 'a@b.com' })
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'password1' }))
    expect(res.status).toBe(409)
  })

  it('returns 201 and creates user on valid registration', async () => {
    ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
    ;(prisma.user.create as jest.Mock).mockResolvedValue({ id: 'u1' })
    const res = await POST(makeRequest({ email: 'a@b.com', password: 'password1' }))
    expect(res.status).toBe(201)
    expect(bcrypt.hash).toHaveBeenCalledWith('password1', 12)
  })
})
