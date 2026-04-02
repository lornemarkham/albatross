import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { Garden, GardenMode, GardenProfile, WeatherSummary } from '../../types'
import { gardenDataSource } from '../gardenDataSource'
import { weatherService } from '../weather/weatherService'
import { profileService } from '../profile/profileService'

type GardenState = {
  garden: Garden | null
  weather: WeatherSummary | null
  profile: GardenProfile | null
  gardenMode: GardenMode
  isLoading: boolean
  error: string | null
}

type GardenActions = {
  toggleTask(taskId: string): void
  saveProfile(profile: GardenProfile): Promise<void>
  setGardenMode(mode: GardenMode): void
}

const GardenContext = createContext<(GardenState & GardenActions) | null>(null)

export function GardenProvider({ children }: { children: React.ReactNode }) {
  const initialGardenMode: GardenMode = (() => {
    const raw = localStorage.getItem('elk_garden_mode_v1')
    return raw === 'production' ? 'production' : 'calm_supportive'
  })()

  const [state, setState] = useState<GardenState>({
    garden: null,
    weather: null,
    profile: null,
    gardenMode: initialGardenMode,
    isLoading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, isLoading: true, error: null }))

    Promise.all([
      gardenDataSource.getGarden(),
      weatherService.getWeatherSummary('garden_elk_home'),
      profileService.getProfile(),
    ])
      .then(([garden, weather, profile]) => {
        if (cancelled) return
        setState((s) => ({ ...s, garden, weather, profile, isLoading: false, error: null }))
      })
      .catch(() => {
        if (cancelled) return
        setState((s) => ({
          ...s,
          garden: null,
          weather: null,
          profile: null,
          isLoading: false,
          error: 'We couldn’t load your garden right now.',
        }))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const actions: GardenActions = useMemo(
    () => ({
      toggleTask(taskId: string) {
        setState((s) => {
          if (!s.garden) return s
          return {
            ...s,
            garden: {
              ...s.garden,
              tasks: s.garden.tasks.map((t) =>
                t.id === taskId ? { ...t, completed: !t.completed } : t,
              ),
            },
          }
        })
      },
      async saveProfile(profile: GardenProfile) {
        await profileService.saveProfile(profile)
        setState((s) => ({ ...s, profile }))
      },
      setGardenMode(mode: GardenMode) {
        localStorage.setItem('elk_garden_mode_v1', mode)
        setState((s) => ({ ...s, gardenMode: mode }))
      },
    }),
    [],
  )

  const value = useMemo(() => ({ ...state, ...actions }), [state, actions])

  return <GardenContext.Provider value={value}>{children}</GardenContext.Provider>
}

export function useGardenStore() {
  const ctx = useContext(GardenContext)
  if (!ctx) {
    throw new Error('useGardenStore must be used within GardenProvider')
  }
  return ctx
}

