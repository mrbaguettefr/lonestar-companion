import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary } from '../types/lonestar'
import { computeUnitStrength, computeSupportPassiveBonus, type EffectContext } from './effects'
import { canDropEnergyInSlot } from './gameData'
import { sum } from './numbers'

export function summarizeLanes(lanes: Lane[], battleContext: BattleContext): LaneSummary[] {
  const allLaneCells = lanes.map((l) => l.cells)

  const highestPointInBattle = Math.max(
    0,
    ...lanes.flatMap((lane) =>
      lane.cells.flatMap((cell) =>
        cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.point) : [],
      ),
    ),
  )

  return lanes.map((lane, laneIndex) => {
    const laneLoadedColors = new Set(
      lane.cells.flatMap((cell) =>
        cell ? cell.loadedEnergy.filter(Boolean).map((e) => e!.color) : [],
      ),
    )
    const tripower =
      laneLoadedColors.has('white') &&
      laneLoadedColors.has('blue') &&
      laneLoadedColors.has('orange')

    // Pass 1: compute each unit's own strength
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
        laneIndex,
        cellIndex,
        allLanes: allLaneCells,
        handEnergyCount: battleContext.handEnergyCount,
        tripower,
        highestPointInBattle,
      }

      return computeUnitStrength(cell, ctx)
    })

    // Pass 2: Skill_FullLoadPower — unit that gets +args[0] whenever any unit is fully loaded
    const hasFullyLoadedUnit = lane.cells.some(
      (cell) =>
        cell &&
        cell.slots.length > 0 &&
        cell.loadedEnergy.filter(Boolean).length === cell.slots.length,
    )

    const afterFullLoad = unitBreakdowns.map((bd, cellIndex) => {
      const cell = lane.cells[cellIndex]
      if (!cell || cell.skillPath !== 'Cannon_Player/Skill_FullLoadPower') return bd
      if (!hasFullyLoadedUnit || cell.loadedEnergy.every((e) => !e)) return bd
      const bonus = cell.args[0] ?? 0
      return { ...bd, effectBonus: bd.effectBonus + bonus, total: bd.total + bonus }
    })

    // Pass 3: support passive bonuses — check ALL lanes for support units (4-directional adjacency)
    const finalBreakdowns = afterFullLoad.map((bd, attackCellIdx) => {
      const attackCell = lane.cells[attackCellIdx]
      if (!attackCell || attackCell.unitType !== 'attack') return bd

      let supportBonus = 0
      lanes.forEach((otherLane, otherLaneIdx) => {
        otherLane.cells.forEach((cell, supportCellIdx) => {
          if (!cell || cell.unitType !== 'support') return
          // Skip self (shouldn't happen since support ≠ attack, but guard anyway)
          if (otherLaneIdx === laneIndex && supportCellIdx === attackCellIdx) return
          supportBonus += computeSupportPassiveBonus(
            cell,
            otherLaneIdx,
            supportCellIdx,
            laneIndex,
            attackCellIdx,
            allLaneCells,
          )
        })
      })

      if (supportBonus === 0) return bd
      return {
        ...bd,
        effectBonus: bd.effectBonus + supportBonus,
        total: bd.total + supportBonus,
        effectLabel: bd.effectLabel
          ? `${bd.effectLabel} +${supportBonus} (support)`
          : `+${supportBonus} (support)`,
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

export type Placement = {
  laneIndex: number
  cellIndex: number
  slotIndex: number
  color: string
  point: number
}

export type OptimalSolution = {
  possible: boolean
  placements: Placement[]
  totalEnergyUsed: number
  remainingDeficit: number
  spareEnergy: number
}

/**
 * Finds the minimum-card assignment of hand energies to empty attack-unit slots
 * that meets all lane strength goals.
 *
 * Strategy:
 * - Process lanes in order of deficit (highest first).
 * - Within a lane, fill most-constrained slots first (orange-only before blue/orange
 *   before any-color), so colour-specific energies are not "stolen" by permissive slots.
 * - For each slot take the highest-point compatible card remaining in the pool.
 * - Stop assigning to a lane once its deficit is covered.
 */
export function solveOptimal(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
): OptimalSolution {
  // Expand hand energies to a flat pool, sorted highest-point first.
  const pool: { color: string; point: number }[] = energies
    .flatMap((e) =>
      Array<{ color: string; point: number }>(e.count).fill({ color: e.color, point: e.point }),
    )
    .sort((a, b) => b.point - a.point)

  const placements: Placement[] = []
  let remainingDeficit = 0

  // Sort lanes by deficit descending.
  const laneOrder = [...laneSummaries.map((s, i) => ({ i, deficit: s.deficit }))].sort(
    (a, b) => b.deficit - a.deficit,
  )

  const constraintOf = (color: string) => (color === 'orange' ? 0 : color === 'blue' ? 1 : 2)

  for (const { i: laneIndex, deficit } of laneOrder) {
    if (deficit <= 0) continue

    let toFill = deficit
    const lane = lanes[laneIndex]

    // Collect empty attack-unit slots.
    const emptySlots: { cellIndex: number; slotIndex: number; slotColor: string }[] = []
    for (const [ci, cell] of lane.cells.entries()) {
      if (!cell || cell.unitType !== 'attack') continue
      for (const [si, slotColor] of cell.slots.entries()) {
        if (cell.loadedEnergy[si] === null) {
          emptySlots.push({ cellIndex: ci, slotIndex: si, slotColor })
        }
      }
    }

    // Sort: most constrained colour first, then by best available compatible card point desc.
    emptySlots.sort((a, b) => {
      const ca = constraintOf(a.slotColor)
      const cb = constraintOf(b.slotColor)
      if (ca !== cb) return ca - cb
      const bestA = Math.max(0, ...pool.filter((c) => canDropEnergyInSlot(c.color, a.slotColor)).map((c) => c.point))
      const bestB = Math.max(0, ...pool.filter((c) => canDropEnergyInSlot(c.color, b.slotColor)).map((c) => c.point))
      return bestB - bestA
    })

    for (const slot of emptySlots) {
      if (toFill <= 0) break
      // Pool is sorted high→low; findIndex gives the highest-point compatible card.
      const idx = pool.findIndex((c) => canDropEnergyInSlot(c.color, slot.slotColor))
      if (idx === -1) continue
      const [card] = pool.splice(idx, 1)
      placements.push({
        laneIndex,
        cellIndex: slot.cellIndex,
        slotIndex: slot.slotIndex,
        color: card.color,
        point: card.point,
      })
      toFill -= card.point
    }

    if (toFill > 0) remainingDeficit += toFill
  }

  return {
    possible: remainingDeficit === 0,
    placements,
    totalEnergyUsed: placements.length,
    remainingDeficit,
    spareEnergy: pool.length,
  }
}

export function buildBattleContext(energies: Energy[]): BattleContext {
  return { handEnergyCount: sum(energies.map((e) => e.count)) }
}

export function previewUnitStrength(
  unit: LaneUnit,
  lane: Array<LaneUnit | null>,
  cellIndex: number,
  handEnergyCount: number,
  allLanes: Array<Array<LaneUnit | null>>,
): number {
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
    laneIndex: 0,
    cellIndex,
    allLanes,
    handEnergyCount,
    tripower,
    highestPointInBattle: highestPoint,
  }

  return computeUnitStrength(unit, ctx).total
}
