import type { Energy, Lane } from '../types/lonestar'

export const laneNames = ['Top lane', 'Middle lane', 'Bottom lane']

export const maxLaneColumns = 3

export function getLaneName(laneIndex: number) {
  return laneNames[laneIndex] ?? `Lane ${laneIndex + 1}`
}

export function createEmptyLanes(laneCount: number, columnCount = maxLaneColumns): Lane[] {
  const safeColumnCount = Math.min(Math.max(1, columnCount), maxLaneColumns)

  return Array.from({ length: laneCount }, () => ({
    cells: Array.from({ length: safeColumnCount }, () => null),
    goal: 0,
  }))
}

export const energyColors = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'White']

export const initialLanes: Lane[] = []

export const initialEnergies: Energy[] = [
  { id: 1, color: 'Red', count: 2 },
  { id: 2, color: 'Blue', count: 2 },
  { id: 3, color: 'Yellow', count: 1 },
]
