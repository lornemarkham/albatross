export type GardenGoal =
  | 'high_yield'
  | 'simple_low_effort'
  | 'beauty_and_food'
  | 'figuring_it_out'

export type InvolvementLevel = 'daily' | 'few_times_week' | 'low_maintenance'

export type LayoutStyle = 'clear_beds' | 'mixed_spaces' | 'planning_layout'

export type CropType =
  | 'tomatoes'
  | 'greens'
  | 'root_vegetables'
  | 'herbs'
  | 'melons'
  | 'flowers'
  | 'other'

export interface GardenProfile {
  goal: GardenGoal | null
  crops: CropType[]
  otherCrop?: string
  involvement: InvolvementLevel | null
  layout: LayoutStyle | null
  completedAtISO?: string
}

