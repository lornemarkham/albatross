import { SectionContainer } from '../../components/SectionContainer'
import { ZoneCard } from '../../components/ZoneCard'
import { useGarden } from '../../lib/useGarden'
import { NavLink } from 'react-router-dom'

export function ZonesPage() {
  const { garden, isLoading, error } = useGarden()

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">Loading zones…</p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment.
          </p>
        </div>
      </div>
    )
  }

  if (error || !garden) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            We couldn’t load zones
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            {error ?? 'Please try again.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-4">
      <SectionContainer
        title="Zones"
        subtitle="Each zone is kept simple: what’s happening and what to do next."
      >
        <div className="space-y-3">
          {[...garden.zones]
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((z) => (
              <NavLink
                key={z.id}
                to={`/zones/${z.id}`}
                className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
              >
                <ZoneCard
                  name={z.name}
                  moistureStatus={z.moistureStatus}
                  recommendation={z.headline}
                />
              </NavLink>
            ))}
        </div>
      </SectionContainer>
    </div>
  )
}

