import { Card } from './Card'

export function InfoCard({
  title,
  body,
  tone = 'neutral',
}: {
  title: string
  body: string
  tone?: 'neutral' | 'amber' | 'emerald' | 'sky'
}) {
  const toneClass =
    tone === 'amber'
      ? 'bg-amber-50/35 ring-amber-200'
      : tone === 'emerald'
        ? 'bg-emerald-50/35 ring-emerald-200'
        : tone === 'sky'
          ? 'bg-sky-50/35 ring-sky-200'
          : 'bg-white ring-stone-200'

  return (
    <Card className={`${toneClass} p-4 shadow-sm`}>
      <p className="text-lg font-semibold tracking-tight text-stone-950">
        {title}
      </p>
      <p className="mt-2 text-base leading-relaxed text-stone-700">{body}</p>
    </Card>
  )
}

