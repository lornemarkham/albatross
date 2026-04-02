import clsx from 'clsx'
import type { GardenHealth, ZoneMoistureStatus } from '../types/domain'

type BadgeTone = GardenHealth | ZoneMoistureStatus

function toneClasses(tone: BadgeTone) {
  switch (tone) {
    case 'good':
      return 'bg-emerald-100/70 text-emerald-950 ring-emerald-300'
    case 'watch':
      return 'bg-amber-100/70 text-amber-950 ring-amber-300'
    case 'action':
      return 'bg-rose-100/70 text-rose-950 ring-rose-300'
    case 'dry':
      return 'bg-amber-200/70 text-amber-950 ring-amber-400'
    case 'wet':
      return 'bg-sky-100/70 text-sky-950 ring-sky-300'
  }
}

export function StatusBadge({
  label,
  tone,
}: {
  label: string
  tone: BadgeTone
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3.5 py-1.5 text-base font-semibold ring-1 ring-inset',
        toneClasses(tone),
      )}
    >
      {label}
    </span>
  )
}

