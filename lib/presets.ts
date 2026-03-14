import { prisma } from '@/lib/db'

export async function getOwnedPreset(id: string, userId: string) {
  const preset = await prisma.preset.findUnique({ where: { id } })
  if (!preset || preset.userId !== userId) return null
  return preset
}
