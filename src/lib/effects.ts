import type { LaneUnit, LoadedEnergy, UnitStrengthBreakdown } from '../types/lonestar'
import { sum } from './numbers'

export interface EffectContext {
  lane: Array<LaneUnit | null>
  cellIndex: number
  allLanes: Array<Array<LaneUnit | null>>
  handEnergyCount: number
  tripower: boolean
  highestPointInBattle: number
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

export function formatEffect(template: string, args: number[]): string {
  return template.replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '?'))
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

// When adding Strength, add args[0] more (flat bonus on any load)
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
  const otherAttackLoaded = ctx.lane
    .filter((cell, i) => i !== ctx.cellIndex && cell?.unitType === 'attack' && (cell.loadedEnergy?.some(Boolean) ?? false))
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

// When a [White] slot of adjacent Units is loaded, add args[0] Strength
const Skill_TurnMulPowerUp: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const adjacent = [ctx.cellIndex - 1, ctx.cellIndex + 1]
    .filter((i) => i >= 0 && i < ctx.lane.length)
    .map((i) => ctx.lane[i])
    .filter(Boolean) as LaneUnit[]
  const adjacentWhiteLoaded = adjacent.filter(
    (u) => u.slots.includes('white') && u.loadedEnergy.some((e) => e?.color === 'white'),
  ).length
  const bonus = adjacentWhiteLoaded * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (adj white)` : null }
}

// When adjacent Attack Units load [Blue] Energy, add args[0] Strength
const Skill_BlueCrystal: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const adjacent = [ctx.cellIndex - 1, ctx.cellIndex + 1]
    .filter((i) => i >= 0 && i < ctx.lane.length)
    .map((i) => ctx.lane[i])
    .filter(Boolean) as LaneUnit[]
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
    .flatMap((lane) => [lane[ctx.cellIndex]])
    .filter((cell, _, arr) => cell && arr.indexOf(cell) >= 0) as LaneUnit[]
  const colorsLoaded = new Set<string>()
  for (const u of sameColUnits) {
    for (const e of u.loadedEnergy) {
      if (e) colorsLoaded.add(e.color)
    }
  }
  const bonus = colorsLoaded.size * (unit.args[0] ?? 0)
  return { effectBonus: bonus, isDoubled: false, effectLabel: bonus > 0 ? `+${bonus} (col colors)` : null }
}

// Adjacent to empty position → +args[0]
const Skill_AroundEmptyAddPower: SkillHandler = (unit, loaded, ctx) => {
  if (loaded.length === 0) return noEffect()
  const adjacentEmpty = [ctx.cellIndex - 1, ctx.cellIndex + 1]
    .filter((i) => i >= 0 && i < ctx.lane.length)
    .some((i) => ctx.lane[i] === null)
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
    : { effectBonus: 0, isDoubled: false, effectLabel: unit.effect ? formatEffect(unit.effect, unit.args) : null }

  const raw = basePoints + staticPower + result.effectBonus
  const total = result.isDoubled ? raw * 2 : raw

  return {
    cellIndex: ctx.cellIndex,
    basePoints,
    staticPower,
    effectBonus: result.effectBonus,
    isDoubled: result.isDoubled,
    total,
    effectLabel: result.effectLabel,
    isManualOverride: false,
  }
}
