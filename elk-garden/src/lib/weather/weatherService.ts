import type { WeatherSummary } from '../../types'
import { mockWeatherService } from './mockWeatherService'

export interface WeatherService {
  getWeatherSummary(gardenId: string): Promise<WeatherSummary>
}

export const weatherService: WeatherService = mockWeatherService

