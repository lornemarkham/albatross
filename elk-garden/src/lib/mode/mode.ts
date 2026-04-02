import type { GardenMode } from '../../types'

export function gardenModeLabel(mode: GardenMode) {
  return mode === 'production' ? 'Lorne Mode ⚙️' : 'Kathy Mode 🌿'
}

export function modeCopy({
  mode,
  kathy,
  lorne,
}: {
  mode: GardenMode
  kathy: string
  lorne: string
}) {
  return mode === 'production' ? lorne : kathy
}

export function taskToggleMessage(mode: GardenMode, completed: boolean) {
  if (mode === 'production') {
    return completed ? 'Good. Keep going.' : 'Not done. Finish it.'
  }
  return completed
    ? 'Nice work — that makes a difference.'
    : "All good — you can come back to it anytime."
}

