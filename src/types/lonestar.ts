export type Lane = {
  units: number[]
  goal: number
}

export type Energy = {
  id: number
  color: string
  count: number
}

export type Assignment = {
  laneIndex: number
  color: string
  count: number
}

export type LaneSummary = {
  strength: number
  deficit: number
  surplus: number
}

