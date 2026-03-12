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
