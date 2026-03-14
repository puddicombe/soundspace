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
