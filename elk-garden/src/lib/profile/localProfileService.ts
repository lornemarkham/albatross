import type { GardenProfile } from '../../types'
import type { ProfileService } from './profileService'

const STORAGE_KEY = 'elk_garden_profile_v1'

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

export const localProfileService: ProfileService = {
  async getProfile(): Promise<GardenProfile | null> {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = safeParse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as GardenProfile
  },
  async saveProfile(profile: GardenProfile): Promise<void> {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile))
  },
}

