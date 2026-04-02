import { Camera, ShieldAlert, Sprout } from 'lucide-react'
import { Card } from './Card'
import type { CameraInsightKind } from '../types/domain'

function iconFor(kind: CameraInsightKind) {
  switch (kind) {
    case 'animalActivity':
      return <ShieldAlert className="h-5 w-5 text-amber-800" aria-hidden="true" />
    case 'plantStress':
      return <Sprout className="h-5 w-5 text-emerald-800" aria-hidden="true" />
    case 'growthIssue':
      return <Camera className="h-5 w-5 text-stone-800" aria-hidden="true" />
  }
}

export function InsightCard({
  kind,
  title,
  detail,
}: {
  kind: CameraInsightKind
  title: string
  detail: string
}) {
  return (
    <Card className="bg-sky-50/35 p-4 ring-sky-200">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-stone-50 ring-1 ring-stone-200">
          {iconFor(kind)}
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-stone-950">
            {title}
          </p>
          <p className="mt-2 text-base leading-relaxed text-stone-700">
            {detail}
          </p>
        </div>
      </div>
    </Card>
  )
}

