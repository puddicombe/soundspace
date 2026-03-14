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
