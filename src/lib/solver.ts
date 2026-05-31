import type { Assignment, BattleContext, Energy, Lane, LaneUnit, LaneSummary } from '../types/lonestar'
import { computeUnitStrength, type EffectContext } from './effects'
import { sum } from './numbers'

export function summarizeLanes(lanes: Lane[], battleContext: BattleContext): LaneSummary[] {
  const allLaneCells = lanes.map((l) => l.cells)

  // Precompute highest loaded point across all units in all lanes
  const highestPointInBattle = Math.max(
    0,
    ...lanes.flatMap((lane) =>
      lane.cells.flatMap((cell) =>
        cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.point) : [],
      ),
    ),
  )

  return lanes.map((lane, _laneIndex) => {
    // Precompute tripower for this lane: any orange+blue+white loaded in the lane
    const laneLoadedColors = new Set(
      lane.cells.flatMap((cell) =>
        cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.color) : [],
      ),
    )
    const tripower =
      laneLoadedColors.has('white') &&
      laneLoadedColors.has('blue') &&
      laneLoadedColors.has('orange')

    const unitBreakdowns = lane.cells.map((cell, cellIndex) => {
      if (!cell) {
        return {
          cellIndex,
          basePoints: 0,
          staticPower: 0,
          effectBonus: 0,
          isDoubled: false,
          total: 0,
          effectLabel: null,
          isManualOverride: false,
        }
      }

      const ctx: EffectContext = {
        lane: lane.cells,
        cellIndex,
        allLanes: allLaneCells,
        handEnergyCount: battleContext.handEnergyCount,
        tripower,
        highestPointInBattle,
      }

      return computeUnitStrength(cell, ctx)
    })

    // Second pass: Skill_FullLoadPower — when any fully-loaded unit is present,
    // add args[0] to units with Skill_FullLoadPower
    const hasFullyLoadedUnit = lane.cells.some(
      (cell) =>
        cell &&
        cell.slots.length > 0 &&
        cell.loadedEnergy.filter(Boolean).length === cell.slots.length,
    )

    const finalBreakdowns = unitBreakdowns.map((bd, cellIndex) => {
      const cell = lane.cells[cellIndex]
      if (!cell || cell.skillPath !== 'Cannon_Player/Skill_FullLoadPower') return bd
      if (!hasFullyLoadedUnit || cell.loadedEnergy.every((e) => !e)) return bd
      const bonus = cell.args[0] ?? 0
      return {
        ...bd,
        effectBonus: bd.effectBonus + bonus,
        total: bd.total + bonus,
        effectLabel: `+${bd.effectBonus + bonus} (fully-loaded trigger)`,
      }
    })

    const strength = sum(finalBreakdowns.map((bd) => bd.total))

    return {
      strength,
      deficit: Math.max(0, lane.goal - strength),
      surplus: Math.max(0, strength - lane.goal),
      unitBreakdowns: finalBreakdowns,
    }
  })
}

export function solveLaneAssignments(energies: Energy[], laneSummaries: LaneSummary[]) {
  const totalEnergy = sum(energies.map((energy) => energy.count))
  const totalNeeded = sum(laneSummaries.map((lane) => lane.deficit))
  const assignments: Assignment[] = []
  const remainingByLane = laneSummaries.map((lane) => lane.deficit)

  for (const energy of energies) {
    let available = energy.count

    for (let laneIndex = 0; laneIndex < remainingByLane.length; laneIndex += 1) {
      if (available === 0) {
        break
      }

      const used = Math.min(available, remainingByLane[laneIndex])
      if (used > 0) {
        assignments.push({ laneIndex, color: energy.color, count: used })
        available -= used
        remainingByLane[laneIndex] -= used
      }
    }
  }

  return {
    assignments,
    possible: totalEnergy >= totalNeeded,
    remainingByLane,
    spareEnergy: Math.max(0, totalEnergy - totalNeeded),
    totalEnergy,
    totalNeeded,
  }
}

export function buildBattleContext(energies: Energy[]): BattleContext {
  return { handEnergyCount: sum(energies.map((e) => e.count)) }
}

// Keep a backwards-compatible unit strength helper for use in the dialog preview
export function previewUnitStrength(unit: LaneUnit, lane: Array<LaneUnit | null>, cellIndex: number, handEnergyCount: number, allLanes: Array<Array<LaneUnit | null>>): number {
  const loadedColors = new Set(
    lane.flatMap((cell) =>
      cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.color) : [],
    ),
  )
  const tripower =
    loadedColors.has('white') && loadedColors.has('blue') && loadedColors.has('orange')

  const highestPoint = Math.max(
    0,
    ...allLanes.flatMap((l) =>
      l.flatMap((cell) =>
        cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.point) : [],
      ),
    ),
  )

  const ctx: EffectContext = {
    lane,
    cellIndex,
    allLanes,
    handEnergyCount,
    tripower,
    highestPointInBattle: highestPoint,
  }

  return computeUnitStrength(unit, ctx).total
}
