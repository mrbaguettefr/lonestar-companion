import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { EnergySection } from './components/EnergySection'
import { GoalsSection } from './components/GoalsSection'
import { LaneSection } from './components/LaneSection'
import { SolutionPanel } from './components/SolutionPanel'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import {
  canDropEnergyInSlot,
  createEmptyLanes,
  energyPoints,
  extractMaxActivations,
  extractOverclockThresholds,
  extractStaticPower,
  initialEnergies,
  initialLanes,
  maxLaneColumns,
} from './lib/gameData'
import { clampNumber } from './lib/numbers'
import { buildBattleContext, evaluateCurrentBoard, replayActions, solveMultiple, sortByStrategy, summarizeLanes, type RankedSolution, type SolverAction, type SolverStrategy } from './lib/solver'
import { IMPLEMENTED_SKILLS, applyActivationEffect, effectiveStaticPower, formatEffect, triggerSupportOnLoadForSlot } from './lib/effects'
import type {
  DragPayload,
  Energy,
  Lane,
  LaneUnit,
  LoadedEnergy,
  LonestarData,
  PlayerShip,
  UnitModId,
  UnitOption,
} from './types/lonestar'

type EditingCell = {
  laneIndex: number
  cellIndex: number
}

type ExportedCell = {
  unitId: number
  level: number
  loadedEnergy: (LoadedEnergy | null)[]
  manualPowerOverride: number | null
  activateCount: number
  mods?: UnitModId[]
} | null

type ConfigExport =
  | { version: 1; shipId: string; lanes: Lane[]; energies: Energy[] }
  | { version: 2; shipId: string; lanes: Array<{ cells: ExportedCell[]; goal: number }>; energies: Energy[] }

const unitModOptions = [
  { id: 'power-plus-1', label: 'Power +1' },
] satisfies Array<{ id: UnitModId; label: string }>

const maxHandEnergyCount = 10

function createHandEnergy(color: string, point: number): Energy {
  return { id: Date.now() + Math.random(), color, point }
}

function clampHandEnergies(energies: Energy[]): Energy[] {
  return energies.slice(0, maxHandEnergyCount)
}

function resetLaneActivations(lanes: Lane[]): Lane[] {
  return lanes.map((lane) => ({
    ...lane,
    cells: lane.cells.map((cell) => (cell ? { ...cell, activateCount: 0 } : cell)),
  }))
}

function resetBoardState(lanes: Lane[], energies: Energy[]): { lanes: Lane[]; energies: Energy[] } {
  let nextEnergyId = Math.max(0, ...energies.map((energy) => energy.id)) + 1
  const returnedEnergies: Energy[] = []
  const resetLanes = resetLaneActivations(lanes).map((lane) => ({
    ...lane,
    cells: lane.cells.map((cell) => {
      if (!cell) return cell

      for (const energy of cell.loadedEnergy) {
        if (energy) {
          returnedEnergies.push({
            id: nextEnergyId++,
            color: energy.color,
            point: energy.point,
          })
        }
      }

      return {
        ...cell,
        loadedEnergy: Array(cell.slots.length).fill(null),
      }
    }),
  }))

  return {
    lanes: resetLanes,
    energies: clampHandEnergies([...energies, ...returnedEnergies]),
  }
}

type HistoryEntry = {
  lanes: Lane[]
  energies: Energy[]
  activationEnergyPointsGenerated: number
  activationEnergyGeneratedCount: number
}

function App() {
  const [lanes, setLanes] = useState<Lane[]>(initialLanes)
  const [energies, setEnergies] = useState<Energy[]>(initialEnergies)
  const [hasSolved, setHasSolved] = useState(false)
  const [ships, setShips] = useState<PlayerShip[]>([])
  const [unitOptions, setUnitOptions] = useState<UnitOption[]>([])
  const [selectedShipId, setSelectedShipId] = useState('')
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [draftUnitId, setDraftUnitId] = useState('')
  const [draftLoadedEnergy, setDraftLoadedEnergy] = useState<(LoadedEnergy | null)[]>([])
  const [draftManualOverride, setDraftManualOverride] = useState<number | null>(null)
  const [draftMods, setDraftMods] = useState<UnitModId[]>([])
  const [draftModToAdd, setDraftModToAdd] = useState<UnitModId>('power-plus-1')
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [importError, setImportError] = useState<string | null>(null)
  const [isImportOpen, setIsImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [solvedResults, setSolvedResults] = useState<RankedSolution[]>([])
  const [loadedSolutionIdx, setLoadedSolutionIdx] = useState<number>(0)
  const [solverStrategy, setSolverStrategy] = useState<SolverStrategy>('best')
  const [presolvedLanes, setPresolvedLanes] = useState<Lane[] | null>(null)
  const [presolvedEnergies, setPresolvedEnergies] = useState<Energy[] | null>(null)
  const [activationEnergyPointsGenerated, setActivationEnergyPointsGenerated] = useState(0)
  const [activationEnergyGeneratedCount, setActivationEnergyGeneratedCount] = useState(0)
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([])

  const handEnergyPointTotal = useMemo(
    () => energies.reduce((total, energy) => total + energy.point, 0),
    [energies],
  )
  const handSummaryKey = `${energies.length}:${handEnergyPointTotal}`

  const battleContext = useMemo(() => buildBattleContext(energies), [energies.length])
  const laneSummaries = useMemo(() => summarizeLanes(lanes, battleContext), [lanes, battleContext])
  const currentEvaluation = useMemo(
    () => evaluateCurrentBoard(lanes, laneSummaries, energies, activationEnergyPointsGenerated, activationEnergyGeneratedCount),
    [lanes, laneSummaries, handSummaryKey, activationEnergyPointsGenerated, activationEnergyGeneratedCount],
  )
  const loadedSolution = solvedResults[loadedSolutionIdx] ?? null
  const solvedIsPossible = loadedSolution?.possible ?? false
  const selectedShip = useMemo(
    () => ships.find((ship) => String(ship.id) === selectedShipId) ?? null,
    [selectedShipId, ships],
  )
  const selectedUnitOptions = useMemo(
    () =>
      selectedShip
        ? unitOptions.filter((unit) => unit.shipKeys?.includes(selectedShip.key))
        : unitOptions,
    [selectedShip, unitOptions],
  )

  useEffect(() => {
    let isMounted = true

    fetch('/lonestar_data.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load lonestar_data.json: ${response.status}`)
        return response.json() as Promise<LonestarData>
      })
      .then((data) => {
        if (!isMounted) return

        setShips(data.ships.players)
        setUnitOptions(
          data.units
            .flatMap((unit) =>
              unit.levels
                .sort((a, b) => a.level - b.level)
                .map((level) => ({
                  key: `${unit.id}:${level.level}`,
                  unitId: unit.id,
                  level: level.level,
                  name: level.name,
                  slots: level.slots,
                  skillPath: unit.skill_path,
                  unitType: unit.type,
                  staticPower: extractStaticPower(level.raw?.properties ?? ''),
                  overclockThresholds: extractOverclockThresholds(level.raw?.properties ?? ''),
                  maxActivations: extractMaxActivations(level.effect),
                  effect: level.effect,
                  args: level.args,
                  shipKeys: unit.ships
                    .filter((ship) => ship.kind === 'player')
                    .map((ship) => ship.ship),
                })),
            )
            .filter((unit) => unit.shipKeys.length > 0)
            .sort((a, b) => {
              const nameCompare = a.name.localeCompare(b.name)
              return nameCompare === 0 ? a.unitId - b.unitId : nameCompare
            }),
        )
        setDataStatus('ready')
      })
      .catch(() => {
        if (isMounted) setDataStatus('error')
      })

    return () => {
      isMounted = false
    }
  }, [])

  // Migrate stale lane cells missing fields added after initial release.
  useEffect(() => {
    if (unitOptions.length === 0) return
    setLanes((prev) => {
      const needsMigration = prev.some((lane) =>
        lane.cells.some(
          (cell) => cell && (cell.overclockThresholds == null || cell.maxActivations == null || cell.mods == null),
        ),
      )
      if (!needsMigration) return prev
      return prev.map((lane) => ({
        ...lane,
        cells: lane.cells.map((cell) => {
          if (!cell || (cell.overclockThresholds != null && cell.maxActivations != null && cell.mods != null)) return cell
          const option = unitOptions.find(
            (o) => o.unitId === cell.unitId && o.level === cell.level,
          )
          return {
            ...cell,
            overclockThresholds: cell.overclockThresholds ?? option?.overclockThresholds ?? [],
            maxActivations: cell.maxActivations ?? option?.maxActivations ?? 0,
            activateCount: cell.activateCount ?? 0,
            mods: cell.mods ?? [],
          }
        }),
      }))
    })
  }, [unitOptions])

  function markInputChanged() {
    setHasSolved(false)
    setSolvedResults([])
    setLoadedSolutionIdx(0)
    setPresolvedLanes(null)
    setPresolvedEnergies(null)
  }

  function pushHistory() {
    setUndoStack((prev) => [...prev.slice(-29), { lanes, energies, activationEnergyPointsGenerated, activationEnergyGeneratedCount }])
    setRedoStack([])
  }

  function undo() {
    if (undoStack.length === 0) return
    const prev = undoStack[undoStack.length - 1]
    setRedoStack((r) => [...r.slice(-29), { lanes, energies, activationEnergyPointsGenerated, activationEnergyGeneratedCount }])
    setUndoStack((u) => u.slice(0, -1))
    setLanes(prev.lanes)
    setEnergies(prev.energies)
    setActivationEnergyPointsGenerated(prev.activationEnergyPointsGenerated)
    setActivationEnergyGeneratedCount(prev.activationEnergyGeneratedCount)
    markInputChanged()
  }

  function redo() {
    if (redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setUndoStack((u) => [...u.slice(-29), { lanes, energies, activationEnergyPointsGenerated, activationEnergyGeneratedCount }])
    setRedoStack((r) => r.slice(0, -1))
    setLanes(next.lanes)
    setEnergies(next.energies)
    setActivationEnergyPointsGenerated(next.activationEnergyPointsGenerated)
    setActivationEnergyGeneratedCount(next.activationEnergyGeneratedCount)
    markInputChanged()
  }

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.key === 'y') || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undoStack, redoStack, lanes, energies])

  function selectShip(shipId: string) {
    markInputChanged()
    setActivationEnergyPointsGenerated(0)
    setActivationEnergyGeneratedCount(0)
    setSelectedShipId(shipId)
    setEditingCell(null)
    const ship = ships.find((candidate) => String(candidate.id) === shipId)
    setLanes(ship ? createShipLanes(ship, unitOptions) : initialLanes)
  }

  function openCellDialog(laneIndex: number, cellIndex: number) {
    const existing = lanes[laneIndex]?.cells[cellIndex] ?? null
    setEditingCell({ laneIndex, cellIndex })
    const defaultUnitKey = existing
      ? `${existing.unitId}:${existing.level}`
      : (selectedUnitOptions[0]?.key ?? '')
    setDraftUnitId(defaultUnitKey)
    if (existing) {
      setDraftLoadedEnergy([...existing.loadedEnergy])
      setDraftManualOverride(existing.manualPowerOverride)
      setDraftMods(existing.mods ?? [])
    } else {
      const unit = selectedUnitOptions.find((o) => o.key === defaultUnitKey)
      setDraftLoadedEnergy(Array(unit?.slots.length ?? 0).fill(null))
      setDraftManualOverride(null)
      setDraftMods([])
    }
  }

  function handleDraftUnitChange(newKey: string) {
    setDraftUnitId(newKey)
    const unit = selectedUnitOptions.find((o) => o.key === newKey)
    setDraftLoadedEnergy(Array(unit?.slots.length ?? 0).fill(null))
    setDraftManualOverride(null)
    setDraftMods([])
  }

  function saveCell() {
    if (!editingCell) return
    const unit = selectedUnitOptions.find((option) => option.key === draftUnitId)
    if (!unit) return
    const existing = lanes[editingCell.laneIndex]?.cells[editingCell.cellIndex] ?? null
    const isChangingLoadedUnit =
      existing !== null &&
      `${existing.unitId}:${existing.level}` !== draftUnitId &&
      existing.loadedEnergy.some(Boolean)
    const boardState = isChangingLoadedUnit ? resetBoardState(lanes, energies) : { lanes, energies }
    const nextLoadedEnergy = isChangingLoadedUnit
      ? Array(unit.slots.length).fill(null)
      : draftLoadedEnergy

    markInputChanged()
    if (isChangingLoadedUnit) {
      setEnergies(boardState.energies)
      setActivationEnergyPointsGenerated(0)
      setActivationEnergyGeneratedCount(0)
    }
    setLanes(
      boardState.lanes.map((lane, index) =>
        index === editingCell.laneIndex
          ? {
              ...lane,
              cells: lane.cells.map((cell, innerIndex) =>
                innerIndex === editingCell.cellIndex
                  ? ({
                      unitId: unit.unitId,
                      level: unit.level,
                      name: unit.name,
                      skillPath: unit.skillPath,
                      unitType: unit.unitType,
                      staticPower: unit.staticPower,
                      overclockThresholds: unit.overclockThresholds,
                      maxActivations: unit.maxActivations,
                      activateCount: 0,
                      slots: unit.slots,
                      loadedEnergy: nextLoadedEnergy,
                      manualPowerOverride: draftManualOverride,
                      effect: unit.effect,
                      args: unit.args,
                      mods: draftMods,
                    } satisfies LaneUnit)
                  : cell,
              ),
            }
          : lane,
      ),
    )
    setEditingCell(null)
  }

  function activateUnit(laneIndex: number, cellIndex: number) {
    const cell = lanes[laneIndex]?.cells[cellIndex]
    if (!cell || cell.activateCount >= cell.maxActivations) return

    const activationResult = applyActivationEffect(cell, energies)

    pushHistory()
    markInputChanged()

    if (activationResult !== null) {
      setActivationEnergyPointsGenerated((current) => current + activationResult.energyPointsGenerated)
      setActivationEnergyGeneratedCount((current) => current + activationResult.energyGeneratedCount)
      setEnergies(clampHandEnergies(activationResult.energies))
    }

    setLanes((current) =>
      current.map((lane, li) =>
        li !== laneIndex
          ? lane
          : {
              ...lane,
              cells: lane.cells.map((c, ci) =>
                ci !== cellIndex || !c ? c : { ...c, activateCount: c.activateCount + 1 },
              ),
            },
      ),
    )
  }

  function clearCell(laneIndex: number, cellIndex: number) {
    // Return all loaded energy in that cell back to hand before clearing
    const cell = lanes[laneIndex]?.cells[cellIndex]
    if (cell) {
      const toReturn = cell.loadedEnergy.filter((e): e is LoadedEnergy => e !== null)
      if (toReturn.length > 0) {
        returnMultipleEnergiesToHand(toReturn)
      }
    }
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex
          ? { ...lane, cells: lane.cells.map((cell, innerIndex) => innerIndex === cellIndex ? null : cell) }
          : lane,
      ),
    )
  }

  function moveCell(
    fromLaneIndex: number,
    fromCellIndex: number,
    toLaneIndex: number,
    toCellIndex: number,
  ) {
    if (fromLaneIndex === toLaneIndex && fromCellIndex === toCellIndex) return

    markInputChanged()
    setLanes((current) => {
      const next = current.map((lane) => ({ ...lane, cells: [...lane.cells] }))

      if (!next[fromLaneIndex]?.cells[fromCellIndex] || !next[toLaneIndex]?.cells) return current
      if (toCellIndex < 0 || toCellIndex >= next[toLaneIndex].cells.length) return current

      const fromCell = next[fromLaneIndex].cells[fromCellIndex]
      const toCell = next[toLaneIndex].cells[toCellIndex]

      next[toLaneIndex].cells[toCellIndex] = fromCell ?? null
      next[fromLaneIndex].cells[fromCellIndex] = toCell

      return next
    })
  }

  function updateGoal(laneIndex: number, value: number) {
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex ? { ...lane, goal: clampNumber(value) } : lane,
      ),
    )
  }

  function addEnergy(spec: { color: string; point: number }) {
    if (energies.length >= maxHandEnergyCount) return
    markInputChanged()
    setEnergies((current) =>
      current.length >= maxHandEnergyCount
        ? current
        : [...current, createHandEnergy(spec.color, spec.point)],
    )
  }

  function updateEnergy(id: number, patch: Partial<Energy>) {
    markInputChanged()
    setEnergies((current) =>
      current.map((energy) => (energy.id === id ? { ...energy, ...patch } : energy)),
    )
  }

  function reorderEnergyInHand(energyId: number, targetIndex: number) {
    const fromIndex = energies.findIndex((energy) => energy.id === energyId)
    if (fromIndex === -1) return

    const boundedTargetIndex = Math.max(0, Math.min(targetIndex, energies.length))
    const insertIndex = fromIndex < boundedTargetIndex ? boundedTargetIndex - 1 : boundedTargetIndex
    if (fromIndex === insertIndex) return

    pushHistory()
    setEnergies((current) => {
      const currentFromIndex = current.findIndex((energy) => energy.id === energyId)
      if (currentFromIndex === -1) return current

      const [moved] = current.slice(currentFromIndex, currentFromIndex + 1)
      const withoutMoved = current.filter((_, index) => index !== currentFromIndex)
      const currentTargetIndex = Math.max(0, Math.min(targetIndex, current.length))
      const currentInsertIndex =
        currentFromIndex < currentTargetIndex ? currentTargetIndex - 1 : currentTargetIndex

      return [
        ...withoutMoved.slice(0, currentInsertIndex),
        moved,
        ...withoutMoved.slice(currentInsertIndex),
      ]
    })
  }

  function removeEnergy(id: number) {
    markInputChanged()
    setEnergies((current) => current.filter((energy) => energy.id !== id))
  }

  // ── Energy helpers ──────────────────────────────────────────────────────

  function returnMultipleEnergiesToHand(toReturn: LoadedEnergy[]) {
    setEnergies((current) => {
      let updated = [...current]
      for (const e of toReturn) {
        if (updated.length >= maxHandEnergyCount) break
        updated = [...updated, createHandEnergy(e.color, e.point)]
      }
      return updated
    })
  }

  function hasEnergyInHand(payload: Extract<DragPayload, { type: 'energy-hand' }>) {
    return energies.some(
      (energy) =>
        energy.id === payload.energyId ||
        (energy.color === payload.color && energy.point === payload.point),
    )
  }

  function consumeEnergyFromHand(current: Energy[], payload: Extract<DragPayload, { type: 'energy-hand' }>) {
    const byId = current.findIndex((energy) => energy.id === payload.energyId)
    const fallback = current.findIndex(
      (energy) => energy.color === payload.color && energy.point === payload.point,
    )
    const idx = byId !== -1 ? byId : fallback
    if (idx === -1) return current

    return current.filter((_, energyIndex) => energyIndex !== idx)
  }

  // Drop energy from hand or another slot onto a unit slot
  function dropEnergyToSlot(payload: DragPayload, toLane: number, toCell: number, toSlot: number) {
    if (payload.type === 'unit') return
    if (payload.type === 'energy-hand' && !hasEnergyInHand(payload)) return

    const targetCell = lanes[toLane]?.cells[toCell]
    if (!targetCell) return

    const slotColor = targetCell.slots[toSlot]
    if (!canDropEnergyInSlot(payload.color, slotColor)) return

    pushHistory()
    markInputChanged()

    const displaced = targetCell.loadedEnergy[toSlot]
    const energyToLoad: LoadedEnergy = { color: payload.color, point: payload.point }

    // Determine if displaced can go back to source slot (slot-to-slot swap)
    let canSwapToSource = false
    if (payload.type === 'energy-slot' && displaced) {
      const sourceCell = lanes[payload.laneIndex]?.cells[payload.cellIndex]
      const sourceSlotColor = sourceCell?.slots[payload.slotIndex]
      canSwapToSource = Boolean(sourceSlotColor && canDropEnergyInSlot(displaced.color, sourceSlotColor))
    }

    if (
      displaced &&
      energies.length >= maxHandEnergyCount &&
      (payload.type === 'energy-hand' || (payload.type === 'energy-slot' && !canSwapToSource))
    ) {
      return
    }

    setLanes((current) =>
      current.map((lane, li) => ({
        ...lane,
        cells: lane.cells.map((cell, ci) => {
          if (!cell) return cell

          // Update target slot
          if (li === toLane && ci === toCell) {
            const newLoaded = [...cell.loadedEnergy]
            newLoaded[toSlot] = energyToLoad
            return {
              ...cell,
              loadedEnergy: newLoaded,
              overclockThresholds: cell.overclockThresholds ??
                unitOptions.find((o) => o.unitId === cell.unitId && o.level === cell.level)?.overclockThresholds ?? [],
            }
          }

          // Clear/swap source slot
          if (
            payload.type === 'energy-slot' &&
            li === payload.laneIndex &&
            ci === payload.cellIndex &&
            !(li === toLane && ci === toCell)
          ) {
            const newLoaded = [...cell.loadedEnergy]
            newLoaded[payload.slotIndex] = canSwapToSource ? (displaced ?? null) : null
            return {
              ...cell,
              loadedEnergy: newLoaded,
              overclockThresholds: cell.overclockThresholds ??
                unitOptions.find((o) => o.unitId === cell.unitId && o.level === cell.level)?.overclockThresholds ?? [],
            }
          }

          return cell
        }),
      })),
    )

    setEnergies((current) => {
      let updated = [...current]

      if (payload.type === 'energy-hand') {
        updated = consumeEnergyFromHand(updated, payload)
      }

      // Return displaced energy to hand if it can't swap back to source slot
      const needsReturn =
        displaced &&
        (payload.type === 'energy-hand' || (payload.type === 'energy-slot' && !canSwapToSource))

      if (needsReturn) {
        updated = [...updated, createHandEnergy(displaced.color, displaced.point)]
      }

      // Trigger support unit on-load effect (energy generation)
      if (targetCell.unitType === 'support') {
        const generated = triggerSupportOnLoadForSlot(targetCell, toSlot, energyToLoad)
        for (const gen of generated) {
          if (updated.length >= maxHandEnergyCount) break
          updated = [...updated, createHandEnergy(gen.color, gen.point)]
        }
      }

      return clampHandEnergies(updated)
    })
  }

  // Return energy from a unit slot back to the hand section
  function dropEnergyToHand(payload: DragPayload) {
    if (payload.type !== 'energy-slot') return
    const { laneIndex, cellIndex, slotIndex, color, point } = payload

    pushHistory()
    markInputChanged()

    setLanes((current) =>
      current.map((lane, li) =>
        li === laneIndex
          ? {
              ...lane,
              cells: lane.cells.map((cell, ci) =>
                ci === cellIndex && cell
                  ? { ...cell, loadedEnergy: cell.loadedEnergy.map((e, si) => si === slotIndex ? null : e) }
                  : cell,
              ),
            }
          : lane,
      ),
    )

    setEnergies((current) => {
      return current.length >= maxHandEnergyCount
        ? current
        : [...current, createHandEnergy(color, point)]
    })
  }

  // ── Apply solver placements ────────────────────────────────────────────

  function applyActions(actions: SolverAction[]) {
    if (actions.length === 0) return
    pushHistory()
    const replay = replayActions(lanes, energies, actions)
    setLanes(replay.lanes)
    setEnergies(clampHandEnergies(replay.energies))
    setActivationEnergyPointsGenerated((current) => current + replay.activationEnergyPointsGenerated)
    setActivationEnergyGeneratedCount((current) => current + replay.activationEnergyGeneratedCount)
  }

  function resetBoard() {
    pushHistory()
    const sourceLanes = presolvedLanes ?? lanes
    const sourceEnergies = presolvedEnergies ?? energies
    const resetState = resetBoardState(sourceLanes, sourceEnergies)
    setLanes(resetState.lanes)
    setEnergies(resetState.energies)
    setActivationEnergyPointsGenerated(0)
    setActivationEnergyGeneratedCount(0)
    setHasSolved(false)
    setSolvedResults([])
    setLoadedSolutionIdx(0)
    setPresolvedLanes(null)
    setPresolvedEnergies(null)
  }

  function loadSolution(idx: number) {
    if (!presolvedLanes || !presolvedEnergies || solvedResults.length === 0) return
    const solution = solvedResults[idx]
    if (!solution) return

    const replay = replayActions(presolvedLanes, presolvedEnergies, solution.actions)
    setLanes(replay.lanes)
    setEnergies(clampHandEnergies(replay.energies))
    setLoadedSolutionIdx(idx)
  }

  // ── Import / Export ────────────────────────────────────────────────────

  function exportToClipboard() {
    const sourceLanes = presolvedLanes ?? lanes
    const sourceEnergies = presolvedEnergies ?? energies
    const resetState = resetBoardState(sourceLanes, sourceEnergies)
    const config: ConfigExport = {
      version: 2,
      shipId: selectedShipId,
      lanes: resetState.lanes.map((lane) => ({
        goal: lane.goal,
        cells: lane.cells.map((cell) =>
          cell
            ? {
                unitId: cell.unitId,
                level: cell.level,
                loadedEnergy: cell.loadedEnergy,
                manualPowerOverride: cell.manualPowerOverride,
                activateCount: 0,
                mods: cell.mods ?? [],
              }
            : null,
        ),
      })),
      energies: clampHandEnergies(resetState.energies),
    }
    const json = JSON.stringify(config, null, 2)
    navigator.clipboard.writeText(json).then(() => {
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 1800)
    })
  }

  function openImportDialog() {
    setImportText('')
    setImportError(null)
    setIsImportOpen(true)
  }

  function restoreConfig(config: ConfigExport) {
    if (config.version !== 1 && config.version !== 2) throw new Error('Unsupported version')
    if (!Array.isArray(config.lanes)) throw new Error('Missing lanes')
    if (!Array.isArray(config.energies)) throw new Error('Missing energies')

    let restoredLanes: Lane[]

    if (config.version === 2) {
      restoredLanes = config.lanes.map((lane) => ({
        goal: lane.goal,
        cells: lane.cells.map((cell) => {
          if (!cell) return null
          const option = unitOptions.find((o) => o.unitId === cell.unitId && o.level === cell.level)
          if (!option) return null
          return {
            unitId: option.unitId,
            level: option.level,
            name: option.name,
            skillPath: option.skillPath,
            unitType: option.unitType,
            staticPower: option.staticPower,
            overclockThresholds: option.overclockThresholds,
            maxActivations: option.maxActivations,
            slots: option.slots,
            effect: option.effect,
            args: option.args,
            loadedEnergy: cell.loadedEnergy,
            manualPowerOverride: cell.manualPowerOverride,
            activateCount: cell.activateCount ?? 0,
            mods: cell.mods ?? [],
          } satisfies LaneUnit
        }),
      }))
    } else {
      // v1: full LaneUnit — patch any missing fields added after initial release
      restoredLanes = config.lanes.map((lane) => ({
        ...lane,
        cells: lane.cells.map((cell) => {
          if (!cell) return cell
          const needsPatch = cell.overclockThresholds == null || cell.maxActivations == null || cell.mods == null
          if (!needsPatch) return cell
          const option = unitOptions.find((o) => o.unitId === cell.unitId && o.level === cell.level)
          return {
            ...cell,
            overclockThresholds: cell.overclockThresholds ?? option?.overclockThresholds ?? [],
            maxActivations: cell.maxActivations ?? option?.maxActivations ?? 0,
            activateCount: cell.activateCount ?? 0,
            mods: cell.mods ?? [],
          }
        }),
      }))
    }

    markInputChanged()
    setUndoStack([])
    setRedoStack([])
    setActivationEnergyPointsGenerated(0)
    setActivationEnergyGeneratedCount(0)
    const resetState = resetBoardState(restoredLanes, config.energies)
    setSelectedShipId(config.shipId ?? '')
    setLanes(resetState.lanes)
    setEnergies(clampHandEnergies(resetState.energies))
    setImportError(null)
  }

  function applyImport() {
    try {
      restoreConfig(JSON.parse(importText) as ConfigExport)
      setIsImportOpen(false)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Invalid JSON')
    }
  }

  function fastImportBleachingTapPair() {
    fetch('/configs/bleaching-tap-pair.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to load config: ${response.status}`)
        return response.json() as Promise<ConfigExport>
      })
      .then((config) => {
        restoreConfig(config)
        setIsImportOpen(false)
      })
      .catch((err) => {
        setImportError(err instanceof Error ? err.message : 'Unable to load config')
        setIsImportOpen(true)
      })
  }

  // ── Dialog computed values ──────────────────────────────────────────────

  const draftUnit = selectedUnitOptions.find((o) => o.key === draftUnitId)
  const draftLaneUnit: LaneUnit | null = draftUnit
    ? {
        unitId: draftUnit.unitId,
        level: draftUnit.level,
        name: draftUnit.name,
        skillPath: draftUnit.skillPath,
        unitType: draftUnit.unitType,
        staticPower: draftUnit.staticPower,
        overclockThresholds: draftUnit.overclockThresholds,
        maxActivations: draftUnit.maxActivations,
        activateCount: 0,
        slots: draftUnit.slots,
        loadedEnergy: draftLoadedEnergy,
        manualPowerOverride: draftManualOverride,
        effect: draftUnit.effect,
        args: draftUnit.args,
        mods: draftMods,
      }
    : null

  const showManualOverride =
    draftUnit &&
    (draftUnit.unitType === 'support' || !IMPLEMENTED_SKILLS.has(draftUnit.skillPath))

  return (
    <main className="app-shell">
      <AppHeader
        hasSolved={hasSolved}
        isPossible={solvedIsPossible}
        copyFeedback={copyFeedback}
        onExport={exportToClipboard}
        onImport={openImportDialog}
        onFastImport={fastImportBleachingTapPair}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        canFastImport={dataStatus === 'ready'}
        onUndo={undo}
        onRedo={redo}
        onReset={resetBoard}
      />

      <section className="ship-panel">
        <label className="ship-select">
          <span>Player ship</span>
          <select
            value={selectedShipId}
            onChange={(event) => selectShip(event.target.value)}
            disabled={dataStatus !== 'ready'}
          >
            <option value="">
              {dataStatus === 'loading'
                ? 'Loading ship data...'
                : dataStatus === 'error'
                  ? 'Could not load ship data'
                  : 'Select a player ship'}
            </option>
            {ships.map((ship) => (
              <option key={ship.id} value={ship.id}>
                {ship.name} ({ship.lanes} lanes)
              </option>
            ))}
          </select>
        </label>
        {selectedShip && <p>{selectedShip.description}</p>}
      </section>

      {selectedShip ? (
        <>
          <LaneSection
            lanes={lanes}
            laneSummaries={laneSummaries}
            currentEvaluation={currentEvaluation}
            selectedShipName={selectedShip.name}
            unitOptions={selectedUnitOptions}
            onClearCell={clearCell}
            onActivateUnit={activateUnit}
            onConfigureCell={openCellDialog}
            onMoveCell={moveCell}
            onDropEnergyToSlot={dropEnergyToSlot}
          />
          <EnergySection
            energies={energies}
            onAddEnergy={addEnergy}
            onRemoveEnergy={removeEnergy}
            onUpdateEnergy={updateEnergy}
            onDropEnergyToHand={dropEnergyToHand}
            onReorderEnergyInHand={reorderEnergyInHand}
            canAddEnergy={energies.length < maxHandEnergyCount}
          />
          <GoalsSection lanes={lanes} laneSummaries={laneSummaries} onUpdateGoal={updateGoal} />
          <SolutionPanel
            hasSolved={hasSolved}
            solvedResults={solvedResults}
            loadedSolutionIdx={loadedSolutionIdx}
            solverStrategy={solverStrategy}
            onStrategyChange={setSolverStrategy}
            onSolve={() => {
              const results = solveMultiple(lanes, laneSummaries, energies).map((result) => ({
                ...result,
                stats: {
                  ...result.stats,
                  energyPointsGenerated: result.stats.energyPointsGenerated + activationEnergyPointsGenerated,
                  energyGeneratedCount: result.stats.energyGeneratedCount + activationEnergyGeneratedCount,
                },
              }))
              const displayedFirst = sortByStrategy(results, solverStrategy)[0]
              const displayedFirstIdx = displayedFirst ? results.indexOf(displayedFirst) : 0
              setPresolvedLanes(lanes)
              setPresolvedEnergies(energies)
              setSolvedResults(results)
              setLoadedSolutionIdx(displayedFirstIdx)
              if (displayedFirst) applyActions(displayedFirst.actions)
              setHasSolved(true)
            }}
            onLoadSolution={loadSolution}
            presolvedLanes={presolvedLanes}
            presolvedEnergies={presolvedEnergies}
          />
        </>
      ) : (
        <section className="empty-state">
          <h2>Select a player ship to configure lanes</h2>
          <p>The lane table is created from the selected ship's lane count.</p>
        </section>
      )}

      {/* Unit configure dialog */}
      <Dialog open={Boolean(editingCell)} onOpenChange={(isOpen) => !isOpen && setEditingCell(null)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              saveCell()
            }}
          >
            <DialogHeader>
              <DialogTitle>Configure unit</DialogTitle>
              <DialogDescription>Choose a unit and load energy into its slots.</DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="unit">Unit</Label>
              <select
                id="unit"
                value={draftUnitId}
                onChange={(event) => handleDraftUnitChange(event.target.value)}
              >
                {selectedUnitOptions.map((unit) => (
                  <option key={unit.key} value={unit.key}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </div>

            {draftUnit?.effect && (
              <p className="text-sm text-muted-foreground italic">
                {formatEffect(draftUnit.effect, draftUnit.args, draftUnit.overclockThresholds)}
              </p>
            )}

            {draftUnit && (
              <div className="grid gap-2">
                <Label htmlFor="unit-mod">Mods</Label>
                <div className="flex items-center gap-2">
                  <select
                    id="unit-mod"
                    value={draftModToAdd}
                    onChange={(event) => setDraftModToAdd(event.target.value as UnitModId)}
                  >
                    {unitModOptions.map((mod) => (
                      <option key={mod.id} value={mod.id}>
                        {mod.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={draftMods.includes(draftModToAdd)}
                    onClick={() => setDraftMods((current) => [...current, draftModToAdd])}
                  >
                    Add
                  </Button>
                </div>
                {draftMods.length > 0 && (
                  <ul className="grid gap-1 text-sm">
                    {draftMods.map((modId) => {
                      const mod = unitModOptions.find((option) => option.id === modId)
                      return (
                        <li key={modId} className="flex items-center justify-between gap-2">
                          <span>{mod?.label ?? modId}</span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDraftMods((current) => current.filter((currentMod) => currentMod !== modId))
                            }
                          >
                            Remove
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}

            {draftUnit && draftUnit.slots.length > 0 && (
              <div className="grid gap-2">
                <Label>Energy slots</Label>
                {draftUnit.slots.map((slotColor, slotIndex) => {
                  const loaded = draftLoadedEnergy[slotIndex] ?? null
                  const matchingEnergies = energies.filter((e) => e.color === slotColor)

                  return (
                    <div key={slotIndex} className="flex items-center gap-2">
                      <span className={`slot-dot ${slotColor}`} aria-hidden="true" />
                      <span className="text-sm capitalize">{slotColor}</span>
                      <select
                        aria-label={`Slot ${slotIndex + 1} energy`}
                        value={loaded ? `${loaded.color}:${loaded.point}` : ''}
                        onChange={(event) => {
                          const val = event.target.value
                          const newLoaded = [...draftLoadedEnergy]
                          if (!val) {
                            newLoaded[slotIndex] = null
                          } else {
                            const [color, pointStr] = val.split(':')
                            newLoaded[slotIndex] = { color, point: Number(pointStr) }
                          }
                          setDraftLoadedEnergy(newLoaded)
                        }}
                      >
                        <option value="">Not loaded</option>
                        {matchingEnergies.length > 0
                          ? matchingEnergies.map((e) => (
                              <option
                                key={e.id}
                                value={`${e.color}:${e.point}`}
                              >
                                {e.color} {e.point}pt
                              </option>
                            ))
                          : energyPoints.map((pt) => (
                              <option key={pt} value={`${slotColor}:${pt}`}>
                                {slotColor} {pt}pt
                              </option>
                            ))}
                      </select>
                    </div>
                  )
                })}
              </div>
            )}

            {draftLaneUnit && draftUnit?.unitType === 'attack' && (
              <div className="text-sm font-medium">
                Computed strength:{' '}
                <strong>
                  {draftManualOverride !== null
                    ? draftManualOverride
                    : draftLoadedEnergy
                        .filter((e): e is LoadedEnergy => e !== null)
                        .reduce((acc, e) => acc + e.point, 0) + effectiveStaticPower(draftLaneUnit)}
                </strong>
                {effectiveStaticPower(draftLaneUnit) > 0 && (
                  <span className="text-muted-foreground ml-1">(+{effectiveStaticPower(draftLaneUnit)} PA)</span>
                )}
              </div>
            )}

            {showManualOverride && (
              <div className="grid gap-2">
                <Label htmlFor="manual-override">
                  Manual strength override
                  {draftUnit?.unitType === 'support' ? ' (support unit)' : ' (effect not computed)'}
                </Label>
                <Input
                  id="manual-override"
                  min="0"
                  type="number"
                  value={draftManualOverride ?? ''}
                  placeholder="0"
                  onChange={(event) => {
                    const val = event.target.value
                    setDraftManualOverride(val === '' ? null : clampNumber(Number(val)))
                  }}
                />
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditingCell(null)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {/* Import dialog */}
      <Dialog open={isImportOpen} onOpenChange={(open) => !open && setIsImportOpen(false)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              applyImport()
            }}
          >
            <DialogHeader>
              <DialogTitle>Import configuration</DialogTitle>
              <DialogDescription>
                Paste a previously exported JSON configuration below.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="import-json">JSON</Label>
              <textarea
                id="import-json"
                className="import-textarea"
                rows={10}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value)
                  setImportError(null)
                }}
                placeholder='{ "version": 1, "shipId": "...", ... }'
              />
              {importError && (
                <p className="text-sm text-destructive">{importError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsImportOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Apply</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  )
}

function createShipLanes(ship: PlayerShip, unitOptions: UnitOption[]) {
  const lanes = createEmptyLanes(ship.lanes, ship.columns)

  for (const startingUnit of ship.starting_units) {
    const laneIndex = startingUnit.lane - 1
    const cellIndex = startingUnit.column - 1

    if (
      laneIndex < 0 ||
      laneIndex >= lanes.length ||
      cellIndex < 0 ||
      cellIndex >= Math.min(ship.columns, maxLaneColumns)
    ) {
      continue
    }

    const option =
      unitOptions.find(
        (unit) => unit.unitId === startingUnit.unit_id && unit.level === startingUnit.level,
      ) ?? unitOptions.find((unit) => unit.unitId === startingUnit.unit_id)

    if (!option) continue

    lanes[laneIndex].cells[cellIndex] = {
      unitId: option.unitId,
      level: option.level,
      name: option.name,
      skillPath: option.skillPath,
      unitType: option.unitType,
      staticPower: option.staticPower,
      overclockThresholds: option.overclockThresholds,
      maxActivations: option.maxActivations,
      activateCount: 0,
      slots: option.slots,
      loadedEnergy: Array(option.slots.length).fill(null),
      manualPowerOverride: null,
      effect: option.effect,
      args: option.args,
      mods: [],
    }
  }

  return lanes
}

export default App
