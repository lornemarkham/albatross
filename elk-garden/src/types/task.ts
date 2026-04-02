import type { ID } from './garden'

export interface Task {
  id: ID
  gardenId: ID
  zoneId?: ID
  title: string
  supportiveNote?: string
  completed: boolean
}

