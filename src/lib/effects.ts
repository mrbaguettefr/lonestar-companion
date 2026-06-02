import type { Energy, LaneUnit, LoadedEnergy, UnitStrengthBreakdown } from '../types/lonestar'
import { sum } from './numbers'

export interface EffectContext {
  lane: Array<LaneUnit | null>
  laneIndex: number
  cellIndex: number
  allLanes: Array<Array<LaneUnit | null>>
  handEnergyCount: number
  tripower: boolean
  highestPointInBattle: number
}

/** Returns all cells that are exactly 1 step away in any cardinal direction. */
function get4Adjacent(
  allLanes: Array<Array<LaneUnit | null>>,
  laneIndex: number,
  cellIndex: number,
): Array<LaneUnit | null> {
  const neighbors: Array<LaneUnit | null> = []
  // Same lane, left/right
  if (cellIndex > 0)                       neighbors.push(allLanes[laneIndex]?.[cellIndex - 1] ?? null)
  if (cellIndex < (allLanes[laneIndex]?.length ?? 0) - 1) neighbors.push(allLanes[laneIndex]?.[cellIndex + 1] ?? null)
  // Same column, up/down
  if (laneIndex > 0)                       neighbors.push(allLanes[laneIndex - 1]?.[cellIndex] ?? null)
  if (laneIndex < allLanes.length - 1)     neighbors.push(allLanes[laneIndex + 1]?.[cellIndex] ?? null)
  return neighbors
}

/** Returns all 4-adjacent POSITIONS (laneIndex, cellIndex pairs). */
function get4AdjacentPositions(
  allLanes: Array<Array<LaneUnit | null>>,
  laneIndex: number,
  cellIndex: number,
): Array<{ li: number; ci: number }> {
  const positions: Array<{ li: number; ci: number }> = []
  if (cellIndex > 0)                       positions.push({ li: laneIndex, ci: cellIndex - 1 })
  if (cellIndex < (allLanes[laneIndex]?.length ?? 0) - 1) positions.push({ li: laneIndex, ci: cellIndex + 1 })
  if (laneIndex > 0)                       positions.push({ li: laneIndex - 1, ci: cellIndex })
  if (laneIndex < allLanes.length - 1)     positions.push({ li: laneIndex + 1, ci: cellIndex })
  return positions
}

type SkillResult = {
  effectBonus: number
  isDoubled: boolean
  effectLabel: string | null
}

type SkillHandler = (unit: LaneUnit, loaded: LoadedEnergy[], ctx: EffectContext) => SkillResult

// ── Utilities ──────────────────────────────────────────────────────────────

function loadedPoints(loaded: LoadedEnergy[]): number[] {
  return loaded.map((e) => e.point)
}

function countByColor(loaded: LoadedEnergy[], color: string): number {
  return loaded.filter((e) => e.color === color).length
}

function allSlotsLoaded(unit: LaneUnit, loaded: LoadedEnergy[]): boolean {
  return loaded.length === unit.slots.length
}

function hasTricolor(loaded: LoadedEnergy[]): boolean {
  const colors = new Set(loaded.map((e) => e.color))
  return colors.has('white') && colors.has('blue') && colors.has('orange')
}

function formsStraight(points: number[]): boolean {
  if (points.length < 3) return false
  const sorted = [...points].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] !== sorted[i - 1] + 1) return false
  }
  return true
}

export function formatEffect(template: string, args: number[], overclockThresholds: number[] = []): string {
  // OC thresholds fill {0},{1},… and args fill the remaining slots,
  // matching the in-game template convention where thresholds are displayed first.
  const argsAlreadyIncludeThresholds =
    overclockThresholds.length > 0 &&
    overclockThresholds.every((threshold, index) => args[index] === threshold)
  const all = argsAlreadyIncludeThresholds ? args : [...overclockThresholds, ...args]
  return template.replace(/\{(\d+)\}/g, (_, i) => String(all[Number(i)] ?? '?'))
}

function overclockBonusArg(unit: LaneUnit, bonusIndex: number): number {
  const thresholds = unit.overclockThresholds ?? []
  const argsAlreadyIncludeThresholds =
    thresholds.length > 0 &&
    thresholds.every((threshold, index) => unit.args[index] === threshold)
  const offset = argsAlreadyIncludeThresholds ? thresholds.length : 0
  return unit.args[offset + bonusIndex] ?? 0
}

function noEffect(): SkillResult {
  return { effectBonus: 0, isDoubled: false, effectLabel: null }
}


// ── Handlers — fully computable from own loaded energy ─────────────────────

const Skill_Null: SkillHandler = () => noEffect()

const Skill_NewDouble: SkillHandler = (unit, loaded) => {
  const points = loadedPoints(loaded)
  const counts = new Map<number, number>()
  for (const p of points) counts.set(p, (counts.get(p) ?? 0) + 1)
  const pairs = [...counts.values()].reduce((acc, c) => acc + Math.floor(c / 2), 0)
  const bonus = pairs * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (pair)` : null }
}

const Skill_ColorDouble: SkillHandler = (unit, loaded) => {
  const counts = new Map<string, number>()
  for (const e of loaded) counts.set(e.color, (counts.get(e.color) ?? 0) + 1)
  const pairs = [...counts.values()].reduce((acc, c) => acc + Math.floor(c / 2), 0)
  const bonus = pairs * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (color pair)` : null }
}

const Skill_LoadWhiteExtra: SkillHandler = (unit, loaded) => {
  const count = countByColor(loaded, 'white')
  const bonus = count * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (white)` : null }
}

const Skill_LoadPowerSlotNum: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const bonus = unit.slots.length
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (slots)` }
}

const Skill_SmallerThanDouble: SkillHandler = (unit, loaded) => {
  const threshold = unit.args[0] ?? 0
  const bonus = sum(loaded.filter((e) => e.point <= threshold).map((e) => e.point))
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (≤${threshold}pt doubled)` : null }
}

const Skill_SmallPointDouble: SkillHandler = (unit, loaded) => {
  if (!allSlotsLoaded(unit, loaded)) return noEffect()
  return { effectBonus: 0, isDoubled: true, effectLabel: 'double (fully loaded)' }
}

const Skill_StraightPowerUp: SkillHandler = (unit, loaded) => {
  if (!allSlotsLoaded(unit, loaded)) return noEffect()
  const points = loadedPoints(loaded)
  if (!formsStraight(points)) return noEffect()
  const bonus = unit.args[0] ?? 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (straight)` }
}

const Skill_LoadFullOncePower: SkillHandler = (unit, loaded) => {
  if (!allSlotsLoaded(unit, loaded)) return noEffect()
  const bonus = unit.args[0] ?? 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (fully loaded)` }
}

const Skill_UpgradeSqaure: SkillHandler = (unit, loaded) => {
  if (!allSlotsLoaded(unit, loaded)) return noEffect()
  const bonus = unit.args[0] ?? 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (fully loaded)` }
}

// "On load, add Strength equal to loaded point" — effectively doubles each loaded point
const Skill_PurpleDouble: SkillHandler = (_unit, loaded) => {
  const bonus = sum(loadedPoints(loaded))
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (loaded pts doubled)` : null }
}

// "On load, add Strength equal to double the loaded point" — triples each loaded point
const Skill_OverWeightTriple: SkillHandler = (_unit, loaded) => {
  const bonus = 2 * sum(loadedPoints(loaded))
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (pts tripled)` : null }
}

const Skill_LoseNextDouble: SkillHandler = (_unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  return { effectBonus: 0, isDoubled: true, effectLabel: 'double (on load)' }
}

// All points converted to args[0]
const Skill_Stability: SkillHandler = (unit, loaded) => {
  const target = unit.args[0] ?? 0
  const bonus = sum(loaded.map((e) => target - e.point))
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus !== 0 ? `pts→${target} (${bonus >= 0 ? '+' : ''}${bonus})` : null }
}

// All points enhanced to highest loaded
const Skill_Mul: SkillHandler = (_unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const maxPt = Math.max(...loadedPoints(loaded))
  const base = sum(loadedPoints(loaded))
  const bonus = loaded.length * maxPt - base
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `pts→${maxPt} (+${bonus})` : null }
}

// All points enhanced to 9
const Skill_TriangleAsNineLoad: SkillHandler = (_unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const bonus = loaded.length * 9 - sum(loadedPoints(loaded))
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `pts→9 (+${bonus})` : null }
}

const Skill_SelfLoadPointUp: SkillHandler = (unit, loaded) => {
  const bonus = loaded.length * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (pt boost)` : null }
}

// "On load, enhance the Energy into {1} point and lose {0} Power"
const Skill_LoadLoseAddedButNine: SkillHandler = (unit, loaded) => {
  const targetPt = unit.args[1] ?? 9
  const base = sum(loadedPoints(loaded))
  const bonus = loaded.length * targetPt - base - unit.staticPower
  return { effectBonus: bonus, isDoubled: false, effectLabel: `pts→${targetPt}` }
}

const Skill_NoLoadLimit: SkillHandler = (_unit, loaded) => {
  const bonus = loaded.length
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (per load)` : null }
}

// Loading 1-point or Orange energy → +args[0]
const Skill_OneOrPupleCannon: SkillHandler = (unit, loaded) => {
  const count = loaded.filter((e) => e.point === 1 || e.color === 'orange').length
  const bonus = count * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (1pt/orange)` : null }
}

// Doubles the PA (staticPower). Since staticPower is applied separately, add it again as bonus.
const Skill_AddedDouble: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0 || unit.staticPower === 0) return noEffect()
  return { effectBonus: unit.staticPower, isDoubled: false, effectLabel: `+${unit.staticPower} (PA doubled)` }
}

// "When adding Strength, add {0} more" — triggers only when energy is loaded
const Skill_ExtraPower: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const bonus = unit.args[0] ?? 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (extra)` }
}

// Doubles non-energy non-Power strength bonuses. Treat as doubling effectBonus from other effects.
// Handled as a post-process flag — mark isDoubled but only for non-base portions.
// For simplicity: if the unit has no other effect, no bonus. This is a modifier on other effects.
// We'll handle this by returning a special flag in a second pass. For now, just display.
const Skill_ExtraPowerDouble: SkillHandler = () => ({
  effectBonus: 0,
  isDoubled: false,
  effectLabel: 'doubles non-energy bonus (manual)',
})

// ── Handlers — need context ─────────────────────────────────────────────────

const Skill_DoubleByUseOnce: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const isDoubled = ctx.handEnergyCount >= (unit.args[0] ?? 0)
  return { effectBonus: 0, isDoubled, effectLabel: isDoubled ? `double (hand≥${unit.args[0]})` : `no double (hand<${unit.args[0]})` }
}

const Skill_IncreasePowerUp: SkillHandler = (_unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const pts = loadedPoints(loaded)
  const maxLoaded = Math.max(...pts)
  if (maxLoaded < ctx.highestPointInBattle) return noEffect()
  const bonus = maxLoaded
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (highest)` }
}

const Skill_LonelyCannon: SkillHandler = (_unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const otherAttackLoaded = ctx.allLanes
    .flatMap((lane, li) => lane.map((cell, ci) =>
      cell && cell.unitType === 'attack' &&
      !(li === ctx.laneIndex && ci === ctx.cellIndex) &&
      cell.loadedEnergy.some(Boolean) ? cell : null
    ))
    .filter(Boolean)
    .length
  const isDoubled = otherAttackLoaded === 0
  return {
    effectBonus: 0,
    isDoubled,
    effectLabel: isDoubled ? `double (solo attack)` : `no double (${otherAttackLoaded} other loaded)`,
  }
}

const Skill_CenterAdded: SkillHandler = (_unit, loaded, ctx) => {
  if (loaded.length === 0 || ctx.cellIndex !== 1) return noEffect()
  const bonus = loaded.length
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (center)` }
}

const Skill_CenterDouble: SkillHandler = (_unit, loaded, ctx) => {
  if (loaded.length === 0 || ctx.cellIndex !== 1) return noEffect()
  return { effectBonus: 0, isDoubled: true, effectLabel: 'double (center)' }
}

const Skill_TrianglePower: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const bonus = ctx.tripower ? (unit.args[0] ?? 0) : 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (tripower)` : null }
}

// Tripower: +args[0] as Power (same as additive bonus for us)
const Skill_TrianglePowerCannon: SkillHandler = (unit, loaded, ctx) => Skill_TrianglePower(unit, loaded, ctx)
const Skill_TrianglePowerLow: SkillHandler = (unit, loaded, ctx) => Skill_TrianglePower(unit, loaded, ctx)

const Skill_TriangleDoublePowerCannon: SkillHandler = (_unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const isDoubled = ctx.tripower
  return { effectBonus: 0, isDoubled, effectLabel: isDoubled ? 'double (tripower)' : null }
}

const Skill_TriangleAddedAsHandCount: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const base = (unit.args[0] ?? 0) * loaded.length
  const tripowerBonus = ctx.tripower ? (unit.args[1] ?? 0) * loaded.length : 0
  const bonus = base + tripowerBonus
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (on-load${ctx.tripower ? '+tripower' : ''})` : null }
}

const Skill_TriColorCannon: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const bonus = hasTricolor(loaded) ? (unit.args[0] ?? 0) : 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (tricolor)` : null }
}

// Tricolor triggered by lane loads too — approximate with own tricolor check
const Skill_TriColorLineCannon: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const triggered = hasTricolor(loaded) || ctx.tripower
  const bonus = triggered ? (unit.args[0] ?? 0) : 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (tricolor)` : null }
}

// When a [White] slot of adjacent Units is loaded, add args[0] Strength — 4-directional
const Skill_TurnMulPowerUp: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const adjacent = get4Adjacent(ctx.allLanes, ctx.laneIndex, ctx.cellIndex).filter(Boolean) as LaneUnit[]
  const adjacentWhiteLoaded = adjacent.filter(
    (u) => u.slots.includes('white') && u.loadedEnergy.some((e) => e?.color === 'white'),
  ).length
  const bonus = adjacentWhiteLoaded * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (adj white)` : null }
}

// When adjacent Attack Units load [Blue] Energy, add args[0] Strength — 4-directional
const Skill_BlueCrystal: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const adjacent = get4Adjacent(ctx.allLanes, ctx.laneIndex, ctx.cellIndex).filter(Boolean) as LaneUnit[]
  const count = adjacent.filter(
    (u) => u.unitType === 'attack' && u.loadedEnergy.some((e) => e?.color === 'blue'),
  ).length
  const bonus = count * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (adj blue)` : null }
}

// When Units in the same column load Energy, add args[0] Strength per color loaded
const Skill_AroundColorLoadSelfPower: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const sameColUnits = ctx.allLanes
    .map((lane) => lane[ctx.cellIndex])
    .filter((cell): cell is LaneUnit => cell !== null && cell !== undefined)
  const colorsLoaded = new Set<string>()
  for (const u of sameColUnits) {
    for (const e of u.loadedEnergy) {
      if (e) colorsLoaded.add(e.color)
    }
  }
  const bonus = colorsLoaded.size * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (col colors)` : null }
}

// Adjacent to empty position → +args[0] — 4-directional
const Skill_AroundEmptyAddPower: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const positions = get4AdjacentPositions(ctx.allLanes, ctx.laneIndex, ctx.cellIndex)
  const adjacentEmpty = positions.some(({ li, ci }) => !ctx.allLanes[li]?.[ci])
  const bonus = adjacentEmpty ? (unit.args[0] ?? 0) : 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (adj empty)` : null }
}

// When any Attack Unit loads Energy ≥ args[0] pts, add args[1] Strength
// For planner: if this unit itself loads ≥ args[0] points, apply the bonus
const Skill_Wanfa: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const threshold = unit.args[0] ?? 0
  const triggered = loaded.some((e) => e.point >= threshold)
  const bonus = triggered ? (unit.args[1] ?? 0) : 0
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (≥${threshold}pt)` : null }
}

// ── Overclock handlers ─────────────────────────────────────────────────────
// "Overclock N" is triggered when any loaded energy has point >= N (threshold from raw).
// Bonus is taken from args[].

// Two-level overclock (OC1 threshold → args[0] bonus, OC2 threshold → args[1] bonus)
const Skill_OverclockThreeCannon: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const [oc1, oc2] = unit.overclockThresholds ?? []
  const maxPt = Math.max(...loaded.map((e) => e.point))
  let bonus = 0
  const labels: string[] = []
  if (oc1 !== undefined && maxPt >= oc1) {
    const b = overclockBonusArg(unit, 0)
    bonus += b
    labels.push(`OC(≥${oc1})+${b}`)
  }
  if (oc2 !== undefined && maxPt >= oc2) {
    const b = overclockBonusArg(unit, 1)
    bonus += b
    labels.push(`OC(≥${oc2})+${b}`)
  }
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? labels.join(', ') : null }
}

// Single-level overclock that adds Strength (or Power treated as Strength)
const Skill_OverclockSingle: SkillHandler = (unit, loaded) => {
  if (loaded.length === 0) return noEffect()
  const [threshold] = unit.overclockThresholds ?? []
  if (threshold === undefined) return noEffect()
  const maxPt = Math.max(...loaded.map((e) => e.point))
  if (maxPt < threshold) return noEffect()
  const bonus = overclockBonusArg(unit, 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: `+${bonus} (OC≥${threshold})` }
}

// ── Dispatch map ───────────────────────────────────────────────────────────

const SKILL_HANDLERS: Record<string, SkillHandler> = {
  'Cannon_Player/Skill_Null': Skill_Null,
  'Support_Player/Skill_Useless': Skill_Null,
  'Cannon_Player/Skill_NewDouble': Skill_NewDouble,
  'Cannon_Player/Skill_ColorDouble': Skill_ColorDouble,
  'Cannon_Player/Skill_LoadWhiteExtra': Skill_LoadWhiteExtra,
  'Cannon_Player/Skill_LoadPowerSlotNum': Skill_LoadPowerSlotNum,
  'Cannon_Player/Skill_SmallerThanDouble': Skill_SmallerThanDouble,
  'Cannon_Player/Skill_SmallPointDouble': Skill_SmallPointDouble,
  'Cannon_Player/Skill_StraightPowerUp': Skill_StraightPowerUp,
  'Cannon_Player/Skill_LoadFullOncePower': Skill_LoadFullOncePower,
  'Cannon_Player/Skill_UpgradeSqaure': Skill_UpgradeSqaure,
  'Cannon_Player/Skill_PurpleDouble': Skill_PurpleDouble,
  'Cannon_Player/Skill_OverWeightTriple': Skill_OverWeightTriple,
  'Cannon_Player/Skill_LoseNextDouble': Skill_LoseNextDouble,
  'Cannon_Player/Skill_Stability': Skill_Stability,
  'Cannon_Player/Skill_Mul': Skill_Mul,
  'Cannon_Player/Skill_TriangleAsNineLoad': Skill_TriangleAsNineLoad,
  'Cannon_Player/Skill_SelfLoadPointUp': Skill_SelfLoadPointUp,
  'Cannon_Player/Skill_LoadLoseAddedButNine': Skill_LoadLoseAddedButNine,
  'Cannon_Player/Skill_NoLoadLimit': Skill_NoLoadLimit,
  'Cannon_Player/Skill_OneOrPupleCannon': Skill_OneOrPupleCannon,
  'Cannon_Player/Skill_AddedDouble': Skill_AddedDouble,
  'Cannon_Player/Skill_ExtraPower': Skill_ExtraPower,
  'Cannon_Player/Skill_ExtraPowerDouble': Skill_ExtraPowerDouble,
  'Cannon_Player/Skill_DoubleByUseOnce': Skill_DoubleByUseOnce,
  'Cannon_Player/Skill_IncreasePowerUp': Skill_IncreasePowerUp,
  'Cannon_Player/Skill_LonelyCannon': Skill_LonelyCannon,
  'Cannon_Player/Skill_CenterAdded': Skill_CenterAdded,
  'Cannon_Player/Skill_CenterDouble': Skill_CenterDouble,
  'Cannon_Player/Skill_TrianglePower': Skill_TrianglePower,
  'Cannon_Player/Skill_TrianglePowerCannon': Skill_TrianglePowerCannon,
  'Cannon_Player/Skill_TrianglePowerLow': Skill_TrianglePowerLow,
  'Cannon_Player/Skill_TriangleDoublePowerCannon': Skill_TriangleDoublePowerCannon,
  'Cannon_Player/Skill_TriangleAddedAsHandCount': Skill_TriangleAddedAsHandCount,
  'Cannon_Player/Skill_TriColorCannon': Skill_TriColorCannon,
  'Cannon_Player/Skill_TriColorLineCannon': Skill_TriColorLineCannon,
  'Cannon_Player/Skill_TurnMulPowerUp': Skill_TurnMulPowerUp,
  'Cannon_Player/Skill_BlueCrystal': Skill_BlueCrystal,
  'Cannon_Player/Skill_AroundColorLoadSelfPower': Skill_AroundColorLoadSelfPower,
  'Cannon_Player/Skill_AroundEmptyAddPower': Skill_AroundEmptyAddPower,
  'Cannon_Player/Skill_Wanfa': Skill_Wanfa,
  'Cannon_Player/Skill_OverclockThreeCannon': Skill_OverclockThreeCannon,
  'Cannon_Player/Skill_OverclockPowerCannon': Skill_OverclockSingle,
  'Cannon_Player/Skill_OverclockPowerOverLimit': Skill_OverclockSingle,
  'Cannon_Player/Skill_OverclockPowerOverLimitLow': Skill_OverclockSingle,
}

export const IMPLEMENTED_SKILLS = new Set(Object.keys(SKILL_HANDLERS))

// ── Main export ─────────────────────────────────────────────────────────────

export function computeUnitStrength(unit: LaneUnit, ctx: EffectContext): UnitStrengthBreakdown {
  // Manual override takes precedence
  if (unit.manualPowerOverride !== null) {
    return {
      cellIndex: ctx.cellIndex,
      basePoints: 0,
      staticPower: 0,
      supportPower: 0,
      effectBonus: 0,
      isDoubled: false,
      total: unit.manualPowerOverride,
      effectLabel: unit.effect ? formatEffect(unit.effect, unit.args) : null,
      isManualOverride: true,
    }
  }

  const loaded = unit.loadedEnergy.filter((e): e is LoadedEnergy => e !== null)
  const basePoints = sum(loaded.map((e) => e.point))
  const staticPower = unit.staticPower

  // Support units contribute 0 computed strength
  if (unit.unitType === 'support') {
    return {
      cellIndex: ctx.cellIndex,
      basePoints: 0,
      staticPower: 0,
      supportPower: 0,
      effectBonus: 0,
      isDoubled: false,
      total: 0,
      effectLabel: unit.effect ? formatEffect(unit.effect, unit.args) : null,
      isManualOverride: false,
    }
  }

  const handler = SKILL_HANDLERS[unit.skillPath]
  const result = handler
    ? handler(unit, loaded, ctx)
    : { effectBonus: 0, isDoubled: false, effectLabel: unit.effect ? formatEffect(unit.effect, unit.args, unit.overclockThresholds) : null }

  const activePower = loaded.length > 0 ? staticPower : 0
  const raw = basePoints + activePower + result.effectBonus
  const total = result.isDoubled ? raw * 2 : raw

  return {
    cellIndex: ctx.cellIndex,
    basePoints,
    staticPower: activePower,
    supportPower: 0,
    effectBonus: result.effectBonus,
    isDoubled: result.isDoubled,
    total,
    effectLabel: result.effectLabel,
    isManualOverride: false,
  }
}

// ── Support unit system ────────────────────────────────────────────────────

export type GeneratedEnergy = { color: string; point: number }

function upgradeColor(color: string): string {
  if (color === 'white') return 'blue'
  if (color === 'blue') return 'orange'
  return 'white'
}

function degradeColor(color: string): string {
  if (color === 'orange') return 'blue'
  if (color === 'blue') return 'white'
  return 'orange'
}

function clampPoint(p: number): number {
  return Math.max(1, Math.min(9, p))
}

/**
 * Returns energies to immediately add to the player's hand when energy
 * is dropped onto a support unit's slot. Covers all "On load, generate …" effects.
 */
export function triggerSupportOnLoad(
  unit: LaneUnit,
  loaded: LoadedEnergy,
): GeneratedEnergy[] {
  const args = unit.args
  const allLoaded = unit.loadedEnergy.filter(Boolean).length === unit.slots.length

  switch (unit.skillPath) {
    // +1 pt same color (Gentle Tap Device)
    case 'Support_Player/Skill_SmallPush':
      return [{ color: loaded.color, point: clampPoint(loaded.point + 1) }]

    // +2 pt same color (Increment Device)
    case 'Support_Player/Skill_SmallPushAndLeftHandPush':
      return [{ color: loaded.color, point: clampPoint(loaded.point + 2) }]

    // +args[0] pt same color (Boost Device)
    case 'Support_Player/Skill_LoadPowerUpTwo':
      return [{ color: loaded.color, point: clampPoint(loaded.point + (args[0] ?? 1)) }]

    // -1 pt same color (Minifying Mirror)
    case 'Support_Player/Skill_EmptyMirror':
      return [{ color: loaded.color, point: clampPoint(loaded.point - 1) }]

    // 2× pt same color (Energy Amplifier)
    case 'Support_Player/Skill_DoublePoint':
      return [{ color: loaded.color, point: clampPoint(loaded.point * 2) }]

    // copy (Whiteboard)
    case 'Support_Player/Skill_Useless':
      return [{ color: loaded.color, point: loaded.point }]

    // copy (Swap Device)
    case 'Support_Player/Skill_ReplacePower':
      return [{ color: loaded.color, point: loaded.point }]

    // same-color copy (Reroll Device) — same point for planner
    case 'Support_Player/Skill_RollPoint':
      return [{ color: loaded.color, point: loaded.point }]

    // orange args[0]-pt (High-Energy Cube / Hexagonal Rotator)
    case 'Support_Player/Skill_LittlePurplePower':
    case 'Support_Player/Skill_LoadGenerateEnergy':
      return [{ color: 'orange', point: args[0] ?? 1 }]

    // orange+blue+white 1pt (Colordrill Device)
    case 'Support_Player/Skill_Create3color1point':
      return [
        { color: 'orange', point: 1 },
        { color: 'blue', point: 1 },
        { color: 'white', point: 1 },
      ]

    // degraded-color + blue 1pt (Extraction Device)
    case 'Support_Player/Skill_EnergyExtract':
      return [
        { color: degradeColor(loaded.color), point: loaded.point },
        { color: 'blue', point: 1 },
      ]

    // upgraded-color same pt (Chameleon Device)
    case 'Support_Player/Skill_ColorChange':
      return [{ color: upgradeColor(loaded.color), point: loaded.point }]

    // blue-mixed copy (Blue Stain) — simplify: blue copy
    case 'Support_Player/Skill_LoadExtraAddBlue':
      return [{ color: 'blue', point: loaded.point }]

    // -1pt + 1pt (Separation Device)
    case 'Support_Player/Skill_SliptOne':
      return [
        { color: loaded.color, point: clampPoint(loaded.point - 1) },
        { color: loaded.color, point: 1 },
      ]

    // 2 orange 5pt (Single-Use Energy)
    case 'Support_Player/Skill_DestroyHandToNum':
      return [
        { color: 'orange', point: 5 },
        { color: 'orange', point: 5 },
      ]

    // Fully Loaded: orange args[0]-pt (7-Point Device)
    case 'Support_Player/Skill_StableCore':
      return allLoaded ? [{ color: 'orange', point: args[0] ?? 7 }] : []

    // Fully Loaded: 3 energies (Reforge Device)
    case 'Support_Player/Skill_LoadFullCreateThree':
      return allLoaded
        ? [{ color: 'white', point: 1 }, { color: 'white', point: 1 }, { color: 'white', point: 1 }]
        : []

    // Fully Loaded: white 9pt (Expansion Device)
    case 'Support_Player/Skill_LoadFullCreateNineAddSlot':
      return allLoaded ? [{ color: 'white', point: 9 }] : []

    // orange/blue/white at degraded color (Attenuation Device) - also adds strength behind, handled passively
    case 'Support_Player/Skill_ReducePointPowerUpRight':
      return [{ color: loaded.color, point: clampPoint(loaded.point - 1) }]

    default:
      return []
  }
}

export function triggerSupportOnLoadForSlot(
  unit: LaneUnit,
  slotIndex: number,
  loaded: LoadedEnergy,
): GeneratedEnergy[] {
  const loadedEnergy = [...unit.loadedEnergy]
  loadedEnergy[slotIndex] = loaded
  return triggerSupportOnLoad({ ...unit, loadedEnergy }, loaded)
}

/** Skills that have on-load energy generation (used to show a ⚡ indicator in UI) */
export const SUPPORT_GENERATES_ENERGY = new Set([
  'Support_Player/Skill_SmallPush',
  'Support_Player/Skill_SmallPushAndLeftHandPush',
  'Support_Player/Skill_LoadPowerUpTwo',
  'Support_Player/Skill_EmptyMirror',
  'Support_Player/Skill_DoublePoint',
  'Support_Player/Skill_Useless',
  'Support_Player/Skill_ReplacePower',
  'Support_Player/Skill_RollPoint',
  'Support_Player/Skill_LittlePurplePower',
  'Support_Player/Skill_LoadGenerateEnergy',
  'Support_Player/Skill_Create3color1point',
  'Support_Player/Skill_EnergyExtract',
  'Support_Player/Skill_ColorChange',
  'Support_Player/Skill_LoadExtraAddBlue',
  'Support_Player/Skill_SliptOne',
  'Support_Player/Skill_DestroyHandToNum',
  'Support_Player/Skill_StableCore',
  'Support_Player/Skill_LoadFullCreateThree',
  'Support_Player/Skill_LoadFullCreateNineAddSlot',
  'Support_Player/Skill_ReducePointPowerUpRight',
])

/**
 * Skills whose activation effect automatically modifies the energy hand.
 * Other activatable units still show an Activate button but effects are tracked manually.
 */
export const AUTO_ACTIVATION_SKILLS = new Set([
  'Support_Player/Skill_HandToWhite',
  'Support_Player/Skill_TurnEndPowerUp',
  'Support_Player/Skill_StrongGenerate',
  'Support_Player/Skill_FreePurple',
])

/**
 * Apply a unit's *Activate* effect to the energy hand.
 * Returns a new Energy[] with the effect applied, or null if the skill has no auto effect.
 */
export function triggerActivation(unit: LaneUnit, energies: Energy[]): Energy[] | null {
  const args = unit.args
  let nextId = Math.max(0, ...energies.map((e) => e.id)) + 1

  function addCards(result: Energy[], color: string, point: number, count = 1): Energy[] {
    const clamped = Math.min(9, Math.max(1, point))
    return [
      ...result,
      ...Array.from({ length: count }, () => ({ id: nextId++, color, point: clamped })),
    ]
  }

  switch (unit.skillPath) {
    // Bleaching Device: boost ALL energies by addPts, then convert orange/blue to white
    case 'Support_Player/Skill_HandToWhite': {
      const addPts = args[1] ?? 1
      const boosted = energies.map((e) => ({ ...e, point: Math.min(9, Math.max(1, e.point + addPts)) }))
      let result = boosted.filter((e) => e.color === 'white')
      for (const e of boosted) {
        if (e.color === 'orange' || e.color === 'blue') {
          result = addCards(result, 'white', e.point)
        }
      }
      return result
    }

    // Growth Device: add args[1] points to all white energy in hand
    case 'Support_Player/Skill_TurnEndPowerUp': {
      const addPts = args[1] ?? 1
      return energies.map((e) =>
        e.color === 'white'
          ? { ...e, point: Math.min(9, Math.max(1, e.point + addPts)) }
          : e,
      )
    }

    // Weak Energy Source lv1: generate 1 white 1-pt energy; lv2: 1 orange 1-pt
    case 'Support_Player/Skill_StrongGenerate': {
      const color = unit.effect.includes('Orange') ? 'orange' : 'white'
      return addCards([...energies], color, 1)
    }

    // Pulse Recharger lv1: generate args[1] white args[2]-pt; lv2: orange
    case 'Support_Player/Skill_FreePurple': {
      const color = unit.effect.includes('Orange') ? 'orange' : 'white'
      const count = args[1] ?? 1
      const point = args[2] ?? 6
      return addCards([...energies], color, point, count)
    }

    default:
      return null
  }
}

/**
 * Returns the strength bonus that a support unit passively provides to a
 * specific attack unit. Uses full lane+cell positions so adjacency can be
 * checked in all 4 cardinal directions (left, right, up, down).
 */
export function computeSupportPassiveBonus(
  support: LaneUnit,
  supportLaneIndex: number,
  supportCellIndex: number,
  targetLaneIndex: number,
  targetCellIndex: number,
  allLanes: Array<Array<LaneUnit | null>>,
): number {
  const args = support.args
  const sameLane = targetLaneIndex === supportLaneIndex
  const sameCol  = targetCellIndex === supportCellIndex

  // 4-directional adjacency: exactly one step in exactly one axis
  const isAdjacent4 =
    (sameLane && Math.abs(targetCellIndex - supportCellIndex) === 1) ||
    (sameCol  && Math.abs(targetLaneIndex - supportLaneIndex) === 1)

  // "front" / "behind" are within the same lane only (column positions)
  const isFront  = sameLane && targetCellIndex === supportCellIndex - 1
  const isBehind = sameLane && targetCellIndex === supportCellIndex + 1

  const targetLane = allLanes[targetLaneIndex] ?? []
  const loadedCount = support.loadedEnergy.filter(Boolean).length
  const allLoaded = loadedCount === support.slots.length && support.slots.length > 0

  const targetUnit = allLanes[targetLaneIndex]?.[targetCellIndex]
  const targetHasEnergy = targetUnit?.loadedEnergy.some(Boolean) ?? false

  switch (support.skillPath) {
    // Battle start: +{0} Power to 4-directionally adjacent attack units (Amplification Device)
    // Only applies when the target unit has at least one energy loaded.
    case 'Support_Player/Skill_AroundPowerUp':
      return isAdjacent4 && targetHasEnergy ? (args[0] ?? 0) : 0

    // Battle start: +{0} Power to front attack unit (Power Supply Module)
    case 'Support_Player/Skill_FrontAddedPowerBattleStart':
      return isFront && targetHasEnergy ? (args[0] ?? 0) : 0

    // On load: add strength to ALL attack units in same lane — proportional to loaded count
    case 'Support_Player/Skill_LoadedAllPowerPurple':
      return sameLane && loadedCount > 0 ? (args[0] ?? 0) * loadedCount : 0

    // On load: add 2×point to unit directly behind — per loaded energy
    case 'Support_Player/Skill_LoadAddBackPower':
      if (!isBehind || loadedCount === 0) return 0
      return support.loadedEnergy
        .filter((e): e is LoadedEnergy => e !== null)
        .reduce((acc, e) => acc + e.point * 2, 0)

    // On load: add {0} Strength to all attack units in same lane
    case 'Support_Player/Skill_LoadLinePowerButLoseAdded':
      return sameLane && loadedCount > 0 ? (args[0] ?? 0) * loadedCount : 0

    // Fully loaded: +{0} Power to all attack units in same lane (Global Radiator)
    case 'Support_Player/Skill_SupportAttack':
      return sameLane && allLoaded ? (args[0] ?? 0) : 0

    // Attenuation Device: +{0} Strength to unit directly behind
    case 'Support_Player/Skill_ReducePointPowerUpRight':
      return isBehind && loadedCount > 0 ? (args[0] ?? 0) * loadedCount : 0

    // Single-Use Electric Arc: on load, +{0} Power to unit behind and double its Power
    case 'Support_Player/Skill_OnceAddedDouble': {
      if (!isBehind || loadedCount === 0) return 0
      const behindUnit = targetLane[targetCellIndex]
      if (!behindUnit) return 0
      return behindUnit.staticPower + (args[0] ?? 0)
    }

    // Adjacent Attack Units have Double Strength while not loaded (Ring of Strength) — 4 directions
    case 'Support_Player/Skill_NoLoadHaveRate': {
      if (!isAdjacent4) return 0
      const targetUnit = targetLane[targetCellIndex]
      if (!targetUnit) return 0
      const targetUnloaded = targetUnit.loadedEnergy.filter(Boolean).length === 0
      return targetUnloaded ? targetUnit.staticPower : 0
    }

    default:
      return 0
  }
}
