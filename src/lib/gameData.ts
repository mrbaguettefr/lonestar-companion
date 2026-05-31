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

export function extractStaticPower(rawProperties: string): number {
  const match = rawProperties.match(/;PA:(\d+)/)
  return match ? Number(match[1]) : 0
}
