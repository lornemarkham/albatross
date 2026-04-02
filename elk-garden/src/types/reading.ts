import type { ID } from './garden'

export interface Reading {
  id: ID
  sensorId: ID
  capturedAtISO: string
  value: number
}

