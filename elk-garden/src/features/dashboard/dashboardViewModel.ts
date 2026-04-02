import type {
  Garden,
  GardenHealth,
  GardenProfile,
  GardenMode,
  Recommendation,
  WeatherSummary,
  Zone,
} from '../../types'
import { modeCopy } from '../../lib/mode/mode'

export interface DashboardViewModel {
  gardenStatus: {
    tone: GardenHealth
    label: string
    headline: string
    supportiveText: string
  }
  zones: Array<{
    id: string
    name: string
    moistureStatus: Zone['moistureStatus']
    recommendation: string
  }>
  recommendations: Array<{
    id: string
    title: string
    why: string
    nextStep: string
    expanders?: Array<{ title: string; body: string }>
  }>
  production?: {
    productionInsights: Array<{ id: string; title: string; body: string; tone?: 'neutral' | 'amber' | 'emerald' }>
    efficiency: Array<{ id: string; title: string; body: string }>
    storage: Array<{ id: string; title: string; body: string }>
    prompts: Array<{ id: string; title: string; body: string }>
  }
  insights: Array<{
    id: string
    kind: Garden['cameraInsights'][number]['kind']
    title: string
    detail: string
  }>
  tasks: Array<{
    id: string
    title: string
    supportiveNote?: string
    completed: boolean
  }>
  weather: {
    summaryLine: string
    wateringWindowLabel: string
    wateringWindowReason: string
  }
}

function worstHealth(zones: Zone[]): GardenHealth {
  if (zones.some((z) => z.health === 'action')) return 'action'
  if (zones.some((z) => z.health === 'watch')) return 'watch'
  return 'good'
}

function statusCopy(
  tone: GardenHealth,
  mode: GardenMode,
): Pick<DashboardViewModel['gardenStatus'], 'label' | 'headline' | 'supportiveText'> {
  return {
    label: tone === 'good' ? 'Good' : tone === 'watch' ? 'Watch' : 'Action needed',
    headline: modeCopy({
      mode,
      kathy:
        "You're doing a great job. Everything is on track — just a couple gentle things to look at today.",
      lorne: "You're doing well — a couple small things to check",
    }),
    supportiveText: modeCopy({
      mode,
      kathy:
        "Nothing urgent. A few small adjustments today will help everything stay on track — and you're already doing the hard part by showing up.",
      lorne:
        "Nothing urgent. A few small adjustments today will help everything stay on track.",
    }),
  }
}

function sortRecommendations(recs: Recommendation[]) {
  const priorityRank: Record<Recommendation['priority'], number> = {
    high: 0,
    medium: 1,
    low: 2,
  }
  const dueRank: Record<Recommendation['due'], number> = {
    today: 0,
    soon: 1,
    'when-you-can': 2,
  }
  return [...recs].sort(
    (a, b) =>
      priorityRank[a.priority] - priorityRank[b.priority] ||
      dueRank[a.due] - dueRank[b.due],
  )
}

function personalizeWhy(why: string, profile: GardenProfile | null) {
  switch (profile?.goal) {
    case 'high_yield':
      return `${why} This helps protect yield with less guesswork.`
    case 'simple_low_effort':
      return `${why} This is a simple step with a big payoff.`
    case 'beauty_and_food':
      return `${why} It supports both healthy plants and a pleasant garden.`
    case 'figuring_it_out':
      return `${why} This is a gentle, confidence-building step.`
    default:
      return why
  }
}

function productionExtras(garden: Garden) {
  const z = (id: string) => garden.zones.find((x) => x.id === id)
  const tomatoes = z('zone_tomatoes')
  const melons = z('zone_melons')
  const greens = z('zone_greens')

  const productionInsights = [
    tomatoes?.moistureStatus === 'dry'
      ? {
          id: 'pi_tomatoes_dry',
          title: 'Tomatoes trending dry — yield risk if not corrected within 48h',
          body: 'Dry swings can reduce fruit size and increase cracking risk. Correcting tonight keeps production steady.',
          tone: 'amber' as const,
        }
      : {
          id: 'pi_tomatoes_ok',
          title: 'Tomatoes stable — keep moisture consistent',
          body: 'Consistency supports steady fruit set and fewer defects.',
          tone: 'emerald' as const,
        },
    melons?.moistureStatus === 'wet'
      ? {
          id: 'pi_melons_wet',
          title: 'Melons overwatered — increased mildew risk',
          body: 'Short dry-down improves airflow and reduces disease pressure.',
          tone: 'amber' as const,
        }
      : {
          id: 'pi_melons_ok',
          title: 'Melons stable — good root conditions',
          body: 'Steady moisture with occasional dry-down supports deeper roots.',
          tone: 'emerald' as const,
        },
    greens
      ? {
          id: 'pi_greens',
          title: 'Greens stable — good production consistency',
          body: 'Even moisture keeps growth tender and predictable.',
          tone: 'emerald' as const,
        }
      : null,
  ].filter(Boolean) as Array<{
    id: string
    title: string
    body: string
    tone: 'amber' | 'emerald'
  }>

  const efficiency = [
    {
      id: 'eff_evening',
      title: 'Evening watering improves efficiency',
      body: 'Cooler air reduces evaporation and keeps more water in the root zone.',
    },
    {
      id: 'eff_consistency',
      title: 'Consistency protects fruit quality',
      body: 'Inconsistent moisture can reduce fruit size and increase splitting.',
    },
    {
      id: 'eff_group',
      title: 'Group similar water needs',
      body: 'Beds with similar needs are easier to water well (and less likely to be missed).',
    },
  ]

  const storage = [
    {
      id: 'stor_greens',
      title: 'Greens ready soon — plan usage or storage',
      body: 'A small harvest plan reduces waste and keeps plants producing.',
    },
    {
      id: 'stor_tomatoes',
      title: 'Tomatoes approaching peak — consider preserving',
      body: 'Batch cooking or freezing sauce can turn surplus into future meals.',
    },
  ]

  const prompts = [
    {
      id: 'p_drip',
      title: 'Could this zone benefit from drip irrigation?',
      body: 'If watering is inconsistent, a simple drip line can stabilize moisture.',
    },
    {
      id: 'p_sun',
      title: 'Is this area getting consistent sunlight?',
      body: 'Slow corners are often shade, compaction, or uneven watering.',
    },
    {
      id: 'p_mulch',
      title: 'Would mulch help retain moisture here?',
      body: 'Mulch reduces evaporation and smooths out dry swings.',
    },
  ]

  return { productionInsights, efficiency, storage, prompts }
}

export function getDashboardViewModel(
  garden: Garden,
  weather: WeatherSummary,
  profile: GardenProfile | null,
  mode: GardenMode,
): DashboardViewModel {
  const tone = worstHealth(garden.zones)
  const copy = statusCopy(tone, mode)

  return {
    gardenStatus: {
      tone,
      ...copy,
    },
    zones: [...garden.zones]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((z) => ({
        id: z.id,
        name: z.name,
        moistureStatus: z.moistureStatus,
        recommendation: z.headline,
      })),
    recommendations: sortRecommendations(garden.recommendations)
      .slice(0, 3)
      .map((r) => ({
        id: r.id,
        title: modeCopy({
          mode,
          kathy:
            r.id === 'rec_water_west'
              ? "Your tomatoes would really appreciate a nice deep soak this evening — you're setting them up for great growth."
              : r.title,
          lorne:
            r.id === 'rec_water_west'
              ? 'Tomatoes need a deep soak tonight to maintain fruit production'
              : r.title,
        }),
        why: modeCopy({
          mode,
          kathy: personalizeWhy(r.whyThisMatters, profile),
          lorne:
            r.id === 'rec_water_west'
              ? 'Watering later reduces evaporation and keeps root-zone moisture stable.'
              : personalizeWhy(r.whyThisMatters, profile),
        }),
        nextStep: modeCopy({
          mode,
          kathy: r.nextStep,
          lorne:
            r.id === 'rec_water_west'
              ? 'Water at the base for 10–15 minutes. Inconsistent moisture can reduce yield and split fruit.'
              : r.nextStep,
        }),
        expanders:
          mode === 'production'
            ? [
                {
                  title: 'Why water in the evening?',
                  body: 'Lower heat and wind means less evaporation and better root-zone soak.',
                },
                {
                  title: 'Why avoid overwatering?',
                  body: 'Wet soil reduces oxygen to roots and increases mildew/disease pressure.',
                },
                {
                  title: 'How this affects yield',
                  body: 'Consistent moisture supports fruit size and reduces splitting and stress.',
                },
              ]
            : undefined,
      })),
    insights: garden.cameraInsights.slice(0, 3).map((i) => ({
      id: i.id,
      kind: i.kind,
      title: modeCopy({
        mode,
        kathy:
          i.id === 'insight_animal_1'
            ? 'Something stopped by last night — worth a quick peek, just to keep your plants safe.'
            : i.title,
        lorne:
          i.id === 'insight_animal_1'
            ? 'Possible intrusion last night — inspect for damage'
            : i.title,
      }),
      detail: modeCopy({
        mode,
        kathy: i.detail,
        lorne:
          i.id === 'insight_animal_1'
            ? 'Movement near tomatoes around 2:10am. Check leaves and fruit for nibbling.'
            : i.detail,
      }),
    })),
    tasks: garden.tasks.slice(0, 3).map((t) => ({
      id: t.id,
      title: t.title,
      supportiveNote: t.supportiveNote,
      completed: t.completed,
    })),
    weather: {
      summaryLine: `${weather.summary} • High ${weather.highF}° • Low ${weather.lowF}°`,
      wateringWindowLabel: weather.wateringWindow.label,
      wateringWindowReason: weather.wateringWindow.reason,
    },
    production:
      mode === 'production'
        ? {
            ...productionExtras(garden),
          }
        : undefined,
  }
}

