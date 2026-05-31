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

export const initialLanes: Lane[] = []

export const initialEnergies: Energy[] = [
  { id: 1, color: 'white', count: 1 },
  { id: 2, color: 'blue', count: 1 },
  { id: 3, color: 'orange', count: 1 },
]
