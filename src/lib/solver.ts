import type { BattleContext, Energy, Lane, LaneUnit, LaneSummary, LoadedEnergy } from '../types/lonestar'
import { AUTO_ACTIVATION_SKILLS, applyActivationEffect, computeUnitStrength, computeSupportPassiveBonus, triggerActivation, triggerSupportOnLoadForSlot, type EffectContext } from './effects'
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
  totalEnergyUsedCount: number
  remainingDeficit: number
  spareEnergyCount: number
}

export type SolutionStats = {
  energyUsedCount: number
  energyGeneratedCount: number
  energyPointsUsed: number
  strengthGenerated: number
  damageDealt: number
  damageReceived: number
  efficiencyRatio: number
  energyPointsGenerated: number
  stepCount: number
  handEnergyCount: number
  handEnergyPointTotal: number
}

/** A single action in an ordered solution: either an energy placement or a unit activation. */
export type SolverAction =
  | { kind: 'placement'; placement: Placement }
  | { kind: 'activation'; unit: LaneUnit; laneIndex: number; cellIndex: number }

export type RankedSolution = {
  /** Full ordered action sequence (activations interleaved with placements). */
  actions: SolverAction[]
  /** Derived subset of actions that are placements, for convenience. */
  placements: Placement[]
  possible: boolean
  totalEnergyUsedCount: number
  remainingDeficit: number
  spareEnergyCount: number
  stats: SolutionStats
}

type CollectedSolution = {
  actions: SolverAction[]
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

function totalGeneratedEnergyInCurrentBoard(lanes: Lane[]): { count: number; points: number } {
  return lanes.reduce((total, lane) => lane.cells.reduce((laneTotal, cell) => {
    if (!cell || cell.unitType !== 'support') return laneTotal

    const generatedTotal = { count: 0, points: 0 }
    const replayUnit: LaneUnit = {
      ...cell,
      loadedEnergy: Array(cell.slots.length).fill(null),
    }

    cell.loadedEnergy.forEach((energy, slotIndex) => {
      if (!energy) return
      const generated = triggerSupportOnLoadForSlot(replayUnit, slotIndex, energy)
      generatedTotal.count += generated.length
      generatedTotal.points += sum(generated.map((generatedEnergy) => generatedEnergy.point))
      replayUnit.loadedEnergy[slotIndex] = energy
    })

    return {
      count: laneTotal.count + generatedTotal.count,
      points: laneTotal.points + generatedTotal.points,
    }
  }, total), { count: 0, points: 0 })
}

function countActivatedUnits(lanes: Lane[]): number {
  return lanes.reduce(
    (total, lane) =>
      total +
      lane.cells.reduce((laneTotal, cell) => laneTotal + (cell?.activateCount ?? 0), 0),
    0,
  )
}

export function evaluateCurrentBoard(
  lanes: Lane[],
  laneSummaries: LaneSummary[],
  energies: Energy[],
  bonusEnergyPointsGenerated = 0,
  bonusEnergyGeneratedCount = 0,
): RankedSolution {
  const placements = collectLoadedPlacements(lanes)
  const generated = totalGeneratedEnergyInCurrentBoard(lanes)
  const strengthGenerated = sum(laneSummaries.map((s) => s.strength))
  const damageDealt = sum(laneSummaries.map((s) => s.surplus))
  const damageReceived = sum(laneSummaries.map((s) => s.deficit))
  const energyPointsUsed = sum(placements.map((p) => p.point))
  const energyUsedCount = placements.length
  const stats: SolutionStats = {
    energyUsedCount,
    energyGeneratedCount: generated.count + bonusEnergyGeneratedCount,
    energyPointsUsed,
    strengthGenerated,
    damageDealt,
    damageReceived,
    efficiencyRatio: strengthGenerated > 0 ? energyUsedCount / strengthGenerated : 0,
    energyPointsGenerated: generated.points + bonusEnergyPointsGenerated,
    stepCount: energyUsedCount + countActivatedUnits(lanes),
    handEnergyCount: energies.length,
    handEnergyPointTotal: sum(energies.map((energy) => energy.point)),
  }

  return {
    actions: placements.map((p) => ({ kind: 'placement', placement: p })),
    placements,
    possible: damageReceived === 0,
    totalEnergyUsedCount: energyUsedCount,
    remainingDeficit: damageReceived,
    spareEnergyCount: 0,
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

/**
 * Replay an ordered sequence of actions (activations interleaved with placements)
 * against the given initial hand. Returns the final lane state and remaining hand.
 */
export function replayActions(
  lanes: Lane[],
  initialEnergies: Energy[],
  actions: SolverAction[],
): { lanes: Lane[]; energies: Energy[]; activationEnergyPointsGenerated: number; activationEnergyGeneratedCount: number } {
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))
  let hand = initialEnergies.map((e) => ({ ...e }))
  let nextGeneratedId = Math.max(0, ...hand.map((e) => e.id), 0) + 1
  let activationEnergyPointsGenerated = 0
  let activationEnergyGeneratedCount = 0

  for (const action of actions) {
    if (action.kind === 'activation') {
      const result = applyActivationEffect(action.unit, hand)
      if (result !== null) {
        activationEnergyPointsGenerated += result.energyPointsGenerated
        activationEnergyGeneratedCount += result.energyGeneratedCount
        hand = result.energies
      }

      const cell = simLanes[action.laneIndex]?.cells[action.cellIndex]
      if (cell) {
        cell.activateCount = Math.min(cell.maxActivations, (cell.activateCount ?? 0) + 1)
      }
    } else {
      const { placement: p } = action
      const cell = simLanes[p.laneIndex]?.cells[p.cellIndex]
      if (!cell) continue
      const loaded = { color: p.color, point: p.point }
      const idx = hand.findIndex((e) => e.color === loaded.color && e.point === loaded.point)
      if (idx !== -1) hand = hand.filter((_, i) => i !== idx)
      cell.loadedEnergy[p.slotIndex] = loaded
      if (cell.unitType === 'support') {
        const generated = triggerSupportOnLoadForSlot(cell, p.slotIndex, loaded)
        for (const gen of generated) {
          hand = [...hand, { id: nextGeneratedId++, color: gen.color, point: gen.point }]
        }
      }
    }
  }

  return { lanes: simLanes, energies: hand, activationEnergyPointsGenerated, activationEnergyGeneratedCount }
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
    stats.energyUsedCount,
    stats.energyGeneratedCount,
    stats.energyPointsUsed,
    stats.strengthGenerated,
    stats.damageDealt,
    stats.damageReceived,
    stats.energyPointsGenerated,
    stats.stepCount,
    stats.handEnergyCount,
    stats.handEnergyPointTotal,
    laneKeys.join('||'),
  ].join('#')
}

function evaluateSolution(
  lanes: Lane[],
  actions: SolverAction[],
  initialEnergies: Energy[],
): EvaluatedSolution {
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))
  let hand = initialEnergies.map((e) => ({ ...e }))
  let nextGeneratedId = Math.max(0, ...hand.map((e) => e.id), 0) + 1
  let energyPointsGenerated = 0
  let energyGeneratedCount = 0
  const placements: Placement[] = []

  for (const action of actions) {
    if (action.kind === 'activation') {
      const result = applyActivationEffect(action.unit, hand)
      if (result !== null) {
        energyPointsGenerated += result.energyPointsGenerated
        energyGeneratedCount += result.energyGeneratedCount
        hand = result.energies
      }
    } else {
      const { placement: p } = action
      placements.push(p)
      const cell = simLanes[p.laneIndex]?.cells[p.cellIndex]
      if (!cell) continue
      const loaded = { color: p.color, point: p.point }
      const idx = hand.findIndex((e) => e.color === loaded.color && e.point === loaded.point)
      if (idx !== -1) hand = hand.filter((_, i) => i !== idx)
      cell.loadedEnergy[p.slotIndex] = loaded
      if (cell.unitType === 'support') {
        const generated = triggerSupportOnLoadForSlot(cell, p.slotIndex, loaded)
        for (const gen of generated) {
          hand = [...hand, { id: nextGeneratedId++, color: gen.color, point: gen.point }]
          energyGeneratedCount++
          energyPointsGenerated += gen.point
        }
      }
    }
  }

  const finalHandCount = hand.length
  const summaries = summarizeLanes(simLanes, { handEnergyCount: finalHandCount })
  const strengthGenerated = sum(summaries.map((s) => s.strength))
  const damageDealt = sum(summaries.map((s) => s.surplus))
  const damageReceived = sum(summaries.map((s) => s.deficit))
  const energyUsedCount = placements.length
  const energyPointsUsed = sum(placements.map((p) => p.point))
  const efficiencyRatio = strengthGenerated > 0 ? energyUsedCount / strengthGenerated : 0
  const handEnergyPointTotal = sum(hand.map((energy) => energy.point))

  const stats: SolutionStats = { energyUsedCount, energyGeneratedCount, energyPointsUsed, strengthGenerated, damageDealt, damageReceived, efficiencyRatio, energyPointsGenerated: energyPointsGenerated, stepCount: actions.length, handEnergyCount: finalHandCount, handEnergyPointTotal }
  return { stats, outcomeKey: solutionOutcomeKey(simLanes, summaries, stats), finalHandCount }
}

function toRanked(
  actions: SolverAction[],
  lanes: Lane[],
  totalHandCount: number,
  evaluatedStats?: SolutionStats,
  finalHandCount?: number,
): RankedSolution {
  const placements = actions.filter((a): a is { kind: 'placement'; placement: Placement } => a.kind === 'placement').map((a) => a.placement)
  const fallbackFinalHandCount = totalHandCount - placements.length
  const stats = evaluatedStats ?? (() => {
    const summaries = summarizeLanes(lanes, { handEnergyCount: fallbackFinalHandCount })
    const strengthGenerated = sum(summaries.map((s) => s.strength))
    const damageDealt = sum(summaries.map((s) => s.surplus))
    const damageReceived = sum(summaries.map((s) => s.deficit))
    return {
      energyUsedCount: placements.length,
      energyGeneratedCount: 0,
      energyPointsUsed: sum(placements.map((p) => p.point)),
      strengthGenerated,
      damageDealt,
      damageReceived,
      efficiencyRatio: strengthGenerated > 0 ? placements.length / strengthGenerated : 0,
      energyPointsGenerated: 0,
      stepCount: actions.length,
      handEnergyCount: fallbackFinalHandCount,
      handEnergyPointTotal: 0,
    }
  })()
  return {
    actions,
    placements,
    possible: stats.damageReceived === 0,
    totalEnergyUsedCount: placements.length,
    remainingDeficit: stats.damageReceived,
    spareEnergyCount: finalHandCount ?? fallbackFinalHandCount,
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
type ActivatableUnit = { unit: LaneUnit; laneIndex: number; cellIndex: number }

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
 * Global recursive backtracking across all empty slots in all lanes.
 * At each step, also tries each remaining activatable unit before placing energy,
 * so activations can be interleaved with placements in any order.
 * `budget` limits total recursive calls to keep it performant.
 */
function searchGlobal(
  allSlots: GlobalSlot[],
  slotIdx: number,
  mutableLaneCells: Map<number, (LaneUnit | null)[]>,
  pool: SearchCard[],
  actions: SolverAction[],
  remainingActivatable: ActivatableUnit[],
  collector: CollectedSolution[],
  budget: { remaining: number },
  handEnergyCount: number,
): void {
  if (budget.remaining <= 0) return
  budget.remaining--

  // All slots processed or pool exhausted — record this assignment
  if (slotIdx >= allSlots.length || pool.length === 0) {
    collector.push({ actions: [...actions] })
    return
  }

  // Try each remaining activation before processing the current slot.
  // This allows activations to occur at any point in the sequence.
  for (const act of remainingActivatable) {
    if (budget.remaining <= 0) break
    const energiesForActivation: Energy[] = pool.map((c, i) => ({ id: i, color: c.color, point: c.point }))
    const activated = triggerActivation(act.unit, energiesForActivation)
    if (activated !== null) {
      const newPool = activated.map((e) => ({ color: e.color, point: e.point }))
      const activationAction: SolverAction = { kind: 'activation', unit: act.unit, laneIndex: act.laneIndex, cellIndex: act.cellIndex }
      const newRemaining = remainingActivatable.filter((a) => a !== act)
      searchGlobal(allSlots, slotIdx, mutableLaneCells, newPool, [...actions, activationAction], newRemaining, collector, budget, handEnergyCount)
    }
  }

  const slot = allSlots[slotIdx]
  const cells = mutableLaneCells.get(slot.laneIndex)!
  const cell = cells[slot.cellIndex]
  if (!cell) {
    searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, actions, remainingActivatable, collector, budget, handEnergyCount)
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
    const placement: Placement = { laneIndex: slot.laneIndex, cellIndex: slot.cellIndex, slotIndex: slot.slotIndex, color: card.color, point: card.point }
    const placementAction: SolverAction = { kind: 'placement', placement }

    if (slot.unitType === 'support') {
      const generated = triggerSupportOnLoadForSlot(cell as LaneUnit, slot.slotIndex, { color: card.color, point: card.point })
      const newPool = [...pool.slice(0, idx), ...pool.slice(idx + 1)]
      for (const g of generated) newPool.push({ color: g.color, point: g.point })
      searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, newPool, [...actions, placementAction], remainingActivatable, collector, budget, handEnergyCount)
    } else {
      pool.splice(idx, 1)
      searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, [...actions, placementAction], remainingActivatable, collector, budget, handEnergyCount)
      pool.splice(idx, 0, card)
    }

    cell.loadedEnergy[slot.slotIndex] = prev
  }

  // Also try skipping this slot.
  searchGlobal(allSlots, slotIdx + 1, mutableLaneCells, pool, actions, remainingActivatable, collector, budget, handEnergyCount)
}

/**
 * Composite score for the "best" strategy.
 */
export function solutionScore(s: RankedSolution): number {
  if (!s.possible) return 0
  const ratio = s.stats.energyUsedCount > 0 ? s.stats.strengthGenerated / s.stats.energyUsedCount : 0
  return ratio * 2 + s.stats.energyPointsGenerated * 1.5 - s.stats.damageDealt * 2 - s.stats.energyPointsUsed * 0.1
}

export function sortByStrategy(solutions: RankedSolution[], strategy: SolverStrategy): RankedSolution[] {
  return [...solutions].sort((a, b) => {
    if (a.possible !== b.possible) return a.possible ? -1 : 1

    if (strategy === 'best') {
      const scoreDelta = solutionScore(b) - solutionScore(a)
      if (scoreDelta !== 0) return scoreDelta
      return a.stats.energyPointsUsed - b.stats.energyPointsUsed
    }
    if (strategy === 'least-cards') {
      if (a.totalEnergyUsedCount !== b.totalEnergyUsedCount) return a.totalEnergyUsedCount - b.totalEnergyUsedCount
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
      return a.totalEnergyUsedCount - b.totalEnergyUsedCount
    }
    if (b.stats.energyPointsGenerated !== a.stats.energyPointsGenerated)
      return b.stats.energyPointsGenerated - a.stats.energyPointsGenerated
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
  const seen = new Set<string>()
  const seenOutcomes = new Set<string>()
  const ranked: RankedSolution[] = []

  for (const collected of rawSolutions) {
    const { actions } = collected

    // Deduplicate by full action sequence first (cheap)
    const key = actions
      .map((a) =>
        a.kind === 'placement'
          ? `P:${a.placement.laneIndex}:${a.placement.cellIndex}:${a.placement.slotIndex}:${a.placement.color}:${a.placement.point}`
          : `A:${a.unit.unitId}:${a.unit.level}`,
      )
      .join('|')

    if (seen.has(key)) continue
    seen.add(key)

    // Deduplicate by outcome (expensive but exact)
    const evaluation = evaluateSolution(lanes, actions, energies)
    if (seenOutcomes.has(evaluation.outcomeKey)) continue
    seenOutcomes.add(evaluation.outcomeKey)
    ranked.push(toRanked(actions, lanes, totalHandCount, evaluation.stats, evaluation.finalHandCount))
  }

  ranked.sort((a, b) => {
    if (a.possible !== b.possible) return a.possible ? -1 : 1
    if (a.totalEnergyUsedCount !== b.totalEnergyUsedCount) return a.totalEnergyUsedCount - b.totalEnergyUsedCount
    return b.stats.strengthGenerated - a.stats.strengthGenerated
  })

  return max == null ? ranked : ranked.slice(0, max)
}

/** Collect all activatable units (not yet activated) that have auto-applicable effects. */
function collectActivatableUnits(lanes: Lane[]): ActivatableUnit[] {
  const result: ActivatableUnit[] = []
  for (const [laneIndex, lane] of lanes.entries()) {
    for (const [cellIndex, cell] of lane.cells.entries()) {
      if (cell && (cell.activateCount ?? 0) === 0 && AUTO_ACTIVATION_SKILLS.has(cell.skillPath)) {
        result.push({ unit: cell, laneIndex, cellIndex })
      }
    }
  }
  return result
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
    return [toRanked([], lanes, totalHandCount)]
  }

  // All activatable units are passed to the search so it can try activating
  // them at any point in the sequence (not just upfront).
  const activatable = collectActivatableUnits(lanes)

  const collector: CollectedSolution[] = []
  const budget = { remaining: 100_000 }

  const mutableLaneCells = new Map<number, (LaneUnit | null)[]>()
  for (const [i, lane] of lanes.entries()) {
    mutableLaneCells.set(i, cloneLaneCells(lane.cells))
  }

  searchGlobal(allSlots, 0, mutableLaneCells, basePool, [], activatable, collector, budget, totalHandCount)

  // Always include the empty solution as a baseline
  if (!collector.some((c) => c.actions.length === 0)) {
    collector.push({ actions: [] })
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
    return { possible: false, placements: [], totalEnergyUsedCount: 0, remainingDeficit: 0, spareEnergyCount: 0 }
  }
  const r = results[0]
  return {
    possible: r.possible,
    placements: r.placements,
    totalEnergyUsedCount: r.totalEnergyUsedCount,
    remainingDeficit: r.remainingDeficit,
    spareEnergyCount: r.spareEnergyCount,
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
  effectLabel: string | null
  laneStrengthAfter: number
  laneGoal: number
}

export type SolutionStep = ActivationSolutionStep | PlacementSolutionStep

/**
 * Simulate a solution action-by-action and return annotated steps.
 * Activations and placements are replayed in the recorded order, so an
 * activation that occurs mid-sequence reflects the correct hand state.
 */
export function computeSolutionSteps(
  lanes: Lane[],
  actions: SolverAction[],
  initialHandCount: number,
  initialEnergies: Energy[],
): SolutionStep[] {
  if (actions.length === 0) return []

  const steps: SolutionStep[] = []
  const simLanes: Lane[] = lanes.map((lane) => ({
    ...lane,
    cells: cloneLaneCells(lane.cells),
  }))
  let hand: Energy[] = initialEnergies.map((e) => ({ ...e }))
  let nextGeneratedId = Math.max(0, ...hand.map((e) => e.id), 0) + 1

  for (const action of actions) {
    if (action.kind === 'activation') {
      const handBefore = hand.map((e) => ({ color: e.color, point: e.point }))
      const result = applyActivationEffect(action.unit, hand)
      if (result !== null) {
        hand = result.energies
        steps.push({
          kind: 'activation',
          unitName: action.unit.name,
          laneIndex: action.laneIndex,
          handBefore,
          handAfter: hand.map((e) => ({ color: e.color, point: e.point })),
        })
      }
    } else {
      const p = action.placement
      const cells = simLanes[p.laneIndex].cells
      const cell = cells[p.cellIndex]
      if (!cell) continue

      // Consume from hand
      const handIdx = hand.findIndex((e) => e.color === p.color && e.point === p.point)
      if (handIdx !== -1) hand = hand.filter((_, i) => i !== handIdx)

      // Apply placement to simulation
      cell.loadedEnergy[p.slotIndex] = { color: p.color, point: p.point }

      // Compute effect label using full lane context
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
      const laneStrength = summarizeLanes(simLanes, { handEnergyCount: initialHandCount })[p.laneIndex]?.strength ?? 0

      // Generate energies if support
      const generatedEnergies = cell.unitType === 'support'
        ? triggerSupportOnLoadForSlot(cell, p.slotIndex, { color: p.color, point: p.point })
        : []

      for (const gen of generatedEnergies) {
        hand = [...hand, { id: nextGeneratedId++, color: gen.color, point: gen.point }]
      }

      steps.push({
        kind: 'placement',
        placement: p,
        unitName: cell.name,
        unitType: cell.unitType,
        slotColor: cell.slots[p.slotIndex] ?? 'white',
        generatedEnergies,
        effectLabel: breakdown.effectLabel,
        laneStrengthAfter: laneStrength,
        laneGoal: simLanes[p.laneIndex].goal,
      })
    }
  }

  return steps
}
