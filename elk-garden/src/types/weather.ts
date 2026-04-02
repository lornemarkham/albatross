export interface WeatherSummary {
  summary: string
  highF: number
  lowF: number
  precipitationChancePct: number
  windMph: number
  wateringWindow: {
    label: string
    reason: string
  }
}

