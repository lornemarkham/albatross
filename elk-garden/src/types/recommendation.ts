import type { ID } from './garden'

export type RecommendationPriority = 'high' | 'medium' | 'low'
export type RecommendationKind =
  | 'watering'
  | 'pruning'
  | 'pest'
  | 'harvest'
  | 'check'

export interface Recommendation {
  id: ID
  gardenId: ID
  zoneId?: ID
  kind: RecommendationKind
  priority: RecommendationPriority
  title: string
  whyThisMatters: string
  nextStep: string
  due: 'today' | 'soon' | 'when-you-can'
}

