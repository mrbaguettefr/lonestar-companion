export type Lane = {
  cells: Array<LaneUnit | null>
  goal: number
}

export type LaneUnit = {
  unitId: number
  level: number
  name: string
  power: number
  slots: string[]
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
  starting_units: StartingUnit[]
  in_game: boolean | null
}

export type StartingUnit = {
  unit_id: number
  level: number
  lane: number
  column: number
}

export type UnitOption = {
  key: string
  unitId: number
  level: number
  name: string
  slots: string[]
  shipKeys: string[]
}

export type LonestarData = {
  ships: {
    players: PlayerShip[]
  }
  units: Array<{
    id: number
    base_name: string
    upgraded_name?: string
    ships: Array<{
      kind: string
      ship: string
    }>
    levels: Record<
      string,
      {
        level: number
        name: string
        slots: string[]
      }
    >
  }>
}
