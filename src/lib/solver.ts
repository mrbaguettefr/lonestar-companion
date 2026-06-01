import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary, LoadedEnergy } from '../types/lonestar'
import { computeUnitStrength, computeSupportPassiveBonus, type EffectContext } from './effects'
import { canDropEnergyInSlot } from './gameData'
import { sum } from './numbers'

export type SolverStrategy = 'least-cards' | 'efficiency' | 'max-damage'

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

export type SolutionStats = {
  energiesUsed: number
  strengthGenerated: number
  damageDealt: number
  damageReceived: number
  efficiencyRatio: number
}

export type RankedSolution = {
  placements: Placement[]
  possible: boolean
  totalEnergyUsed: number
  remainingDeficit: number
  spareEnergy: number
  stats: SolutionStats
}

// ── Shared helpers ─────────────────────────────────────────────────────────

/** Apply a placement list to a cloned lane array (non-mutating). */
function simulatePlacements(lanes: Lane[], placements: Placement[]): Lane[] {
  return lanes.map((lane, li) => ({
    ...lane,
    cells: lane.cells.map((cell, ci) => {
      if (!cell) return cell
      const lp = placements.filter((p) => p.laneIndex === li && p.cellIndex === ci)
      if (lp.length === 0) return cell
      const newLoaded = [...cell.loadedEnergy]
      for (const p of lp) newLoaded[p.slotIndex] = { color: p.color, point: p.point }
      return { ...cell, loadedEnergy: newLoaded }
    }),
  }))
}

function computeSolutionStats(
  lanes: Lane[],
  placements: Placement[],
  finalHandCount: number,
): SolutionStats {
  const simLanes = simulatePlacements(lanes, placements)
  const summaries = summarizeLanes(simLanes, { handEnergyCount: finalHandCount })
  const strengthGenerated = sum(summaries.map((s) => s.strength))
  const damageDealt = sum(summaries.map((s) => s.surplus))
  const damageReceived = sum(summaries.map((s) => s.deficit))
  const energiesUsed = placements.length
  const efficiencyRatio = strengthGenerated > 0 ? energiesUsed / strengthGenerated : 0
  return { energiesUsed, strengthGenerated, damageDealt, damageReceived, efficiencyRatio }
}

function toRanked(
  placements: Placement[],
  lanes: Lane[],
  totalHandCount: number,
): RankedSolution {
  const finalHandCount = totalHandCount - placements.length
  const stats = computeSolutionStats(lanes, placements, finalHandCount)
  return {
    placements,
    possible: stats.damageReceived === 0,
    totalEnergyUsed: placements.length,
    remainingDeficit: stats.damageReceived,
    spareEnergy: totalHandCount - placements.length,
    stats,
  }
}

// ── Unified global backtracking solver ────────────────────────────────────

type GlobalSlot = {
  laneIndex: number
  cellIndex: number
  slotIndex: number
  slotColor: string
}

type SearchCard = { color: string; point: number }

/** Shallow-clone a lane's cell array so loadedEnergy arrays can be safely mutated. */
function cloneLaneCells(cells: (LaneUnit | null)[]): (LaneUnit | null)[] {
  return cells.map((cell) =>
    cell ? { ...cell, loadedEnergy: [...cell.loadedEnergy] } : null,
  )
}

/**
 * Compute attack-unit strength for a single lane using actual effect handlers.
 * Uses a simplified context (no cross-lane support) for speed inside the search.
 */
function computeLaneAttackStrength(
  cells: (LaneUnit | null)[],
  laneIndex: number,
  handEnergyCount: number,
): number {
  const loadedColors = new Set(
    cells.flatMap((c) => (c ? c.loadedEnergy.filter(Boolean).map((e) => e!.color) : [])),
  )
  const tripower =
    loadedColors.has('white') && loadedColors.has('blue') && loadedColors.has('orange')
  const highestPoint = Math.max(
    0,
    ...cells.flatMap((c) => (c ? c.loadedEnergy.filter(Boolean).map((e) => e!.point) : [])),
  )
  return cells.reduce((total, cell, cellIndex) => {
    if (!cell || cell.unitType !== 'attack') return total
    const ctx: EffectContext = {
      lane: cells,
      laneIndex,
      cellIndex,
      allLanes: [cells],
      handEnergyCount,
      tripower,
      highestPointInBattle: highestPoint,
    }
    return total + computeUnitStrength(cell, ctx).total
  }, 0)
}

/**
 * Global recursive backtracking across all empty attack slots in all lanes.
 * Records every complete assignment (all slots processed or pool exhausted).
 * `budget` limits total recursive calls to keep it performant.
 */
function searchGlobal(
  allSlots: GlobalSlot[],
  slotIdx: number,
  mutableLaneCells: Map<number, (LaneUnit | null)[]>,
  pool: SearchCard[],
  placements: Placement[],
  collector: Placement[][],
  budget: { remaining: number },
  handEnergyCount: number,
): void {
  if (budget.remaining <= 0) return
  budget.remaining--

  // All slots processed — record this assignment
  if (slotIdx >= allSlots.length || pool.length === 0) {
    collector.push([...placements])
    return
  }

  const slot = allSlots[slotIdx]
  const cells = mutableLaneCells.get(slot.laneIndex)!
  const cell = cells[slot.cellIndex]
  if (!cell) {
    searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, placements, collector, budget, handEnergyCount)
    return
  }

  const tried = new Set<string>()
  const options: { card: SearchCard; pidx: number }[] = []

  for (let i = 0; i < pool.length; i++) {
    const card = pool[i]
    if (!canDropEnergyInSlot(card.color, slot.slotColor)) continue
    const key = `${card.color}:${card.point}`
    if (tried.has(key)) continue
    tried.add(key)
    options.push({ card, pidx: i })
  }

  // Sort options by marginal strength contribution (desc) for better pruning
  const baseStrength = computeLaneAttackStrength(cells, slot.laneIndex, handEnergyCount)
  options.sort((a, b) => {
    const prev = cell.loadedEnergy[slot.slotIndex]
    cell.loadedEnergy[slot.slotIndex] = { color: a.card.color, point: a.card.point } as LoadedEnergy
    const contribA = computeLaneAttackStrength(cells, slot.laneIndex, handEnergyCount) - baseStrength
    cell.loadedEnergy[slot.slotIndex] = { color: b.card.color, point: b.card.point } as LoadedEnergy
    const contribB = computeLaneAttackStrength(cells, slot.laneIndex, handEnergyCount) - baseStrength
    cell.loadedEnergy[slot.slotIndex] = prev
    return contribB - contribA
  })

  for (const { card } of options) {
    const idx = pool.findIndex((c) => c.color === card.color && c.point === card.point)
    if (idx === -1) continue

    const prev = cell.loadedEnergy[slot.slotIndex]
    cell.loadedEnergy[slot.slotIndex] = { color: card.color, point: card.point } as LoadedEnergy
    pool.splice(idx, 1)

    searchGlobal(
      allSlots, slotIdx + 1, mutableLaneCells, pool,
      [...placements, { laneIndex: slot.laneIndex, cellIndex: slot.cellIndex, slotIndex: slot.slotIndex, color: card.color, point: card.point }],
      collector, budget, handEnergyCount,
    )

    pool.splice(idx, 0, card)
    cell.loadedEnergy[slot.slotIndex] = prev
  }

  // Also try skipping this slot
  searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, placements, collector, budget, handEnergyCount)
}

function rankSolutions(
  rawSolutions: Placement[][],
  lanes: Lane[],
  totalHandCount: number,
  strategy: SolverStrategy,
  max: number,
): RankedSolution[] {
  // Convert and deduplicate
  const seen = new Set<string>()
  const ranked: RankedSolution[] = []

  for (const placements of rawSolutions) {
    const key = [...placements]
      .sort((a, b) =>
        a.laneIndex !== b.laneIndex ? a.laneIndex - b.laneIndex :
        a.cellIndex !== b.cellIndex ? a.cellIndex - b.cellIndex :
        a.slotIndex - b.slotIndex,
      )
      .map((p) => `${p.laneIndex}:${p.cellIndex}:${p.slotIndex}:${p.color}:${p.point}`)
      .join('|')

    if (seen.has(key)) continue
    seen.add(key)
    ranked.push(toRanked(placements, lanes, totalHandCount))
  }

  // Sort by strategy criterion
  if (strategy === 'least-cards') {
    ranked.sort((a, b) =>
      a.totalEnergyUsed !== b.totalEnergyUsed
        ? a.totalEnergyUsed - b.totalEnergyUsed
        : b.stats.strengthGenerated - a.stats.strengthGenerated,
    )
  } else if (strategy === 'efficiency') {
    ranked.sort((a, b) =>
      a.stats.efficiencyRatio !== b.stats.efficiencyRatio
        ? a.stats.efficiencyRatio - b.stats.efficiencyRatio
        : b.stats.strengthGenerated - a.stats.strengthGenerated,
    )
  } else {
    // max-damage: highest total strength first
    ranked.sort((a, b) =>
      b.stats.strengthGenerated !== a.stats.strengthGenerated
        ? b.stats.strengthGenerated - a.stats.strengthGenerated
        : a.totalEnergyUsed - b.totalEnergyUsed,
    )
  }

  return ranked.slice(0, max)
}

export function solveMultiple(
  lanes: Lane[],
  _laneSummaries: LaneSummary[],
  energies: Energy[],
  strategy: SolverStrategy = 'least-cards',
  max = 5,
): RankedSolution[] {
  const pool: SearchCard[] = energies.flatMap((e) =>
    Array<SearchCard>(e.count).fill({ color: e.color, point: e.point }),
  )
  const totalHandCount = pool.length

  // Collect all empty attack slots across all lanes
  const constraintOf = (color: string) => (color === 'orange' ? 0 : color === 'blue' ? 1 : 2)
  const allSlots: GlobalSlot[] = []
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const [ci, cell] of lane.cells.entries()) {
      if (!cell || cell.unitType !== 'attack') continue
      for (const [si, slotColor] of cell.slots.entries()) {
        if (cell.loadedEnergy[si] === null) {
          allSlots.push({ laneIndex, cellIndex: ci, slotIndex: si, slotColor })
        }
      }
    }
  }
  allSlots.sort((a, b) => constraintOf(a.slotColor) - constraintOf(b.slotColor))

  if (allSlots.length === 0 || pool.length === 0) {
    return [toRanked([], lanes, totalHandCount)]
  }

  // Build mutable per-lane cell clones for the search
  const mutableLaneCells = new Map<number, (LaneUnit | null)[]>()
  for (const [i, lane] of lanes.entries()) {
    mutableLaneCells.set(i, cloneLaneCells(lane.cells))
  }

  const collector: Placement[][] = []
  const budget = { remaining: 50_000 }

  searchGlobal(allSlots, 0, mutableLaneCells, [...pool], [], collector, budget, totalHandCount)

  // Always include the empty solution as a baseline
  if (!collector.some((p) => p.length === 0)) collector.push([])

  return rankSolutions(collector, lanes, totalHandCount, strategy, max)
}

/** Kept for the reactive isPossible check in App.tsx. */
export function solveOptimal(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
  strategy: SolverStrategy = 'least-cards',
): OptimalSolution {
  const results = solveMultiple(lanes, laneSummaries, energies, strategy, 1)
  if (results.length === 0) {
    return { possible: false, placements: [], totalEnergyUsed: 0, remainingDeficit: 0, spareEnergy: 0 }
  }
  const r = results[0]
  return {
    possible: r.possible,
    placements: r.placements,
    totalEnergyUsed: r.totalEnergyUsed,
    remainingDeficit: r.remainingDeficit,
    spareEnergy: r.spareEnergy,
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
