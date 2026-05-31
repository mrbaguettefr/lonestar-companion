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
  createEmptyLanes,
  energyColors,
  energyPoints,
  extractStaticPower,
  initialEnergies,
  initialLanes,
  maxLaneColumns,
} from './lib/gameData'
import { clampNumber } from './lib/numbers'
import { buildBattleContext, solveLaneAssignments, summarizeLanes } from './lib/solver'
import { IMPLEMENTED_SKILLS, formatEffect } from './lib/effects'
import type {
  Energy,
  Lane,
  LaneUnit,
  LoadedEnergy,
  LonestarData,
  PlayerShip,
  UnitOption,
} from './types/lonestar'

type EditingCell = {
  laneIndex: number
  cellIndex: number
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
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const battleContext = useMemo(
    () => buildBattleContext(energies),
    [energies],
  )
  const laneSummaries = useMemo(() => summarizeLanes(lanes, battleContext), [lanes, battleContext])
  const solution = useMemo(
    () => solveLaneAssignments(energies, laneSummaries),
    [energies, laneSummaries],
  )
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
        if (!response.ok) {
          throw new Error(`Unable to load lonestar_data.json: ${response.status}`)
        }

        return response.json() as Promise<LonestarData>
      })
      .then((data) => {
        if (!isMounted) {
          return
        }

        setShips(data.ships.players)
        setUnitOptions(
          data.units
            .flatMap((unit) =>
              unit.levels
                .sort((first, second) => first.level - second.level)
                .map((level) => ({
                  key: `${unit.id}:${level.level}`,
                  unitId: unit.id,
                  level: level.level,
                  name: level.name,
                  slots: level.slots,
                  skillPath: unit.skill_path,
                  unitType: unit.type,
                  staticPower: extractStaticPower(level.raw?.properties ?? ''),
                  effect: level.effect,
                  args: level.args,
                  shipKeys: unit.ships
                    .filter((ship) => ship.kind === 'player')
                    .map((ship) => ship.ship),
                })),
            )
            .filter((unit) => unit.shipKeys.length > 0)
            .sort((first, second) => {
              const nameCompare = first.name.localeCompare(second.name)

              return nameCompare === 0 ? first.unitId - second.unitId : nameCompare
            }),
        )
        setDataStatus('ready')
      })
      .catch(() => {
        if (isMounted) {
          setDataStatus('error')
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  function markInputChanged() {
    setHasSolved(false)
  }

  function selectShip(shipId: string) {
    markInputChanged()
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
    } else {
      const unit = selectedUnitOptions.find((o) => o.key === defaultUnitKey)
      setDraftLoadedEnergy(Array(unit?.slots.length ?? 0).fill(null))
      setDraftManualOverride(null)
    }
  }

  function handleDraftUnitChange(newKey: string) {
    setDraftUnitId(newKey)
    const unit = selectedUnitOptions.find((o) => o.key === newKey)
    setDraftLoadedEnergy(Array(unit?.slots.length ?? 0).fill(null))
    setDraftManualOverride(null)
  }

  function saveCell() {
    if (!editingCell) {
      return
    }

    const unit = selectedUnitOptions.find((option) => option.key === draftUnitId)
    if (!unit) {
      return
    }

    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
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
                      slots: unit.slots,
                      loadedEnergy: draftLoadedEnergy,
                      manualPowerOverride: draftManualOverride,
                      effect: unit.effect,
                      args: unit.args,
                    } satisfies LaneUnit)
                  : cell,
              ),
            }
          : lane,
      ),
    )
    setEditingCell(null)
  }

  function clearCell(laneIndex: number, cellIndex: number) {
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex
          ? {
              ...lane,
              cells: lane.cells.map((cell, innerIndex) =>
                innerIndex === cellIndex ? null : cell,
              ),
            }
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
    if (fromLaneIndex === toLaneIndex && fromCellIndex === toCellIndex) {
      return
    }

    markInputChanged()
    setLanes((current) => {
      const next = current.map((lane) => ({
        ...lane,
        cells: [...lane.cells],
      }))

      if (!next[fromLaneIndex]?.cells[fromCellIndex] || !next[toLaneIndex]?.cells) {
        return current
      }

      if (toCellIndex < 0 || toCellIndex >= next[toLaneIndex].cells.length) {
        return current
      }

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

  function addEnergy() {
    markInputChanged()
    setEnergies((current) => [
      ...current,
      { id: Date.now(), color: energyColors[0], count: 1, point: 3 },
    ])
  }

  function updateEnergy(id: number, patch: Partial<Energy>) {
    markInputChanged()
    setEnergies((current) =>
      current.map((energy) => (energy.id === id ? { ...energy, ...patch } : energy)),
    )
  }

  function removeEnergy(id: number) {
    markInputChanged()
    setEnergies((current) => current.filter((energy) => energy.id !== id))
  }

  // Computed preview for the dialog
  const draftUnit = selectedUnitOptions.find((o) => o.key === draftUnitId)
  const draftLaneUnit: LaneUnit | null = draftUnit
    ? {
        unitId: draftUnit.unitId,
        level: draftUnit.level,
        name: draftUnit.name,
        skillPath: draftUnit.skillPath,
        unitType: draftUnit.unitType,
        staticPower: draftUnit.staticPower,
        slots: draftUnit.slots,
        loadedEnergy: draftLoadedEnergy,
        manualPowerOverride: draftManualOverride,
        effect: draftUnit.effect,
        args: draftUnit.args,
      }
    : null

  const showManualOverride =
    draftUnit &&
    (draftUnit.unitType === 'support' || !IMPLEMENTED_SKILLS.has(draftUnit.skillPath))

  return (
    <main className="app-shell">
      <AppHeader hasSolved={hasSolved} isPossible={solution.possible} />
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
            selectedShipName={selectedShip.name}
            unitOptions={selectedUnitOptions}
            onClearCell={clearCell}
            onConfigureCell={openCellDialog}
            onMoveCell={moveCell}
          />
          <EnergySection
            energies={energies}
            onAddEnergy={addEnergy}
            onRemoveEnergy={removeEnergy}
            onUpdateEnergy={updateEnergy}
          />
          <GoalsSection lanes={lanes} laneSummaries={laneSummaries} onUpdateGoal={updateGoal} />
          <SolutionPanel
            hasSolved={hasSolved}
            solution={solution}
            onSolve={() => setHasSolved(true)}
          />
        </>
      ) : (
        <section className="empty-state">
          <h2>Select a player ship to configure lanes</h2>
          <p>The lane table is created from the selected ship's lane count.</p>
        </section>
      )}

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
              <DialogDescription>
                Choose a unit and load energy into its slots.
              </DialogDescription>
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
                {formatEffect(draftUnit.effect, draftUnit.args)}
              </p>
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
                              <option key={`${e.color}:${e.point}`} value={`${e.color}:${e.point}`}>
                                {e.color} {e.point}pt (×{e.count} in hand)
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
                  {(() => {
                    if (draftManualOverride !== null) return draftManualOverride
                    // Quick preview without full lane context
                    const loaded = draftLoadedEnergy.filter((e): e is LoadedEnergy => e !== null)
                    const base = loaded.reduce((acc, e) => acc + e.point, 0) + draftLaneUnit.staticPower
                    return base
                  })()}
                </strong>
                {draftUnit.staticPower > 0 && (
                  <span className="text-muted-foreground ml-1">(+{draftUnit.staticPower} PA)</span>
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
      ) ??
      unitOptions.find((unit) => unit.unitId === startingUnit.unit_id)

    if (!option) {
      continue
    }

    lanes[laneIndex].cells[cellIndex] = {
      unitId: option.unitId,
      level: option.level,
      name: option.name,
      skillPath: option.skillPath,
      unitType: option.unitType,
      staticPower: option.staticPower,
      slots: option.slots,
      loadedEnergy: Array(option.slots.length).fill(null),
      manualPowerOverride: null,
      effect: option.effect,
      args: option.args,
    }
  }

  return lanes
}

export default App
