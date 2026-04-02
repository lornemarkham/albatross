import type { ID } from './garden'

export type SensorKind = 'soilMoisture' | 'temperature' | 'humidity' | 'light'

export interface Sensor {
  id: ID
  zoneId: ID
  kind: SensorKind
  label: string
  unit?: string
}

