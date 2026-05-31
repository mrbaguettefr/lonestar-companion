export type LoadedEnergy = {
  color: string
  point: number
}

export type UnitStrengthBreakdown = {
  cellIndex: number
  basePoints: number
  staticPower: number
  effectBonus: number
  isDoubled: boolean
  total: number
  effectLabel: string | null
  isManualOverride: boolean
}

export type BattleContext = {
  handEnergyCount: number
}

export type Lane = {
  cells: Array<LaneUnit | null>
  goal: number
}

export type LaneUnit = {
  unitId: number
  level: number
  name: string
  skillPath: string
  unitType: 'attack' | 'support'
  staticPower: number
  slots: string[]
  loadedEnergy: (LoadedEnergy | null)[]
  manualPowerOverride: number | null
  effect: string
  args: number[]
}

export type Energy = {
  id: number
  color: string
  count: number
  point: number
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
  unitBreakdowns: UnitStrengthBreakdown[]
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
  skillPath: string
  unitType: 'attack' | 'support'
  staticPower: number
  effect: string
  args: number[]
  shipKeys: string[]
}

export type LonestarData = {
  ships: {
    players: PlayerShip[]
  }
  units: Array<{
    id: number
    skill_path: string
    type: 'attack' | 'support'
    base_name: string
    upgraded_name?: string
    ships: Array<{
      kind: string
      ship: string
    }>
    levels: Array<{
      level: number
      name: string
      slots: string[]
      effect: string
      extra_effect: string
      args: number[]
      raw: { properties: string }
    }>
  }>
}
