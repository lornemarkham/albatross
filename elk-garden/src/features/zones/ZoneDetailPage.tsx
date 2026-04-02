import {
  Camera,
  ChevronLeft,
  Droplet,
  Sparkles,
  Sun,
  ThermometerSun,
} from 'lucide-react'
import { NavLink, useParams } from 'react-router-dom'
import { Card } from '../../components/Card'
import { InsightCard } from '../../components/InsightCard'
import { RecommendationCard } from '../../components/RecommendationCard'
import { SectionContainer } from '../../components/SectionContainer'
import { StatusBadge } from '../../components/StatusBadge'
import { useGarden } from '../../lib/useGarden'
import {
  getWateringGuidance,
  getZoneDetailMock,
  getTrendSentence,
  pickZoneActions,
  pickZoneCameraNotes,
} from '../../lib/mockData/zoneDetails'

function moistureLabel(status: string) {
  switch (status) {
    case 'dry':
      return 'Dry'
    case 'wet':
      return 'Wet'
    default:
      return 'Good'
  }
}

export function ZoneDetailPage() {
  const { zoneId } = useParams()
  const { garden, weather, isLoading, error } = useGarden()

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            Loading zone…
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment.
          </p>
        </div>
      </div>
    )
  }

  if (error || !garden || !zoneId) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            We couldn’t load this zone
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            {error ?? 'Please try again.'}
          </p>
        </div>
      </div>
    )
  }

  const zone = garden.zones.find((z) => z.id === zoneId)
  if (!zone) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            Zone not found
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            Go back to Zones and pick another bed.
          </p>
          <NavLink
            to="/zones"
            className="mt-4 inline-flex items-center justify-center rounded-2xl bg-stone-900 px-4 py-3 text-base font-semibold text-white"
          >
            Back to Zones
          </NavLink>
        </div>
      </div>
    )
  }

  if (!weather) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            Getting today’s guidance…
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment.
          </p>
        </div>
      </div>
    )
  }

  const latestRec =
    garden.recommendations
      .filter((r) => r.zoneId === zone.id)
      .sort((a, b) => (a.priority < b.priority ? -1 : 1))[0] ?? null

  const cameraNotes = pickZoneCameraNotes({
    zoneId: zone.id,
    insights: garden.cameraInsights,
  })
  const lastCamera = cameraNotes[0] ?? null

  const moistureSummary =
    zone.moistureStatus === 'dry'
      ? 'Drying out a bit. Evening watering usually restores steady growth.'
      : zone.moistureStatus === 'wet'
        ? 'A little wet right now. Let the bed breathe to avoid stress.'
        : 'Moisture looks steady. Consistency supports healthy, productive plants.'

  const detailMock = getZoneDetailMock(zone.id)
  const watering = getWateringGuidance({ zone, weather })
  const actions = pickZoneActions({
    zoneId: zone.id,
    recommendations: garden.recommendations,
  })

  return (
    <div className="pt-4">
      <div className="px-4 pb-6">
        <NavLink
          to="/zones"
          className="inline-flex items-center gap-2 rounded-2xl bg-white px-3 py-2 text-base font-semibold text-stone-900 shadow-sm ring-1 ring-stone-200"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
          Zones
        </NavLink>

        <Card className="mt-4 bg-stone-50/40 p-6 ring-stone-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-stone-800">
                Zone status
              </p>
              <p className="mt-2 text-3xl font-semibold tracking-tight text-stone-950">
                {zone.name}
              </p>
              <p className="mt-4 text-lg leading-relaxed text-stone-800">
                {zone.headline}
              </p>
              <p className="mt-3 text-base leading-relaxed text-stone-700">
                {detailMock.plantCondition.tone === 'good'
                  ? 'You’re still in a good spot.'
                  : 'Nothing urgent — a small adjustment tonight should help.'}
              </p>
            </div>
            <div className="shrink-0">
              <StatusBadge
                label={moistureLabel(zone.moistureStatus)}
                tone={zone.moistureStatus}
              />
            </div>
          </div>
        </Card>
      </div>

      <SectionContainer
        title="Current conditions"
        subtitle="Simple, human-readable signals — no sensor jargon."
      >
        <div className="grid grid-cols-1 gap-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-stone-50 ring-1 ring-stone-200">
                <Droplet className="h-6 w-6 text-sky-700" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-950">
                  Moisture: {moistureLabel(zone.moistureStatus)}
                </p>
                <p className="mt-2 text-base leading-relaxed text-stone-700">
                  {moistureSummary}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <div className="flex items-start gap-3">
              <div
                className={
                  detailMock.plantCondition.tone === 'good'
                    ? 'grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50/60 ring-1 ring-emerald-200'
                    : 'grid h-11 w-11 place-items-center rounded-2xl bg-amber-50/60 ring-1 ring-amber-200'
                }
              >
                <ThermometerSun
                  className="h-6 w-6 text-stone-800"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-950">
                  Plant condition: {detailMock.plantCondition.label}
                </p>
                <p className="mt-2 text-base leading-relaxed text-stone-700">
                  {detailMock.plantCondition.detail}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-50/45 ring-1 ring-sky-200">
                <Camera className="h-6 w-6 text-stone-800" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-950">
                  Last camera note
                </p>
                <p className="mt-2 text-base leading-relaxed text-stone-700">
                  {lastCamera
                    ? `${lastCamera.title} — ${lastCamera.detail}`
                    : 'No recent camera notes for this bed. You’re all set.'}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-sky-50/45 p-4 shadow-sm ring-1 ring-sky-200">
            <div className="flex items-start gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/90 ring-1 ring-sky-200">
                <Sun className="h-6 w-6 text-sky-800" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-950">
                  Watering guidance
                </p>
                <p className="mt-2 text-base font-semibold text-stone-950">
                  {watering.headline}
                </p>
                <p className="mt-2 text-base leading-relaxed text-stone-700">
                  {watering.detail}
                </p>
              </div>
            </div>
          </div>
        </div>
      </SectionContainer>

      <SectionContainer
        title="Recent trend"
        subtitle="A quick pattern — easy to scan."
      >
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-stone-50 ring-1 ring-stone-200">
              <Droplet className="h-6 w-6 text-stone-800" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-semibold text-stone-950">
                {detailMock.moistureTrend.label}
              </p>
              <p className="mt-2 text-base leading-relaxed text-stone-700">
                {getTrendSentence(detailMock.moistureTrend.points)} This is a gentle hint — not a verdict.
              </p>
              <p className="mt-2 text-base leading-relaxed text-stone-700">
                If you’re unsure, a quick finger test (1–2 inches down) is a reliable tie-breaker.
              </p>
              <div className="mt-3 flex items-center gap-2" aria-label="Recent trend">
                {detailMock.moistureTrend.points.map((p, idx) => (
                  <span
                    // eslint-disable-next-line react/no-array-index-key
                    key={idx}
                    className={
                      p === 'drier'
                        ? 'h-3.5 w-3.5 rounded-full bg-amber-400 ring-2 ring-amber-200'
                        : p === 'wetter'
                          ? 'h-3.5 w-3.5 rounded-full bg-sky-400 ring-2 ring-sky-200'
                          : 'h-3.5 w-3.5 rounded-full bg-emerald-300 ring-2 ring-emerald-200'
                    }
                    aria-hidden="true"
                  />
                ))}
                <span className="text-base font-medium text-stone-700">
                  Recent trend
                </span>
              </div>
            </div>
          </div>
        </div>
      </SectionContainer>

      <SectionContainer
        title="What to do next"
        subtitle="One calm step is enough."
      >
        <div className="space-y-4">
          {actions.map((a) => (
            <div
              key={a.title}
              className="rounded-2xl bg-emerald-50/45 p-4 shadow-sm ring-1 ring-emerald-200"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white/90 ring-1 ring-emerald-200">
                  <Sparkles className="h-6 w-6 text-emerald-700" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-semibold tracking-tight text-stone-950">
                    {a.title}
                  </p>
                  <p className="mt-2 text-base leading-relaxed text-stone-800">
                    {a.why}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionContainer>

      {latestRec ? (
        <SectionContainer title="Latest recommendation" subtitle="Focused and practical.">
          <RecommendationCard
            title={latestRec.title}
            why={latestRec.whyThisMatters}
            nextStep={latestRec.nextStep}
          />
        </SectionContainer>
      ) : null}

      <SectionContainer
        title="Camera notes"
        subtitle="Helpful observations — you’re still in charge."
      >
        {cameraNotes.length ? (
          <div className="space-y-4">
            {cameraNotes.map((n) => (
              <InsightCard
                key={n.id}
                kind={n.kind}
                title={n.title}
                detail={n.detail}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <p className="text-base font-semibold text-stone-950">
              No camera notes right now
            </p>
            <p className="mt-2 text-base leading-relaxed text-stone-700">
              That’s a good sign. If something changes, we’ll keep it calm and simple.
            </p>
          </div>
        )}
      </SectionContainer>
    </div>
  )
}

