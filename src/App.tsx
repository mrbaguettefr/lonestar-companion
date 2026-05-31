import { useMemo, useState } from 'react'
import './App.css'
import { AppHeader } from './components/AppHeader'
import { EnergySection } from './components/EnergySection'
import { GoalsSection } from './components/GoalsSection'
import { LaneSection } from './components/LaneSection'
import { SolutionPanel } from './components/SolutionPanel'
import { energyColors, initialEnergies, initialLanes } from './lib/gameData'
import { clampNumber } from './lib/numbers'
import { solveLaneAssignments, summarizeLanes } from './lib/solver'
import type { Energy, Lane } from './types/lonestar'

function App() {
  const [lanes, setLanes] = useState<Lane[]>(initialLanes)
  const [energies, setEnergies] = useState<Energy[]>(initialEnergies)
  const [hasSolved, setHasSolved] = useState(false)

  const laneSummaries = useMemo(() => summarizeLanes(lanes), [lanes])
  const solution = useMemo(
    () => solveLaneAssignments(energies, laneSummaries),
    [energies, laneSummaries],
  )

  function markInputChanged() {
    setHasSolved(false)
  }

  function updateUnit(laneIndex: number, unitIndex: number, value: number) {
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex
          ? {
              ...lane,
              units: lane.units.map((unit, innerIndex) =>
                innerIndex === unitIndex ? clampNumber(value) : unit,
              ),
            }
          : lane,
      ),
    )
  }

  function addUnit(laneIndex: number) {
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex ? { ...lane, units: [...lane.units, 1] } : lane,
      ),
    )
  }

  function removeUnit(laneIndex: number, unitIndex: number) {
    markInputChanged()
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex
          ? { ...lane, units: lane.units.filter((_, innerIndex) => innerIndex !== unitIndex) }
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
      <LaneSection
        lanes={lanes}
        laneSummaries={laneSummaries}
        onAddUnit={addUnit}
        onRemoveUnit={removeUnit}
        onUpdateUnit={updateUnit}
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
    </main>
  )
}

export default App
