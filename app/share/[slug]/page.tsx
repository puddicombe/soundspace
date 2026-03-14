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
