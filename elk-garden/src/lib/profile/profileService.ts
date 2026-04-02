import type { GardenProfile } from '../../types'
import { localProfileService } from './localProfileService'

export interface ProfileService {
  getProfile(): Promise<GardenProfile | null>
  saveProfile(profile: GardenProfile): Promise<void>
}

export const profileService: ProfileService = localProfileService

