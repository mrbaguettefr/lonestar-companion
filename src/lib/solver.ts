import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary, LoadedEnergy } from '../types/lonestar'
import { AUTO_ACTIVATION_SKILLS, computeUnitStrength, computeSupportPassiveBonus, triggerActivation, triggerSupportOnLoadForSlot, type EffectContext } from './effects'
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
          supportPower: 0,
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
        supportPower: bd.supportPower + supportBonus,
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
  energyConsumed: number
  strengthGenerated: number
  damageDealt: number
  damageReceived: number
  efficiencyRatio: number
  energyGenerated: number
}

export type RankedSolution = {
  placements: Placement[]
  activations: { unit: LaneUnit; laneIndex: number; cellIndex: number }[]
  possible: boolean
  totalEnergyUsed: number
  remainingDeficit: number
  spareEnergy: number
  stats: SolutionStats
}

type CollectedSolution = {
  placements: Placement[]
  activations: { unit: LaneUnit; laneIndex: number; cellIndex: number }[]
  activatedEnergies: Energy[]
}

type EvaluatedSolution = {
  stats: SolutionStats
  outcomeKey: string
  finalHandCount: number
}

export type PlacementReplayStep = {
  placement: Placement
  unit: LaneUnit
  slotColor: string
  generatedEnergies: LoadedEnergy[]
}

// ── Shared helpers ─────────────────────────────────────────────────────────

function collectLoadedPlacements(lanes: Lane[]): Placement[] {
  return lanes.flatMap((lane, laneIndex) =>
    lane.cells.flatMap((cell, cellIndex) =>
      cell
        ? cell.loadedEnergy.flatMap((energy, slotIndex) =>
            energy ? [{
              laneIndex,
              cellIndex,
              slotIndex,
              color: energy.color,
              point: energy.point,
            }] : [],
          )
        : [],
    ),
  )
}

function countGeneratedEnergiesInCurrentBoard(lanes: Lane[]): number {
  return lanes.reduce((total, lane) => total + lane.cells.reduce((laneTotal, cell) => {
    if (!cell || cell.unitType !== 'support') return laneTotal

    let generatedCount = 0
    const replayUnit: LaneUnit = {
      ...cell,
      loadedEnergy: Array(cell.slots.length).fill(null),
    }

    cell.loadedEnergy.forEach((energy, slotIndex) => {
      if (!energy) return
      const generated = triggerSupportOnLoadForSlot(replayUnit, slotIndex, energy)
      generatedCount += generated.length
      replayUnit.loadedEnergy[slotIndex] = energy
    })

    return laneTotal + generatedCount
  }, 0), 0)
}

export function evaluateCurrentBoard(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  bonusEnergyGenerated = 0,
): RankedSolution {
  const placements = collectLoadedPlacements(lanes)
  const strengthGenerated = sum(laneSummaries.map((s) => s.strength))
  const damageDealt = sum(laneSummaries.map((s) => s.surplus))
  const damageReceived = sum(laneSummaries.map((s) => s.deficit))
  const energyConsumed = sum(placements.map((p) => p.point))
  const energiesUsed = placements.length
  const stats: SolutionStats = {
    energiesUsed,
    energyConsumed,
    strengthGenerated,
    damageDealt,
    damageReceived,
    efficiencyRatio: strengthGenerated > 0 ? energiesUsed / strengthGenerated : 0,
    energyGenerated: countGeneratedEnergiesInCurrentBoard(lanes) + bonusEnergyGenerated,
  }

  return {
    placements,
    activations: [],
    possible: damageReceived === 0,
    totalEnergyUsed: energiesUsed,
    remainingDeficit: damageReceived,
    spareEnergy: 0,
    stats,
  }
}

function addEnergyToHand(energies: Energy[], loaded: LoadedEnergy, idSeed: number): Energy[] {
  return [...energies, { id: idSeed, color: loaded.color, point: loaded.point }]
}

function consumeEnergyFromHand(energies: Energy[], loaded: LoadedEnergy): Energy[] {
  const idx = energies.findIndex(
    (e) => e.color === loaded.color && e.point === loaded.point,
  )
  if (idx === -1) return energies
  return energies.filter((_, i) => i !== idx)
}

function sortPlacementsForReplay(lanes: Lane[], placements: Placement[]): Placement[] {
  return [...placements].sort((a, b) => {
    const ua = lanes[a.laneIndex]?.cells[a.cellIndex]?.unitType ?? 'attack'
    const ub = lanes[b.laneIndex]?.cells[b.cellIndex]?.unitType ?? 'attack'
    if (ua !== ub) return ua === 'support' ? -1 : 1
    if (a.laneIndex !== b.laneIndex) return a.laneIndex - b.laneIndex
    if (a.cellIndex !== b.cellIndex) return a.cellIndex - b.cellIndex
    return a.slotIndex - b.slotIndex
  })
}

export function replayPlacements(
  lanes: Lane[],
  energies: Energy[],
  placements: Placement[],
): { lanes: Lane[]; energies: Energy[]; steps: PlacementReplayStep[] } {
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))
  let hand = energies.map((energy) => ({ ...energy }))
  let nextGeneratedId = Math.max(0, ...hand.map((e) => e.id)) + 1
  const steps: PlacementReplayStep[] = []

  for (const p of sortPlacementsForReplay(simLanes, placements)) {
    const cell = simLanes[p.laneIndex]?.cells[p.cellIndex]
    if (!cell) continue

    const loaded = { color: p.color, point: p.point }
    hand = consumeEnergyFromHand(hand, loaded)

    cell.loadedEnergy[p.slotIndex] = loaded
    const generatedEnergies =
      cell.unitType === 'support'
        ? triggerSupportOnLoadForSlot(cell, p.slotIndex, loaded)
        : []

    for (const generated of generatedEnergies) {
      hand = addEnergyToHand(hand, generated, nextGeneratedId++)
    }

    steps.push({
      placement: p,
      unit: cell,
      slotColor: cell.slots[p.slotIndex] ?? 'white',
      generatedEnergies,
    })
  }

  return { lanes: simLanes, energies: hand, steps }
}

function loadedEnergyOutcomeKey(unit: LaneUnit): string {
  const loaded = unit.loadedEnergy
    .map((energy, slotIndex) => energy ? { ...energy, slotIndex } : null)
    .filter((energy): energy is LoadedEnergy & { slotIndex: number } => energy !== null)

  if (unit.unitType === 'attack') {
    return loaded
      .map((energy) => `${energy.color}:${energy.point}`)
      .sort()
      .join(',')
  }

  return loaded
    .map((energy) => `${energy.slotIndex}:${energy.color}:${energy.point}`)
    .join(',')
}

function solutionOutcomeKey(
  simLanes: Lane[],
  summaries: LaneSummary[],
  stats: SolutionStats,
): string {
  const laneKeys = simLanes.map((lane, laneIndex) => {
    const summary = summaries[laneIndex]
    const attackKeys: string[] = []
    const positionedKeys: string[] = []

    lane.cells.forEach((cell, cellIndex) => {
      if (!cell) {
        positionedKeys.push(`${cellIndex}:empty`)
        return
      }
      const breakdown = summary.unitBreakdowns[cellIndex]
      const cellKey = [
        cell.unitId,
        cell.level,
        cell.unitType,
        loadedEnergyOutcomeKey(cell),
        breakdown.basePoints,
        breakdown.staticPower,
        breakdown.effectBonus,
        breakdown.isDoubled ? 1 : 0,
        breakdown.total,
        breakdown.isManualOverride ? 1 : 0,
      ].join(':')

      if (cell.unitType === 'attack') {
        attackKeys.push(cellKey)
      } else {
        positionedKeys.push(`${cellIndex}:${cellKey}`)
      }
    })

    return [
      summary.strength,
      summary.deficit,
      summary.surplus,
      positionedKeys.join(';'),
      attackKeys.sort().join(';'),
    ].join('|')
  })

  return [
    stats.damageReceived === 0 ? 1 : 0,
    stats.energiesUsed,
    stats.energyConsumed,
    stats.strengthGenerated,
    stats.damageDealt,
    stats.damageReceived,
    stats.energyGenerated,
    laneKeys.join('||'),
  ].join('#')
}

function evaluateSolution(
  lanes: Lane[],
  placements: Placement[],
  initialEnergies: Energy[],
): EvaluatedSolution {
  const replay = replayPlacements(lanes, initialEnergies, placements)
  const simLanes = replay.lanes
  const finalHandCount = replay.energies.length
  const summaries = summarizeLanes(simLanes, { handEnergyCount: finalHandCount })
  const strengthGenerated = sum(summaries.map((s) => s.strength))
  const damageDealt = sum(summaries.map((s) => s.surplus))
  const damageReceived = sum(summaries.map((s) => s.deficit))
  const energiesUsed = placements.length
  const energyConsumed = sum(placements.map((p) => p.point))
  const efficiencyRatio = strengthGenerated > 0 ? energiesUsed / strengthGenerated : 0

  const energyGenerated = replay.steps.reduce((total, step) => total + step.generatedEnergies.length, 0)

  const stats = { energiesUsed, energyConsumed, strengthGenerated, damageDealt, damageReceived, efficiencyRatio, energyGenerated }
  return { stats, outcomeKey: solutionOutcomeKey(simLanes, summaries, stats), finalHandCount }
}

function toRanked(
  placements: Placement[],
  lanes: Lane[],
  totalHandCount: number,
  evaluatedStats?: SolutionStats,
  finalHandCount?: number,
  activations: { unit: LaneUnit; laneIndex: number; cellIndex: number }[] = [],
): RankedSolution {
  const fallbackFinalHandCount = totalHandCount - placements.length
  const stats = evaluatedStats ?? (() => {
    const summaries = summarizeLanes(lanes, { handEnergyCount: fallbackFinalHandCount })
    const strengthGenerated = sum(summaries.map((s) => s.strength))
    const damageDealt = sum(summaries.map((s) => s.surplus))
    const damageReceived = sum(summaries.map((s) => s.deficit))
    return {
      energiesUsed: placements.length,
      energyConsumed: sum(placements.map((p) => p.point)),
      strengthGenerated,
      damageDealt,
      damageReceived,
      efficiencyRatio: strengthGenerated > 0 ? placements.length / strengthGenerated : 0,
      energyGenerated: 0,
    }
  })()
  return {
    placements,
    activations,
    possible: stats.damageReceived === 0,
    totalEnergyUsed: placements.length,
    remainingDeficit: stats.damageReceived,
    spareEnergy: finalHandCount ?? fallbackFinalHandCount,
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
      const generated = triggerSupportOnLoadForSlot(cell as LaneUnit, slot.slotIndex, { color: card.color, point: card.point })
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
 * - Weights: strength/card ratio ×2, energy generated ×1, surplus penalty ×0.75, energy consumed penalty ×0.1
 */
export function solutionScore(s: RankedSolution): number {
  if (!s.possible) return 0
  const ratio = s.stats.energiesUsed > 0 ? s.stats.strengthGenerated / s.stats.energiesUsed : 0
  return ratio * 2 + s.stats.energyGenerated * 1 - s.stats.damageDealt * 0.75 - s.stats.energyConsumed * 0.1
}

export function sortByStrategy(solutions: RankedSolution[], strategy: SolverStrategy): RankedSolution[] {
  return [...solutions].sort((a, b) => {
    if (a.possible !== b.possible) return a.possible ? -1 : 1

    if (strategy === 'best') {
      const scoreDelta = solutionScore(b) - solutionScore(a)
      if (scoreDelta !== 0) return scoreDelta
      return a.stats.energyConsumed - b.stats.energyConsumed
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
  rawSolutions: CollectedSolution[],
  lanes: Lane[],
  energies: Energy[],
  totalHandCount: number,
  max?: number,
): RankedSolution[] {
  // Convert and deduplicate
  const seen = new Set<string>()
  const seenOutcomes = new Set<string>()
  const ranked: RankedSolution[] = []

  for (const collected of rawSolutions) {
    const { placements, activations, activatedEnergies } = collected
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

    const evaluation = evaluateSolution(lanes, placements, activatedEnergies)
    if (seenOutcomes.has(evaluation.outcomeKey)) continue
    seenOutcomes.add(evaluation.outcomeKey)
    ranked.push(toRanked(placements, lanes, totalHandCount, evaluation.stats, evaluation.finalHandCount, activations))
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
  const basePool: SearchCard[] = energies.map((e) => ({ color: e.color, point: e.point }))
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
    return [toRanked([], lanes, totalHandCount, undefined, undefined, [])]
  }

  // Enumerate activatable units and try all subsets (each activated at most once).
  const activatable = collectActivatableUnits(lanes)
  const subsets = activatable.length <= 6 ? activationSubsets(activatable.length) : [[]]

  const collector: CollectedSolution[] = []
  const budget = { remaining: 50_000 }

  for (const subset of subsets) {
    // Apply the chosen activations to the pool, tracking which units were activated
    let pool: SearchCard[] = [...basePool]
    const activations: { unit: LaneUnit; laneIndex: number; cellIndex: number }[] = []
    for (const idx of subset) {
      const { unit, laneIndex, cellIndex } = activatable[idx]
      const modifiedEnergies = triggerActivation(unit, pool.reduce<Energy[]>((acc, c) => {
        return [...acc, { id: acc.length, color: c.color, point: c.point }]
      }, []))
      if (modifiedEnergies !== null) {
        pool = modifiedEnergies.map((e) => ({ color: e.color, point: e.point }))
        activations.push({ unit, laneIndex, cellIndex })
      }
    }
    const activatedEnergies: Energy[] = pool.map((c, i) => ({ id: i, color: c.color, point: c.point }))

    // Build mutable per-lane cell clones for this search pass
    const mutableLaneCells = new Map<number, (LaneUnit | null)[]>()
    for (const [i, lane] of lanes.entries()) {
      mutableLaneCells.set(i, cloneLaneCells(lane.cells))
    }

    const subCollector: Placement[][] = []
    searchGlobal(allSlots, 0, mutableLaneCells, pool, [], subCollector, budget, totalHandCount)
    for (const placements of subCollector) {
      collector.push({ placements, activations, activatedEnergies })
    }
    if (budget.remaining <= 0) break
  }

  // Always include the empty solution as a baseline
  if (!collector.some((c) => c.placements.length === 0)) {
    collector.push({ placements: [], activations: [], activatedEnergies: energies })
  }

  return rankSolutions(collector, lanes, energies, totalHandCount, max)
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
  return { handEnergyCount: energies.length }
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

export type ActivationSolutionStep = {
  kind: 'activation'
  unitName: string
  laneIndex: number
  handBefore: { color: string; point: number }[]
  handAfter: { color: string; point: number }[]
}

export type PlacementSolutionStep = {
  kind: 'placement'
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

export type SolutionStep = ActivationSolutionStep | PlacementSolutionStep

/**
 * Simulate a solution placement-by-placement and return annotated steps.
 * Activation steps (e.g. bleaching device) come first, then support loads, then attack loads.
 */
export function computeSolutionSteps(
  lanes: Lane[],
  placements: Placement[],
  initialHandCount: number,
  initialEnergies: Energy[] = [],
  activations: { unit: LaneUnit; laneIndex: number; cellIndex: number }[] = [],
): SolutionStep[] {
  const steps: SolutionStep[] = []

  // Emit activation steps first, simulating hand transforms.
  let hand: Energy[] = initialEnergies.map((e) => ({ ...e }))
  for (const { unit, laneIndex } of activations) {
    const handBefore = hand.map((e) => ({ color: e.color, point: e.point }))
    const result = triggerActivation(unit, hand)
    if (result !== null) {
      hand = result
      steps.push({
        kind: 'activation',
        unitName: unit.name,
        laneIndex,
        handBefore,
        handAfter: hand.map((e) => ({ color: e.color, point: e.point })),
      })
    }
  }

  if (placements.length === 0) return steps

  const replay = replayPlacements(lanes, [], placements)
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))

  for (const replayStep of replay.steps) {
    const p = replayStep.placement
    const cells = simLanes[p.laneIndex].cells
    const cell = cells[p.cellIndex]
    if (!cell) continue

    // Apply placement to simulation.
    cell.loadedEnergy[p.slotIndex] = { color: p.color, point: p.point }

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
      kind: 'placement',
      placement: p,
      unitName: cell.name,
      unitType: cell.unitType,
      slotColor: replayStep.slotColor,
      generatedEnergies: replayStep.generatedEnergies,
      effectLabel: breakdown.effectLabel,
      laneStrengthAfter: laneStrength,
      laneGoal: simLanes[p.laneIndex].goal,
    })
  }

  return steps
}
