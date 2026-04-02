import { Droplet, Leaf } from 'lucide-react'
import { Card } from './Card'
import { StatusBadge } from './StatusBadge'
import type { ZoneMoistureStatus } from '../types/domain'

function moistureLabel(status: ZoneMoistureStatus) {
  switch (status) {
    case 'dry':
      return 'Dry'
    case 'good':
      return 'Good'
    case 'wet':
      return 'Wet'
  }
}

function zoneTone(status: ZoneMoistureStatus) {
  switch (status) {
    case 'dry':
      return 'bg-amber-50/50 ring-amber-200'
    case 'wet':
      return 'bg-sky-50/50 ring-sky-200'
    case 'good':
      return 'bg-white ring-stone-200'
  }
}

function accentBar(status: ZoneMoistureStatus) {
  switch (status) {
    case 'dry':
      return 'bg-amber-400'
    case 'wet':
      return 'bg-sky-400'
    case 'good':
      return 'bg-emerald-300'
  }
}

export function ZoneCard({
  name,
  moistureStatus,
  recommendation,
}: {
  name: string
  moistureStatus: ZoneMoistureStatus
  recommendation: string
}) {
  return (
    <Card className={zoneTone(moistureStatus)}>
      <div className="flex gap-3 p-4">
        <div
          className="w-1.5 shrink-0 self-stretch rounded-full"
          aria-hidden="true"
        >
          <div className={`h-full w-full rounded-full ${accentBar(moistureStatus)}`} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div
              className="grid h-10 w-10 place-items-center rounded-2xl bg-stone-50 ring-1 ring-stone-200"
              aria-hidden="true"
            >
              <Leaf className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="min-w-0">
              <p className="text-lg font-semibold tracking-tight text-stone-900">
                {name}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-base text-stone-700">
                  <Droplet className="h-4 w-4" aria-hidden="true" />
                  <span>Moisture</span>
                </div>
                <StatusBadge
                  label={moistureLabel(moistureStatus)}
                  tone={moistureStatus}
                />
              </div>
            </div>
          </div>
          <p className="mt-2 text-base leading-relaxed text-stone-700">
            {recommendation}
          </p>
        </div>
      </div>
    </Card>
  )
}

