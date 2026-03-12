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
