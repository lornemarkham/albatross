import type { CameraInsight, Recommendation, WeatherSummary, Zone } from '../../types'

export type ZoneTrendPoint = 'drier' | 'steady' | 'wetter'

export interface ZoneDetailMock {
  plantCondition: {
    label: string
    detail: string
    tone: 'good' | 'watch'
  }
  moistureTrend: {
    label: string
    points: ZoneTrendPoint[]
  }
}

export function getZoneDetailMock(zoneId: string): ZoneDetailMock {
  switch (zoneId) {
    case 'zone_tomatoes':
      return {
        plantCondition: {
          label: 'A little stressed',
          detail:
            'Likely from warmth and drying soil. A deeper soak this evening should help.',
          tone: 'watch',
        },
        moistureTrend: {
          label: 'Getting drier over the last 2 days',
          points: ['steady', 'drier', 'drier'],
        },
      }
    case 'zone_greens':
      return {
        plantCondition: {
          label: 'Looking good',
          detail: 'Tender growth. Keep moisture even to prevent bitterness.',
          tone: 'good',
        },
        moistureTrend: {
          label: 'Nice and steady lately',
          points: ['steady', 'steady', 'steady'],
        },
      }
    case 'zone_roots':
      return {
        plantCondition: {
          label: 'Steady growth',
          detail: 'Consistent moisture supports good sizing and fewer cracks.',
          tone: 'good',
        },
        moistureTrend: {
          label: 'Slightly drier — still okay',
          points: ['steady', 'steady', 'drier'],
        },
      }
    case 'zone_melons':
      return {
        plantCondition: {
          label: 'Worth watching',
          detail: 'A bit wet can slow growth. A short dry-down helps the roots breathe.',
          tone: 'watch',
        },
        moistureTrend: {
          label: 'Wetter than usual today',
          points: ['steady', 'wetter', 'wetter'],
        },
      }
    default:
      return {
        plantCondition: {
          label: 'Looking okay',
          detail: 'Nothing urgent. Small, steady care keeps yields high.',
          tone: 'good',
        },
        moistureTrend: {
          label: 'Mostly steady',
          points: ['steady', 'steady', 'steady'],
        },
      }
  }
}

export function getTrendSentence(points: ZoneTrendPoint[]) {
  const drier = points.filter((p) => p === 'drier').length
  const wetter = points.filter((p) => p === 'wetter').length
  if (drier > wetter && drier > 0) {
    return 'Getting slightly drier over the past few check-ins.'
  }
  if (wetter > drier && wetter > 0) {
    return 'A bit wetter over the past few check-ins.'
  }
  return 'Nice and steady over the past few check-ins.'
}

export function getWateringGuidance({
  zone,
  weather,
}: {
  zone: Zone
  weather: WeatherSummary
}): { headline: string; detail: string } {
  if (zone.moistureStatus === 'dry') {
    return {
      headline: weather.wateringWindow.label,
      detail:
        'This bed is getting a little dry. A deeper evening soak helps roots and supports steady growth.',
    }
  }
  if (zone.moistureStatus === 'wet') {
    return {
      headline: 'Skip watering for now',
      detail:
        'Soil is already wet. Let it breathe today — it helps prevent mildew and keeps growth strong.',
    }
  }
  return {
    headline: 'Stay consistent',
    detail:
      'Moisture looks good. Keeping the same rhythm helps plants stay steady and happy.',
  }
}

export function pickZoneActions({
  zoneId,
  recommendations,
}: {
  zoneId: string
  recommendations: Recommendation[]
}): Array<{ title: string; why: string }> {
  const zoneRecs = recommendations.filter((r) => r.zoneId === zoneId)
  const byPriority = (r: Recommendation) =>
    r.priority === 'high' ? 0 : r.priority === 'medium' ? 1 : 2

  const primary =
    [...zoneRecs].sort((a, b) => byPriority(a) - byPriority(b)).slice(0, 2)

  const actions = primary.map((r) => ({ title: r.nextStep, why: r.whyThisMatters }))

  if (actions.length < 3) {
    const supportive =
      zoneId === 'zone_greens'
        ? {
            title: 'Harvest lightly (if you’d like)',
            why: 'Frequent small harvests keep greens tender and productive.',
          }
        : zoneId === 'zone_roots'
          ? {
              title: 'Mulch or shade the soil surface',
              why: 'A thin mulch layer reduces evaporation and keeps moisture steadier.',
            }
          : zoneId === 'zone_melons'
            ? {
                title: 'Check leaves for dampness at the base',
                why: 'Good airflow lowers the chance of mildew when soil is wet.',
              }
            : {
                title: 'Quick 2‑minute walkthrough',
                why: 'Small checks catch issues early — with less stress.',
              }

    actions.push(supportive)
  }

  return actions.slice(0, 3)
}

export function pickZoneCameraNotes({
  zoneId,
  insights,
}: {
  zoneId: string
  insights: CameraInsight[]
}) {
  const zoneInsights = insights.filter((i) => i.zoneId === zoneId)
  return zoneInsights.slice(0, 3)
}

