import type { Energy, Lane } from '../types/lonestar'

export const laneNames = ['Top lane', 'Middle lane', 'Bottom lane']

export const energyColors = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'White']

export const initialLanes: Lane[] = [
  { units: [3, 2], goal: 8 },
  { units: [4], goal: 7 },
  { units: [2, 1], goal: 5 },
]

export const initialEnergies: Energy[] = [
  { id: 1, color: 'Red', count: 2 },
  { id: 2, color: 'Blue', count: 2 },
  { id: 3, color: 'Yellow', count: 1 },
]

