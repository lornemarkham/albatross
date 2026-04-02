import type { Garden } from '../../types'
import type { GardenDataSource } from '../gardenDataSource'
import { getMockGarden } from './mockGarden'

export const mockGardenDataSource: GardenDataSource = {
  async getGarden(): Promise<Garden> {
    // Simulate a tiny network delay so loading states are easy to test.
    await new Promise((r) => setTimeout(r, 150))
    return getMockGarden()
  },
}

