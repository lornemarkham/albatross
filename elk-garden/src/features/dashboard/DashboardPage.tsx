import { AlertTriangle, Sparkles } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { InfoCard } from '../../components/InfoCard'
import { InsightCard } from '../../components/InsightCard'
import { RecommendationCard } from '../../components/RecommendationCard'
import { SectionContainer } from '../../components/SectionContainer'
import { StatusCard } from '../../components/StatusCard'
import { TaskList } from '../../components/TaskList'
import { ZoneCard } from '../../components/ZoneCard'
import { useGarden } from '../../lib/useGarden'
import { getDashboardViewModel } from './dashboardViewModel'
import { NavLink } from 'react-router-dom'
import type { GardenMode } from '../../types'

export function DashboardPage() {
  const { garden, weather, profile, isLoading, error } =
    useGarden()

  if (isLoading) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            Getting things ready…
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment while we check today’s garden picture.
          </p>
        </div>
      </div>
    )
  }

  if (error || !garden) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <div className="flex items-start gap-3">
            <div
              className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-50 ring-1 ring-rose-200"
              aria-hidden="true"
            >
              <AlertTriangle className="h-5 w-5 text-rose-900" />
            </div>
            <div>
              <p className="text-base font-semibold text-stone-900">
                We hit a small snag
              </p>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                {error ?? 'Please try again.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!weather) {
    return (
      <div className="px-4 py-6">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">
            Getting today’s weather…
          </p>
          <p className="mt-2 text-sm leading-relaxed text-stone-600">
            One moment.
          </p>
        </div>
      </div>
    )
  }

  const [mode, setMode] = useState<GardenMode>('calm_supportive')

  const vm = getDashboardViewModel(garden, weather, profile, mode)

  const [taskState, setTaskState] = useState<Record<string, boolean>>({})
  const [taskFeedback, setTaskFeedback] = useState<string | null>(null)
  const [recFeedback, setRecFeedback] = useState<
    Record<string, 'helpful' | 'not_quite' | null>
  >({})
  const [showIntro, setShowIntro] = useState(true)
  const [showLearnMore, setShowLearnMore] = useState(false)

  const tasks = useMemo(
    () =>
      vm.tasks.map((t) => ({
        ...t,
        completed: taskState[t.id] ?? t.completed,
      })),
    [vm.tasks, taskState],
  )

  useEffect(() => {
    if (!taskFeedback) return
    const t = window.setTimeout(() => setTaskFeedback(null), 1400)
    return () => window.clearTimeout(t)
  }, [taskFeedback])

  return (
    <div className="pt-6">
      {showLearnMore ? (
        <div
          className="fixed inset-0 z-40 bg-stone-950/30 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Learn more about ELK Garden"
        >
          <div className="mx-auto flex h-full max-w-xl flex-col justify-end px-4 pb-6 pt-6">
            <div className="rounded-2xl bg-white shadow-xl ring-1 ring-stone-200">
              <div className="flex items-start justify-between gap-3 border-b border-stone-200 p-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-stone-700">
                    Learn more
                  </p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight text-stone-950">
                    How ELK Garden works
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowLearnMore(false)}
                  className="shrink-0 rounded-xl bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-4">
                <div className="space-y-6">
                  <div>
                    <p className="text-lg font-semibold tracking-tight text-stone-950">
                      What this is
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      ELK Garden is designed to feel less like a tool and more
                      like a helpful partner in your garden.
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      Instead of guessing what to do next, the app helps guide
                      you with small, meaningful actions based on real
                      conditions.
                    </p>
                  </div>

                  <div>
                    <p className="text-lg font-semibold tracking-tight text-stone-950">
                      How it works
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      This system is designed to combine simple inputs with
                      intelligent guidance:
                    </p>
                    <ul className="mt-3 space-y-3 text-base leading-relaxed text-stone-700">
                      <li>
                        <span className="font-semibold text-stone-950">
                          Garden zones
                        </span>
                        <br />
                        Your garden is broken into zones (like tomatoes, greens,
                        root crops), so each area can be tracked and supported
                        differently.
                      </li>
                      <li>
                        <span className="font-semibold text-stone-950">
                          Observations
                        </span>
                        <br />
                        This can include what you see, what cameras detect, or
                        what changes over time.
                      </li>
                      <li>
                        <span className="font-semibold text-stone-950">
                          Sensors (optional)
                        </span>
                        <br />
                        Moisture, temperature, and environmental signals can
                        help refine recommendations.
                      </li>
                      <li>
                        <span className="font-semibold text-stone-950">
                          AI guidance
                        </span>
                        <br />
                        All of this can be combined to generate simple,
                        human-friendly suggestions — not overwhelming data.
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p className="text-lg font-semibold tracking-tight text-stone-950">
                      What it can become
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      This is just the beginning. Over time, this system can
                      grow into a full “smart garden”:
                    </p>
                    <ul className="mt-3 list-disc space-y-2 pl-5 text-base leading-relaxed text-stone-700">
                      <li>Detect plant stress, pests, or animal activity</li>
                      <li>Suggest better watering strategies</li>
                      <li>Help plan what to plant and when</li>
                      <li>
                        Recommend crop pairings (companion planting)
                      </li>
                      <li>Track harvest timing and yields</li>
                      <li>
                        Help you store food (freezing, canning, drying)
                      </li>
                      <li>
                        Support building efficient systems like rainwater
                        collection or drip irrigation
                      </li>
                    </ul>
                  </div>

                  <div>
                    <p className="text-lg font-semibold tracking-tight text-stone-950">
                      Built from real use
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      This started as a real system for a garden in the
                      Okanagan.
                    </p>
                    <p className="mt-2 text-base leading-relaxed text-stone-700">
                      The goal is to take what works in a real backyard and
                      make it simple enough for anyone to use — whether you're
                      just starting or trying to produce as much food as
                      possible.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-emerald-50/40 p-4 ring-1 ring-emerald-200">
                    <p className="text-base font-semibold text-stone-950">
                      The goal is simple:
                    </p>
                    <p className="mt-2 text-lg font-semibold tracking-tight text-stone-950">
                      grow better food, with less guesswork.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-stone-200 p-4">
                <button
                  type="button"
                  onClick={() => setShowLearnMore(false)}
                  className="w-full rounded-2xl bg-stone-900 px-4 py-4 text-base font-semibold text-white shadow-sm ring-1 ring-stone-900 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  Back to dashboard
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showIntro ? (
        <div className="px-4 pb-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-stone-200">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-950">
                  Welcome to ELK Garden 🌿
                </p>
                <p className="mt-2 text-sm leading-relaxed text-stone-700">
                  ELK Garden is a simple, intelligent garden companion designed
                  to help you grow more food with less guesswork.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-stone-700">
                  It looks at how your garden is doing and gives you clear,
                  practical suggestions — so you can stay on track without
                  overthinking it.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowIntro(false)}
                className="shrink-0 rounded-xl bg-stone-50 px-3 py-2 text-sm font-semibold text-stone-800 ring-1 ring-stone-200 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
              >
                Got it
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-stone-50/50 p-3 ring-1 ring-stone-200">
              <p className="text-sm font-semibold text-stone-900">
                Two ways to garden
              </p>
              <div className="mt-2 text-sm leading-relaxed text-stone-700">
                <p className="font-semibold text-stone-900">Kathy Mode 🌿</p>
                <p>
                  Calm, supportive, and simple. Focuses on confidence and
                  enjoying the process.
                </p>
                <p className="mt-3 font-semibold text-stone-900">Lorne Mode 🔧</p>
                <p>
                  More direct and practical. Focuses on improving yield,
                  efficiency, and getting the most out of your garden.
                </p>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-stone-700">
                You can switch between modes anytime — use whatever feels right that day.
              </p>
              <button
                type="button"
                onClick={() => setShowLearnMore(true)}
                className="mt-3 w-full rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-stone-900 shadow-sm ring-1 ring-stone-200 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
              >
                Learn more about how this works
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-4 pb-4">
        <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200">
          <p className="text-base font-semibold text-stone-900">Garden mode</p>
          <div
            className="mt-3 grid grid-cols-2 gap-2 rounded-2xl bg-stone-100 p-2 ring-1 ring-stone-200"
            role="group"
            aria-label="Garden mode"
          >
            <button
              type="button"
              onClick={() => setMode('calm_supportive')}
              className={
                mode === 'calm_supportive'
                  ? 'rounded-2xl bg-white px-4 py-3 text-base font-semibold text-stone-950 shadow-sm ring-1 ring-stone-200'
                  : 'rounded-2xl px-4 py-3 text-base font-semibold text-stone-700 hover:bg-white/70'
              }
              aria-pressed={mode === 'calm_supportive'}
            >
              Kathy 🌿
            </button>
            <button
              type="button"
              onClick={() => setMode('production')}
              className={
                mode === 'production'
                  ? 'rounded-2xl bg-white px-4 py-3 text-base font-semibold text-stone-950 shadow-sm ring-1 ring-stone-200'
                  : 'rounded-2xl px-4 py-3 text-base font-semibold text-stone-700 hover:bg-white/70'
              }
              aria-pressed={mode === 'production'}
            >
              Lorne 🔧
            </button>
          </div>
        </div>
      </div>
      <div className="px-4 pb-8">
        <StatusCard
          status={{ label: vm.gardenStatus.label, tone: vm.gardenStatus.tone }}
          headline={vm.gardenStatus.headline}
          supportiveText={vm.gardenStatus.supportiveText}
          icon={<Sparkles className="h-5 w-5 text-emerald-700" />}
          variant="hero"
        />
      </div>

      <SectionContainer
        title="Zone status"
        subtitle="A quick glance at your key beds — simple and actionable."
      >
        <div className="space-y-4">
          {vm.zones.map((z) => (
            <NavLink
              key={z.id}
              to={`/zones/${z.id}`}
              className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50"
            >
              <ZoneCard
                name={z.name}
                moistureStatus={z.moistureStatus}
                recommendation={z.recommendation}
              />
            </NavLink>
          ))}
        </div>
      </SectionContainer>

      <SectionContainer
        title="What to do next"
        subtitle="Just a couple simple wins for today"
      >
        <div className="space-y-4">
          {vm.recommendations.map((r) => (
            <RecommendationCard
              key={r.id}
              title={r.title}
              why={r.why}
              nextStep={r.nextStep}
              expanders={r.expanders}
              feedback={recFeedback[r.id] ?? null}
              onFeedback={(value) =>
                setRecFeedback((s) => ({ ...s, [r.id]: value }))
              }
            />
          ))}
        </div>
      </SectionContainer>

      {mode === 'production' && vm.production ? (
        <>
          <SectionContainer
            title="Production insights"
            subtitle="Fast signals that affect yield and quality."
          >
            <div className="space-y-4">
              {vm.production.productionInsights.map((x) => (
                <InfoCard
                  key={x.id}
                  title={x.title}
                  body={x.body}
                  tone={x.tone === 'amber' ? 'amber' : 'emerald'}
                />
              ))}
            </div>
          </SectionContainer>

          <SectionContainer
            title="Efficiency opportunities"
            subtitle="Small improvements that save time and water."
          >
            <div className="space-y-4">
              {vm.production.efficiency.map((x) => (
                <InfoCard key={x.id} title={x.title} body={x.body} tone="neutral" />
              ))}
            </div>
          </SectionContainer>

          <SectionContainer
            title="Storage & usage"
            subtitle="Light planning to reduce waste."
          >
            <div className="space-y-4">
              {vm.production.storage.map((x) => (
                <InfoCard key={x.id} title={x.title} body={x.body} tone="sky" />
              ))}
            </div>
          </SectionContainer>

          <SectionContainer
            title="System prompts"
            subtitle="Short questions to improve the system over time."
          >
            <div className="space-y-4">
              {vm.production.prompts.map((x) => (
                <InfoCard key={x.id} title={x.title} body={x.body} tone="neutral" />
              ))}
            </div>
          </SectionContainer>
        </>
      ) : null}

      <SectionContainer
        title="Garden observations"
        subtitle="Helpful notes — you're still in control"
      >
        <div className="space-y-4">
          {vm.insights.map((i) => (
            <InsightCard
              key={i.id}
              kind={i.kind}
              title={i.title}
              detail={i.detail}
            />
          ))}
        </div>
      </SectionContainer>

      <SectionContainer
        title="Today's tasks"
        subtitle="Keep it simple — a few small wins go a long way"
      >
        <div className="sr-only" role="status" aria-live="polite">
          {taskFeedback ?? ''}
        </div>
        <TaskList
          items={tasks}
          onToggle={(id) => {
            setTaskState((s) => ({ ...s, [id]: !(s[id] ?? false) }))
            setTaskFeedback('Nice — that helps 👍')
          }}
        />
      </SectionContainer>

      <SectionContainer
        title="Weather-aware watering"
        subtitle="Timing guidance that reduces stress and saves water."
      >
        <div className="rounded-2xl bg-sky-50/45 p-4 shadow-sm ring-1 ring-sky-200">
          <p className="text-lg font-semibold tracking-tight text-stone-900">
            {vm.weather.wateringWindowLabel}
          </p>
          <p className="mt-2 text-base leading-relaxed text-stone-600">
            {vm.weather.wateringWindowReason}
          </p>
          <p className="mt-2 text-base leading-relaxed text-stone-700">
            Morning watering works too — just avoid the hottest part of the day.
          </p>
          <p className="mt-3 text-base font-medium text-stone-700">
            {vm.weather.summaryLine}
          </p>
        </div>
      </SectionContainer>
    </div>
  )
}

