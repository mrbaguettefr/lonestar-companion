import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary, LoadedEnergy } from '../types/lonestar'
import { AUTO_ACTIVATION_SKILLS, computeUnitStrength, computeSupportPassiveBonus, triggerActivation, triggerSupportOnLoad, type EffectContext } from './effects'
import { canDropEnergyInSlot } from './gameData'
import { sum } from './numbers'

export type SolverStrategy = 'least-cards' | 'efficiency' | 'max-damage' | 'max-energy' | 'best'

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
  energyGenerated: number
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

  // Count energy cards generated by support unit on-load effects.
  let energyGenerated = 0
  for (const p of placements) {
    const cell = simLanes[p.laneIndex]?.cells[p.cellIndex]
    if (cell?.unitType === 'support') {
      energyGenerated += triggerSupportOnLoad(cell, { color: p.color, point: p.point }).length
    }
  }

  return { energiesUsed, strengthGenerated, damageDealt, damageReceived, efficiencyRatio, energyGenerated }
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
  unitType: 'attack' | 'support'
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
  const options: { card: SearchCard }[] = []

  for (let i = 0; i < pool.length; i++) {
    const card = pool[i]
    if (!canDropEnergyInSlot(card.color, slot.slotColor)) continue
    const key = `${card.color}:${card.point}`
    if (tried.has(key)) continue
    tried.add(key)
    options.push({ card })
  }

  // For attack slots: sort by marginal strength contribution desc for better pruning.
  if (slot.unitType === 'attack') {
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
  }

  for (const { card } of options) {
    const idx = pool.findIndex((c) => c.color === card.color && c.point === card.point)
    if (idx === -1) continue

    const prev = cell.loadedEnergy[slot.slotIndex]
    cell.loadedEnergy[slot.slotIndex] = { color: card.color, point: card.point } as LoadedEnergy
    const nextPlacement = { laneIndex: slot.laneIndex, cellIndex: slot.cellIndex, slotIndex: slot.slotIndex, color: card.color, point: card.point }

    if (slot.unitType === 'support') {
      // Support slot: generated energies expand the pool — pass a copy so backtracking is safe.
      const generated = triggerSupportOnLoad(cell as LaneUnit, { color: card.color, point: card.point })
      const newPool = [...pool.slice(0, idx), ...pool.slice(idx + 1)]
      for (const g of generated) newPool.push({ color: g.color, point: g.point })
      searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, newPool, [...placements, nextPlacement], collector, budget, handEnergyCount)
    } else {
      // Attack slot: mutate pool in place (restored after recursion).
      pool.splice(idx, 1)
      searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, [...placements, nextPlacement], collector, budget, handEnergyCount)
      pool.splice(idx, 0, card)
    }

    cell.loadedEnergy[slot.slotIndex] = prev
  }

  // Also try skipping this slot.
  searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, placements, collector, budget, handEnergyCount)
}

/**
 * Composite score for the "best" strategy.
 * - Goals not met → 0
 * - Weights: strength/card ratio ×2, energy generated ×1, surplus penalty ×0.75
 */
export function solutionScore(s: RankedSolution): number {
  if (!s.possible) return 0
  const ratio = s.stats.energiesUsed > 0 ? s.stats.strengthGenerated / s.stats.energiesUsed : 0
  return ratio * 2 + s.stats.energyGenerated * 1 - s.stats.damageDealt * 0.75
}

export function sortByStrategy(solutions: RankedSolution[], strategy: SolverStrategy): RankedSolution[] {
  return [...solutions].sort((a, b) => {
    if (a.possible !== b.possible) return a.possible ? -1 : 1

    if (strategy === 'best') {
      return solutionScore(b) - solutionScore(a)
    }
    if (strategy === 'least-cards') {
      if (a.totalEnergyUsed !== b.totalEnergyUsed) return a.totalEnergyUsed - b.totalEnergyUsed
      return b.stats.strengthGenerated - a.stats.strengthGenerated
    }
    if (strategy === 'efficiency') {
      if (a.stats.efficiencyRatio !== b.stats.efficiencyRatio)
        return a.stats.efficiencyRatio - b.stats.efficiencyRatio
      return b.stats.strengthGenerated - a.stats.strengthGenerated
    }
    if (strategy === 'max-damage') {
      if (b.stats.strengthGenerated !== a.stats.strengthGenerated)
        return b.stats.strengthGenerated - a.stats.strengthGenerated
      return a.totalEnergyUsed - b.totalEnergyUsed
    }
    // max-energy: most energy generated by support units first, then highest strength
    if (b.stats.energyGenerated !== a.stats.energyGenerated)
      return b.stats.energyGenerated - a.stats.energyGenerated
    return b.stats.strengthGenerated - a.stats.strengthGenerated
  })
}

function rankSolutions(
  rawSolutions: Placement[][],
  lanes: Lane[],
  totalHandCount: number,
  max?: number,
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

  // Collect possible solutions first, then fill remaining slots with impossible ones
  ranked.sort((a, b) => {
    if (a.possible !== b.possible) return a.possible ? -1 : 1
    if (a.totalEnergyUsed !== b.totalEnergyUsed) return a.totalEnergyUsed - b.totalEnergyUsed
    return b.stats.strengthGenerated - a.stats.strengthGenerated
  })

  return max == null ? ranked : ranked.slice(0, max)
}

/** Collect all activatable units (not yet activated) that have auto-applicable effects. */
function collectActivatableUnits(lanes: Lane[]): { unit: LaneUnit; laneIndex: number; cellIndex: number }[] {
  const result: { unit: LaneUnit; laneIndex: number; cellIndex: number }[] = []
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const [cellIndex, cell] of lane.cells.entries()) {
      if (cell && (cell.activateCount ?? 0) === 0 && AUTO_ACTIVATION_SKILLS.has(cell.skillPath)) {
        result.push({ unit: cell, laneIndex, cellIndex })
      }
    }
  }
  return result
}

/** Generate all subsets (as bitmask indices) of activatable units to try. */
function activationSubsets(count: number): number[][] {
  const subsets: number[][] = []
  for (let mask = 0; mask < (1 << count); mask++) {
    const subset: number[] = []
    for (let i = 0; i < count; i++) {
      if (mask & (1 << i)) subset.push(i)
    }
    subsets.push(subset)
  }
  return subsets
}

export function solveMultiple(
  lanes: Lane[],
  _laneSummaries: LaneSummary[],
  energies: Energy[],
  max?: number,
): RankedSolution[] {
  const basePool: SearchCard[] = energies.flatMap((e) =>
    Array<SearchCard>(e.count).fill({ color: e.color, point: e.point }),
  )
  const totalHandCount = basePool.length

  // Collect all empty slots across all lanes
  const constraintOf = (color: string) => (color === 'orange' ? 0 : color === 'blue' ? 1 : 2)
  const allSlots: GlobalSlot[] = []
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const [ci, cell] of lane.cells.entries()) {
      if (!cell || cell.slots.length === 0) continue
      for (const [si, slotColor] of cell.slots.entries()) {
        if (cell.loadedEnergy[si] === null) {
          allSlots.push({ laneIndex, cellIndex: ci, slotIndex: si, slotColor, unitType: cell.unitType })
        }
      }
    }
  }
  // Support slots first, then by colour constraint.
  allSlots.sort((a, b) => {
    if (a.unitType !== b.unitType) return a.unitType === 'support' ? -1 : 1
    return constraintOf(a.slotColor) - constraintOf(b.slotColor)
  })

  if (allSlots.length === 0 || basePool.length === 0) {
    return [toRanked([], lanes, totalHandCount)]
  }

  // Enumerate activatable units and try all subsets (each activated at most once).
  const activatable = collectActivatableUnits(lanes)
  const subsets = activatable.length <= 6 ? activationSubsets(activatable.length) : [[]]

  const collector: Placement[][] = []
  const budget = { remaining: 50_000 }

  for (const subset of subsets) {
    // Apply the chosen activations to the pool
    let pool: SearchCard[] = [...basePool]
    for (const idx of subset) {
      const { unit } = activatable[idx]
      const modifiedEnergies = triggerActivation(unit, pool.reduce<Energy[]>((acc, c) => {
        const existing = acc.find((e) => e.color === c.color && e.point === c.point)
        if (existing) { existing.count++ } else { acc.push({ id: acc.length, color: c.color, count: 1, point: c.point }) }
        return acc
      }, []))
      if (modifiedEnergies !== null) {
        pool = modifiedEnergies.flatMap((e) =>
          Array<SearchCard>(e.count).fill({ color: e.color, point: e.point }),
        )
      }
    }

    // Build mutable per-lane cell clones for this search pass
    const mutableLaneCells = new Map<number, (LaneUnit | null)[]>()
    for (const [i, lane] of lanes.entries()) {
      mutableLaneCells.set(i, cloneLaneCells(lane.cells))
    }

    searchGlobal(allSlots, 0, mutableLaneCells, pool, [], collector, budget, totalHandCount)
    if (budget.remaining <= 0) break
  }

  // Always include the empty solution as a baseline
  if (!collector.some((p) => p.length === 0)) collector.push([])

  return rankSolutions(collector, lanes, totalHandCount, max)
}

/** Kept for the reactive isPossible check in App.tsx. */
export function solveOptimal(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
): OptimalSolution {
  const results = solveMultiple(lanes, laneSummaries, energies, 1)
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

// ── Step-by-step solution guide ────────────────────────────────────────────

export type SolutionStep = {
  placement: Placement
  unitName: string
  unitType: 'attack' | 'support'
  slotColor: string
  generatedEnergies: { color: string; point: number }[]
  /** Strength label from the effect handler (e.g. "+4 (OC≥3+2, OC≥5+2)"). */
  effectLabel: string | null
  /** Current total attack strength of the lane after this step. */
  laneStrengthAfter: number
  laneGoal: number
}

/**
 * Simulate a solution placement-by-placement and return annotated steps.
 * Support-unit loads come first (so generated energies appear before they are used).
 */
export function computeSolutionSteps(
  lanes: Lane[],
  placements: Placement[],
  initialHandCount: number,
): SolutionStep[] {
  if (placements.length === 0) return []

  // Clone lanes so simulation doesn't touch original state.
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))

  // Order: support slots first, then attack — within each, by lane/cell/slot.
  const sorted = [...placements].sort((a, b) => {
    const ua = simLanes[a.laneIndex].cells[a.cellIndex]?.unitType ?? 'attack'
    const ub = simLanes[b.laneIndex].cells[b.cellIndex]?.unitType ?? 'attack'
    if (ua !== ub) return ua === 'support' ? -1 : 1
    if (a.laneIndex !== b.laneIndex) return a.laneIndex - b.laneIndex
    if (a.cellIndex !== b.cellIndex) return a.cellIndex - b.cellIndex
    return a.slotIndex - b.slotIndex
  })

  const steps: SolutionStep[] = []

  for (const p of sorted) {
    const cells = simLanes[p.laneIndex].cells
    const cell = cells[p.cellIndex]
    if (!cell) continue

    const slotColor = cell.slots[p.slotIndex] ?? 'white'

    // Apply placement to simulation.
    cell.loadedEnergy[p.slotIndex] = { color: p.color, point: p.point }

    // Generated energies (support on-load effects).
    const generatedEnergies = cell.unitType === 'support'
      ? triggerSupportOnLoad(cell, { color: p.color, point: p.point }).map((g) => ({ color: g.color, point: g.point }))
      : []

    // Compute effect label using full lane context.
    const allLaneCells = simLanes.map((l) => l.cells)
    const loadedColors = new Set(cells.flatMap((c) => (c ? c.loadedEnergy.filter(Boolean).map((e) => e!.color) : [])))
    const tripower = loadedColors.has('white') && loadedColors.has('blue') && loadedColors.has('orange')
    const highestPoint = Math.max(0, ...allLaneCells.flatMap((lc) => lc.flatMap((c) => (c ? c.loadedEnergy.filter(Boolean).map((e) => e!.point) : []))))
    const ctx: EffectContext = {
      lane: cells,
      laneIndex: p.laneIndex,
      cellIndex: p.cellIndex,
      allLanes: allLaneCells,
      handEnergyCount: initialHandCount,
      tripower,
      highestPointInBattle: highestPoint,
    }
    const breakdown = computeUnitStrength(cell, ctx)
    // Use summarizeLanes for accurate lane strength (includes support passives).
    const laneStrength = summarizeLanes(simLanes, { handEnergyCount: initialHandCount })[p.laneIndex]?.strength ?? 0

    steps.push({
      placement: p,
      unitName: cell.name,
      unitType: cell.unitType,
      slotColor,
      generatedEnergies,
      effectLabel: breakdown.effectLabel,
      laneStrengthAfter: laneStrength,
      laneGoal: simLanes[p.laneIndex].goal,
    })
  }

  return steps
}
