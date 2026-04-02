import type { WeatherService } from './weatherService'
import type { WeatherSummary } from '../../types'

const MOCK_WEATHER: WeatherSummary = {
  summary: 'Warm afternoon, cooling evening',
  highF: 88,
  lowF: 57,
  precipitationChancePct: 10,
  windMph: 7,
  wateringWindow: {
    label: 'Good time to water today: 7:30–9:00pm',
    reason:
      'Cooler evening air helps water soak in better and reduces stress on your plants.',
  },
}

export const mockWeatherService: WeatherService = {
  async getWeatherSummary(): Promise<WeatherSummary> {
    await new Promise((r) => setTimeout(r, 80))
    return MOCK_WEATHER
  },
}

