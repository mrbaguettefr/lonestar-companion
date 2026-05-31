import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { EnergySection } from './components/EnergySection'
import { GoalsSection } from './components/GoalsSection'
import { LaneSection } from './components/LaneSection'
import { SolutionPanel } from './components/SolutionPanel'
import { createEmptyLanes, energyColors, initialEnergies, initialLanes } from './lib/gameData'
import { clampNumber } from './lib/numbers'
import { solveLaneAssignments, summarizeLanes } from './lib/solver'
import type { Energy, Lane, LaneUnit, LonestarData, PlayerShip, UnitOption } from './types/lonestar'

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
  const [draftPower, setDraftPower] = useState(0)
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  const laneSummaries = useMemo(() => summarizeLanes(lanes), [lanes])
  const solution = useMemo(
    () => solveLaneAssignments(energies, laneSummaries),
    [energies, laneSummaries],
  )
  const selectedShip = useMemo(
    () => ships.find((ship) => String(ship.id) === selectedShipId) ?? null,
    [selectedShipId, ships],
  )

  useEffect(() => {
    let isMounted = true

    fetch('/lonestar_data2.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load lonestar_data2.json: ${response.status}`)
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
            .map((unit) => ({ id: unit.id, name: unit.base_name }))
            .sort((first, second) => first.name.localeCompare(second.name)),
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
    setLanes(ship ? createEmptyLanes(ship.lanes, ship.columns) : initialLanes)
  }

  function openCellDialog(laneIndex: number, cellIndex: number) {
    const existing = lanes[laneIndex]?.cells[cellIndex] ?? null
    setEditingCell({ laneIndex, cellIndex })
    setDraftUnitId(existing ? String(existing.unitId) : String(unitOptions[0]?.id ?? ''))
    setDraftPower(existing?.power ?? 0)
  }

  function saveCell() {
    if (!editingCell) {
      return
    }

    const unit = unitOptions.find((option) => String(option.id) === draftUnitId)
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
                      unitId: unit.id,
                      name: unit.name,
                      power: clampNumber(draftPower),
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
      { id: Date.now(), color: energyColors[0], count: 1 },
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
            unitOptions={unitOptions}
            onClearCell={clearCell}
            onConfigureCell={openCellDialog}
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

      {editingCell && (
        <div className="modal-backdrop" role="presentation">
          <form
            className="unit-dialog"
            onSubmit={(event) => {
              event.preventDefault()
              saveCell()
            }}
          >
            <div className="section-heading">
              <h2>Configure unit</h2>
              <p>Choose a unit and enter the power applied in this lane cell.</p>
            </div>
            <label>
              <span>Unit</span>
              <select value={draftUnitId} onChange={(event) => setDraftUnitId(event.target.value)}>
                {unitOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Applied power</span>
              <input
                min="0"
                type="number"
                value={draftPower}
                onChange={(event) => setDraftPower(clampNumber(Number(event.target.value)))}
              />
            </label>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingCell(null)}>
                Cancel
              </button>
              <button className="solve-button compact" type="submit">
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}

export default App
