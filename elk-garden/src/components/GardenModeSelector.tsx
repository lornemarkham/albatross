import clsx from 'clsx'
import type { GardenMode } from '../types'
import { gardenModeLabel } from '../lib/mode/mode'

export function GardenModeSelector({
  value,
  onChange,
}: {
  value: GardenMode
  onChange: (mode: GardenMode) => void
}) {
  const options: Array<{ id: GardenMode; label: string; sub: string }> = [
    {
      id: 'calm_supportive',
      label: 'Calm & Supportive',
      sub: 'Confidence-building, gentle guidance.',
    },
    {
      id: 'production',
      label: 'Production Mode',
      sub: 'Yield, efficiency, and system improvement.',
    },
  ]

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-stone-50/40 p-4 ring-1 ring-stone-200">
        <p className="text-base font-semibold text-stone-900">Garden mode</p>
        <p className="mt-2 text-base leading-relaxed text-stone-700">
          {gardenModeLabel(value)}
        </p>
      </div>

      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={clsx(
            'w-full text-left',
            'rounded-2xl p-4 shadow-sm ring-1',
            'transition duration-200 motion-reduce:transition-none',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50',
            o.id === value
              ? 'bg-emerald-50/60 ring-emerald-200'
              : 'bg-white ring-stone-200 hover:bg-stone-50',
          )}
        >
          <p className="text-lg font-semibold tracking-tight text-stone-950">
            {o.label}
          </p>
          <p className="mt-2 text-base leading-relaxed text-stone-700">{o.sub}</p>
        </button>
      ))}
    </div>
  )
}

