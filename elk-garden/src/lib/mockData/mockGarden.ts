import type { Garden } from '../../types'

export function getMockGarden(): Garden {
  const now = new Date()
  const isoMinutesAgo = (min: number) =>
    new Date(now.getTime() - min * 60_000).toISOString()

  return {
    id: 'garden_elk_home',
    name: 'ELK Garden',
    timezone: 'America/Denver',
    zones: [
      {
        id: 'zone_tomatoes',
        name: 'Tomatoes',
        sortOrder: 1,
        moistureStatus: 'dry',
        headline:
          'Getting a little dry — a deeper soak this evening will help them stay strong and support fruit growth.',
        health: 'watch',
      },
      {
        id: 'zone_greens',
        name: 'Greens',
        sortOrder: 2,
        moistureStatus: 'good',
        headline:
          'Looking steady. Keeping moisture consistent will help them stay tender and healthy.',
        health: 'good',
      },
      {
        id: 'zone_roots',
        name: 'Root crops',
        sortOrder: 3,
        moistureStatus: 'good',
        headline:
          'Soil looks nicely balanced. Staying consistent here will help roots grow evenly.',
        health: 'good',
      },
      {
        id: 'zone_melons',
        name: 'Melons',
        sortOrder: 4,
        moistureStatus: 'wet',
        headline:
          'A bit on the wet side — letting the soil breathe will help prevent stress and mildew.',
        health: 'watch',
      },
    ],
    sensors: [
      {
        id: 'sensor_tomatoes_moisture',
        zoneId: 'zone_tomatoes',
        kind: 'soilMoisture',
        label: 'Tomatoes bed',
        unit: '%',
      },
      {
        id: 'sensor_greens_moisture',
        zoneId: 'zone_greens',
        kind: 'soilMoisture',
        label: 'Greens bed',
        unit: '%',
      },
      {
        id: 'sensor_roots_moisture',
        zoneId: 'zone_roots',
        kind: 'soilMoisture',
        label: 'Roots bed',
        unit: '%',
      },
      {
        id: 'sensor_melons_moisture',
        zoneId: 'zone_melons',
        kind: 'soilMoisture',
        label: 'Melons bed',
        unit: '%',
      },
      {
        id: 'sensor_garden_temp',
        zoneId: 'zone_tomatoes',
        kind: 'temperature',
        label: 'Garden air',
        unit: '°F',
      },
    ],
    readings: [
      {
        id: 'reading_tomatoes_1',
        sensorId: 'sensor_tomatoes_moisture',
        capturedAtISO: isoMinutesAgo(35),
        value: 21,
      },
      {
        id: 'reading_greens_1',
        sensorId: 'sensor_greens_moisture',
        capturedAtISO: isoMinutesAgo(33),
        value: 36,
      },
      {
        id: 'reading_roots_1',
        sensorId: 'sensor_roots_moisture',
        capturedAtISO: isoMinutesAgo(31),
        value: 34,
      },
      {
        id: 'reading_melons_1',
        sensorId: 'sensor_melons_moisture',
        capturedAtISO: isoMinutesAgo(30),
        value: 46,
      },
      {
        id: 'reading_temp_1',
        sensorId: 'sensor_garden_temp',
        capturedAtISO: isoMinutesAgo(28),
        value: 84,
      },
    ],
    recommendations: [
      {
        id: 'rec_water_west',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_tomatoes',
        kind: 'watering',
        priority: 'high',
        title: 'Give your tomatoes a deep soak this evening',
        whyThisMatters:
          'Watering later in the day helps reduce evaporation and keeps moisture where the plants need it.',
        nextStep:
          "If you're unsure, aim for the base of the plant for about 10–15 minutes.",
        due: 'today',
      },
      {
        id: 'rec_melons_dry_out',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_melons',
        kind: 'check',
        priority: 'medium',
        title: 'Let the melons dry out a bit',
        whyThisMatters:
          'Giving the soil a short break helps roots grow deeper and prevents mildew.',
        nextStep: 'Skip watering today and check again tomorrow morning.',
        due: 'today',
      },
      {
        id: 'rec_greens_morning_check',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_greens',
        kind: 'check',
        priority: 'low',
        title: 'Keep greens tender with steady moisture',
        whyThisMatters:
          'Greens stay sweeter and less bitter when they don’t swing between dry and wet.',
        nextStep: 'If the top inch feels dry this evening, give a light watering.',
        due: 'when-you-can',
      },
      {
        id: 'rec_roots_even_moisture',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_roots',
        kind: 'watering',
        priority: 'low',
        title: 'Keep root crops steady',
        whyThisMatters:
          'Even moisture helps roots size up smoothly and reduces cracking.',
        nextStep: 'Water gently if the soil feels dry 1–2 inches down.',
        due: 'soon',
      },
      {
        id: 'rec_quick_walkthrough',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_tomatoes',
        kind: 'check',
        priority: 'low',
        title: 'Take a quick 2-minute walk through the garden',
        whyThisMatters:
          'A simple check often catches small issues early — no need to overthink it.',
        nextStep: 'Take a quick look at leaves, stems, and soil — then you’re done.',
        due: 'today',
      },
      {
        id: 'rec_check_cukes',
        gardenId: 'garden_elk_home',
        kind: 'pest',
        priority: 'low',
        title: 'Quick pest check in the morning',
        whyThisMatters: 'Catching pests early is easier and less stressful.',
        nextStep: 'Look under leaves for small clusters or chew marks.',
        due: 'when-you-can',
      },
    ],
    tasks: [
      {
        id: 'task_water_tomatoes',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_tomatoes',
        title: 'Water tomatoes this evening (focus on the base)',
        supportiveNote: 'Aim for the base of the plant, not the leaves.',
        completed: false,
      },
      {
        id: 'task_walkthrough',
        gardenId: 'garden_elk_home',
        title: 'Quick garden walkthrough',
        supportiveNote: 'A 2-minute look often catches issues early.',
        completed: false,
      },
      {
        id: 'task_harvest_greens',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_greens',
        title: 'Harvest a small handful of greens',
        supportiveNote: 'Frequent harvest keeps greens tender and productive.',
        completed: true,
      },
    ],
    cameraInsights: [
      {
        id: 'insight_animal_1',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_tomatoes',
        kind: 'animalActivity',
        title: 'Something may have visited last night',
        detail:
          'Movement near your tomatoes around 2:10am. Worth a quick look for any nibbling or damage.',
        capturedAtISO: isoMinutesAgo(720),
        confidence: 'medium',
      },
      {
        id: 'insight_stress_1',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_greens',
        kind: 'plantStress',
        title: 'A few leaves look a bit tired',
        detail:
          'Some plants may be slightly stressed. Consistent watering usually helps them bounce back.',
        capturedAtISO: isoMinutesAgo(260),
        confidence: 'low',
      },
      {
        id: 'insight_roots_1',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_roots',
        kind: 'growthIssue',
        title: 'One spot is growing a bit slower',
        detail:
          'If it continues, we can check sunlight and soil conditions together.',
        capturedAtISO: isoMinutesAgo(410),
        confidence: 'low',
      },
      {
        id: 'insight_growth_1',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_melons',
        kind: 'growthIssue',
        title: 'One spot is growing a bit slower',
        detail:
          'If it continues, we can check sunlight and soil conditions together.',
        capturedAtISO: isoMinutesAgo(340),
        confidence: 'medium',
      },
      {
        id: 'insight_melons_2',
        gardenId: 'garden_elk_home',
        zoneId: 'zone_melons',
        kind: 'plantStress',
        title: 'A few leaves look a bit tired',
        detail:
          'Some plants may be slightly stressed. A short dry-down and gentle airflow usually helps.',
        capturedAtISO: isoMinutesAgo(180),
        confidence: 'medium',
      },
    ],
  }
}

