import type { CameraInsight } from './cameraInsight'
import type { Reading } from './reading'
import type { Recommendation } from './recommendation'
import type { Sensor } from './sensor'
import type { Task } from './task'
import type { Zone } from './zone'

export type ID = string

export interface Garden {
  id: ID
  name: string
  timezone: string
  zones: Zone[]
  sensors: Sensor[]
  readings: Reading[]
  recommendations: Recommendation[]
  tasks: Task[]
  cameraInsights: CameraInsight[]
}

