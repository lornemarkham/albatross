import type { ReactNode } from 'react'
import { Card } from './Card'
import { StatusBadge } from './StatusBadge'
import type { GardenHealth } from '../types/domain'

function heroToneClasses(tone: GardenHealth) {
  switch (tone) {
    case 'good':
      return 'bg-emerald-50/60 ring-emerald-200 shadow-md shadow-emerald-900/5'
    case 'watch':
      return 'bg-amber-50/60 ring-amber-200 shadow-md shadow-amber-900/5'
    case 'action':
      return 'bg-rose-50/60 ring-rose-200 shadow-md shadow-rose-900/5'
  }
}

export function StatusCard({
  status,
  headline,
  supportiveText,
  icon,
  variant = 'default',
}: {
  status: { label: string; tone: GardenHealth }
  headline: string
  supportiveText: string
  icon?: ReactNode
  variant?: 'hero' | 'default'
}) {
  const isHero = variant === 'hero'

  return (
    <Card
      className={
        isHero
          ? heroToneClasses(status.tone)
          : undefined
      }
    >
      <div className={isHero ? 'p-7' : 'p-4'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            {icon ? (
              <div
                className={
                  isHero
                    ? 'grid h-14 w-14 place-items-center rounded-2xl bg-white/90 ring-1 ring-stone-200 shadow-sm'
                    : 'grid h-10 w-10 place-items-center rounded-2xl bg-stone-50 ring-1 ring-stone-200'
                }
                aria-hidden="true"
              >
                {icon}
              </div>
            ) : null}
            <div className="min-w-0">
              <p
                className={
                  isHero
                    ? 'text-base font-semibold text-stone-800'
                    : 'text-sm font-medium text-stone-600'
                }
              >
                Overall garden status
              </p>
              <p
                className={
                  isHero
                    ? 'mt-2 text-3xl font-semibold tracking-tight text-stone-950'
                    : 'mt-1 text-xl font-semibold tracking-tight text-stone-900'
                }
              >
                {headline}
              </p>
            </div>
          </div>
          <p
            className={
              isHero
                ? 'mt-4 text-lg leading-relaxed text-stone-800'
                : 'mt-3 text-sm leading-relaxed text-stone-600'
            }
          >
            {supportiveText}
          </p>
        </div>
        <div className="shrink-0">
          <StatusBadge label={status.label} tone={status.tone} />
        </div>
      </div>
      </div>
    </Card>
  )
}

