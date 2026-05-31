export type Lane = {
  cells: Array<LaneUnit | null>
  goal: number
}

export type LaneUnit = {
  unitId: number
  name: string
  power: number
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

export type PlayerShip = {
  id: number
  key: string
  name: string
  description: string
  move: number
  lanes: number
  columns: number
  in_game: boolean | null
}

export type UnitOption = {
  id: number
  name: string
}

export type LonestarData = {
  ships: {
    players: PlayerShip[]
  }
  units: Array<{
    id: number
    base_name: string
    upgraded_name?: string
  }>
}
