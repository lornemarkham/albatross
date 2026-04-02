import type { Garden } from '../types'
import { mockGardenDataSource } from './mockData/mockGardenDataSource'

export interface GardenDataSource {
  getGarden(): Promise<Garden>
}

// Swap this implementation later (API, local-first, etc.) without touching UI code.
export const gardenDataSource: GardenDataSource = mockGardenDataSource

