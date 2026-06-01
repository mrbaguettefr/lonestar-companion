import type { Energy, Lane } from '../types/lonestar'

export const maxLaneColumns = 3

export function getLaneName(laneIndex: number) {
  return `Lane ${laneIndex + 1}`
}

export function createEmptyLanes(laneCount: number, columnCount = maxLaneColumns): Lane[] {
  const safeColumnCount = Math.min(Math.max(1, columnCount), maxLaneColumns)

  return Array.from({ length: laneCount }, () => ({
    cells: Array.from({ length: safeColumnCount }, () => null),
    goal: 0,
  }))
}

export const energyColors = ['white', 'blue', 'orange']

export const energyPoints = [1, 2, 3, 4, 5, 6, 7, 8, 9]

export const initialLanes: Lane[] = []

export const initialEnergies: Energy[] = [
  { id: 1, color: 'white', count: 1, point: 3 },
  { id: 2, color: 'blue', count: 1, point: 3 },
  { id: 3, color: 'orange', count: 1, point: 3 },
]

export function canDropEnergyInSlot(energyColor: string, slotColor: string): boolean {
  if (slotColor === 'white') return true
  if (slotColor === 'blue') return energyColor === 'blue' || energyColor === 'orange'
  if (slotColor === 'orange') return energyColor === 'orange'
  return false
}

export function extractStaticPower(rawProperties: string): number {
  const match = rawProperties.match(/;PA:(\d+)/)
  return match ? Number(match[1]) : 0
}

/** Parse overclock thresholds from raw properties.
 * Returns [OC1, OC2] for two-level units, or [OC] for single-level units. */
export function extractOverclockThresholds(rawProperties: string): number[] {
  const oc1 = rawProperties.match(/;OC1:(\d+)/)
  const oc2 = rawProperties.match(/;OC2:(\d+)/)
  if (oc1 && oc2) return [Number(oc1[1]), Number(oc2[1])]
  const oc = rawProperties.match(/;OC:(\d+)/)
  if (oc) return [Number(oc[1])]
  return []
}

/** Parse max activations from the effect text. Returns 0 if the unit is not activatable. */
export function extractMaxActivations(effect: string): number {
  if (!effect.includes('*Activate*')) return 0
  const match = effect.match(/(\d+) times per battle/)
  if (match) return Number(match[1])
  return 1
}
