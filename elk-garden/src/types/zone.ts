import type { ID } from './garden'

export type GardenHealth = 'good' | 'watch' | 'action'
export type ZoneMoistureStatus = 'dry' | 'good' | 'wet'

export interface Zone {
  id: ID
  name: string
  sortOrder: number
  moistureStatus: ZoneMoistureStatus
  headline: string
  health: GardenHealth
}

