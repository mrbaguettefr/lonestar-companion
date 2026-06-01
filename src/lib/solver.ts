import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary, LoadedEnergy } from '../types/lonestar'
import { computeUnitStrength, computeSupportPassiveBonus, type EffectContext } from './effects'
import { canDropEnergyInSlot } from './gameData'
import { sum } from './numbers'

export type SolverStrategy = 'least-cards' | 'efficiency'

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

export function solveOptimal(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
  strategy: SolverStrategy = 'least-cards',
): OptimalSolution {
  if (strategy === 'efficiency') return solveEfficiency(lanes, laneSummaries, energies)
  return solveLeastCards(lanes, laneSummaries, energies)
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

/**
 * Verify placements against the full summarizeLanes (includes cross-lane support
 * bonuses such as Amplification Device) and return the final OptimalSolution.
 * This corrects for effects that raw-point arithmetic misses.
 */
function finalizeResult(
  lanes: Lane[],
  placements: Placement[],
  spareEnergy: number,
  finalHandCount: number,
): OptimalSolution {
  const simLanes = simulatePlacements(lanes, placements)
  const summaries = summarizeLanes(simLanes, { handEnergyCount: finalHandCount })
  const remaining = Math.max(0, sum(summaries.map((s) => s.deficit)))
  return {
    possible: remaining === 0,
    placements,
    totalEnergyUsed: placements.length,
    remainingDeficit: remaining,
    spareEnergy,
  }
}

// ── Least-cards strategy ───────────────────────────────────────────────────

/**
 * Greedy minimum-card solver.
 * - Processes lanes highest-deficit first.
 * - Most-constrained slots first within each lane.
 * - Highest-point compatible card first.
 * - Stop condition uses actual computeLaneAttackStrength (not raw points)
 *   so OC/pair/effect bonuses are respected.
 * - Final pass/fail is verified via the full summarizeLanes to include
 *   cross-lane support effects (e.g. Amplification Device).
 */
function solveLeastCards(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
): OptimalSolution {
  const pool: { color: string; point: number }[] = energies
    .flatMap((e) =>
      Array<{ color: string; point: number }>(e.count).fill({ color: e.color, point: e.point }),
    )
    .sort((a, b) => b.point - a.point)

  const handEnergyCount = pool.length
  const placements: Placement[] = []
  const constraintOf = (color: string) => (color === 'orange' ? 0 : color === 'blue' ? 1 : 2)

  const laneOrder = [...laneSummaries.map((s, i) => ({ i, deficit: s.deficit }))].sort(
    (a, b) => b.deficit - a.deficit,
  )

  for (const { i: laneIndex, deficit } of laneOrder) {
    if (deficit <= 0) continue

    const lane = lanes[laneIndex]
    const mutableCells = cloneLaneCells(lane.cells)

    const emptySlots: EmptySlot[] = []
    for (const [ci, cell] of lane.cells.entries()) {
      if (!cell || cell.unitType !== 'attack') continue
      for (const [si, slotColor] of cell.slots.entries()) {
        if (cell.loadedEnergy[si] === null) emptySlots.push({ cellIndex: ci, slotIndex: si, slotColor })
      }
    }

    emptySlots.sort((a, b) => {
      const ca = constraintOf(a.slotColor), cb = constraintOf(b.slotColor)
      if (ca !== cb) return ca - cb
      const bA = Math.max(0, ...pool.filter((c) => canDropEnergyInSlot(c.color, a.slotColor)).map((c) => c.point))
      const bB = Math.max(0, ...pool.filter((c) => canDropEnergyInSlot(c.color, b.slotColor)).map((c) => c.point))
      return bB - bA
    })

    for (const slot of emptySlots) {
      // Use actual computed strength as the stop condition (accounts for OC/pair bonuses).
      if (computeLaneAttackStrength(mutableCells, laneIndex, handEnergyCount) >= lane.goal) break
      const idx = pool.findIndex((c) => canDropEnergyInSlot(c.color, slot.slotColor))
      if (idx === -1) continue
      const [card] = pool.splice(idx, 1)
      mutableCells[slot.cellIndex]!.loadedEnergy[slot.slotIndex] = { color: card.color, point: card.point } as LoadedEnergy
      placements.push({ laneIndex, cellIndex: slot.cellIndex, slotIndex: slot.slotIndex, color: card.color, point: card.point })
    }
  }

  return finalizeResult(lanes, placements, pool.length, handEnergyCount - placements.length)
}

// ── Efficiency solver (recursive backtracking) ─────────────────────────────

type SearchCard = { color: string; point: number }
type EmptySlot = { cellIndex: number; slotIndex: number; slotColor: string }

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
 * Recursive backtracking search.
 * Mutates `cells` in place, restoring on backtrack.
 * Updates `bestRef.value` whenever a shorter solution is found.
 */
function searchLanePlacements(
  cells: (LaneUnit | null)[],
  laneIndex: number,
  emptySlots: EmptySlot[],
  slotIdx: number,
  pool: SearchCard[],
  placements: Placement[],
  goal: number,
  handEnergyCount: number,
  bestRef: { value: Placement[] | null },
): void {
  // Check if goal is already met.
  if (computeLaneAttackStrength(cells, laneIndex, handEnergyCount) >= goal) {
    if (!bestRef.value || placements.length < bestRef.value.length) {
      bestRef.value = [...placements]
    }
    return
  }

  if (slotIdx >= emptySlots.length) return
  if (bestRef.value && placements.length >= bestRef.value.length) return

  const slot = emptySlots[slotIdx]
  const slotColor = slot.slotColor
  const cell = cells[slot.cellIndex]
  if (!cell) {
    searchLanePlacements(cells, laneIndex, emptySlots, slotIdx + 1, pool, placements, goal, handEnergyCount, bestRef)
    return
  }

  // Build unique compatible options sorted by marginal strength contribution (desc).
  const baseStrength = computeLaneAttackStrength(cells, laneIndex, handEnergyCount)
  const tried = new Set<string>()
  const options: { card: SearchCard; pidx: number; contrib: number }[] = []

  for (let i = 0; i < pool.length; i++) {
    const card = pool[i]
    if (!canDropEnergyInSlot(card.color, slotColor)) continue
    const key = `${card.color}:${card.point}`
    if (tried.has(key)) continue
    tried.add(key)

    const prev = cell.loadedEnergy[slot.slotIndex]
    cell.loadedEnergy[slot.slotIndex] = { color: card.color, point: card.point } as LoadedEnergy
    const contrib = computeLaneAttackStrength(cells, laneIndex, handEnergyCount) - baseStrength
    cell.loadedEnergy[slot.slotIndex] = prev
    options.push({ card, pidx: i, contrib })
  }
  options.sort((a, b) => b.contrib - a.contrib)

  for (const { card } of options) {
    // Re-find the card index (pool is passed by spread copy at each level, but we reuse the same array)
    const idx = pool.findIndex((c) => c.color === card.color && c.point === card.point)
    if (idx === -1) continue

    const prev = cell.loadedEnergy[slot.slotIndex]
    cell.loadedEnergy[slot.slotIndex] = { color: card.color, point: card.point } as LoadedEnergy
    pool.splice(idx, 1)

    searchLanePlacements(
      cells, laneIndex, emptySlots, slotIdx + 1, pool,
      [...placements, { laneIndex, cellIndex: slot.cellIndex, slotIndex: slot.slotIndex, color: card.color, point: card.point }],
      goal, handEnergyCount, bestRef,
    )

    pool.splice(idx, 0, card)
    cell.loadedEnergy[slot.slotIndex] = prev
  }

  // Also try skipping this slot entirely.
  searchLanePlacements(cells, laneIndex, emptySlots, slotIdx + 1, pool, placements, goal, handEnergyCount, bestRef)
}

/**
 * Efficiency solver: uses recursive backtracking per lane to find the minimum
 * number of cards while maximising effective strength (including OC/pair/etc.).
 */
function solveEfficiency(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
): OptimalSolution {
  const pool: SearchCard[] = energies.flatMap((e) =>
    Array<SearchCard>(e.count).fill({ color: e.color, point: e.point }),
  )

  const placements: Placement[] = []
  const handEnergyCount = pool.length

  const laneOrder = [...laneSummaries.map((s, i) => ({ i, deficit: s.deficit }))]
    .sort((a, b) => b.deficit - a.deficit)

  for (const { i: laneIndex, deficit } of laneOrder) {
    if (deficit <= 0) continue

    const lane = lanes[laneIndex]
    const goal = lane.goal

    const emptySlots: EmptySlot[] = []
    for (const [ci, cell] of lane.cells.entries()) {
      if (!cell || cell.unitType !== 'attack') continue
      for (const [si, slotColor] of cell.slots.entries()) {
        if (cell.loadedEnergy[si] === null) emptySlots.push({ cellIndex: ci, slotIndex: si, slotColor })
      }
    }

    if (emptySlots.length === 0) continue

    // Sort: most constrained first so orange-only slots get their specific energies.
    const constraintOf = (color: string) => (color === 'orange' ? 0 : color === 'blue' ? 1 : 2)
    emptySlots.sort((a, b) => constraintOf(a.slotColor) - constraintOf(b.slotColor))

    const mutableCells = cloneLaneCells(lane.cells)
    const bestRef: { value: Placement[] | null } = { value: null }

    searchLanePlacements(mutableCells, laneIndex, emptySlots, 0, pool, [], goal, handEnergyCount, bestRef)

    if (bestRef.value) {
      placements.push(...bestRef.value)
      for (const p of bestRef.value) {
        const idx = pool.findIndex((c) => c.color === p.color && c.point === p.point)
        if (idx !== -1) pool.splice(idx, 1)
      }
    }
  }

  return finalizeResult(lanes, placements, pool.length, handEnergyCount - placements.length)
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
