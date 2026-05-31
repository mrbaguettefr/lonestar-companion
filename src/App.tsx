import { useMemo, useState } from 'react'
import './App.css'

type Lane = {
  units: number[]
  goal: number
}

type Energy = {
  id: number
  color: string
  count: number
}

type Assignment = {
  laneIndex: number
  color: string
  count: number
}

const laneNames = ['Top lane', 'Middle lane', 'Bottom lane']
const energyColors = ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'White']

const initialLanes: Lane[] = [
  { units: [3, 2], goal: 8 },
  { units: [4], goal: 7 },
  { units: [2, 1], goal: 5 },
]

const initialEnergies: Energy[] = [
  { id: 1, color: 'Red', count: 2 },
  { id: 2, color: 'Blue', count: 2 },
  { id: 3, color: 'Yellow', count: 1 },
]

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

function clampNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function App() {
  const [lanes, setLanes] = useState<Lane[]>(initialLanes)
  const [energies, setEnergies] = useState<Energy[]>(initialEnergies)
  const [hasSolved, setHasSolved] = useState(false)

  const laneSummaries = useMemo(
    () =>
      lanes.map((lane) => {
        const strength = sum(lane.units)
        return {
          strength,
          deficit: Math.max(0, lane.goal - strength),
          surplus: Math.max(0, strength - lane.goal),
        }
      }),
    [lanes],
  )

  const solution = useMemo(() => {
    const totalEnergy = sum(energies.map((energy) => energy.count))
    const totalNeeded = sum(laneSummaries.map((lane) => lane.deficit))
    const assignments: Assignment[] = []
    const remainingByLane = laneSummaries.map((lane) => lane.deficit)

    for (const energy of energies) {
      let available = energy.count

      for (let laneIndex = 0; laneIndex < remainingByLane.length; laneIndex += 1) {
        if (available === 0) {
          break
        }

        const used = Math.min(available, remainingByLane[laneIndex])
        if (used > 0) {
          assignments.push({ laneIndex, color: energy.color, count: used })
          available -= used
          remainingByLane[laneIndex] -= used
        }
      }
    }

    return {
      assignments,
      possible: totalEnergy >= totalNeeded,
      remainingByLane,
      spareEnergy: Math.max(0, totalEnergy - totalNeeded),
      totalEnergy,
      totalNeeded,
    }
  }, [energies, laneSummaries])

  function updateUnit(laneIndex: number, unitIndex: number, value: number) {
    setHasSolved(false)
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
    setHasSolved(false)
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex ? { ...lane, units: [...lane.units, 1] } : lane,
      ),
    )
  }

  function removeUnit(laneIndex: number, unitIndex: number) {
    setHasSolved(false)
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex
          ? { ...lane, units: lane.units.filter((_, innerIndex) => innerIndex !== unitIndex) }
          : lane,
      ),
    )
  }

  function updateGoal(laneIndex: number, value: number) {
    setHasSolved(false)
    setLanes((current) =>
      current.map((lane, index) =>
        index === laneIndex ? { ...lane, goal: clampNumber(value) } : lane,
      ),
    )
  }

  function addEnergy() {
    setHasSolved(false)
    setEnergies((current) => [
      ...current,
      { id: Date.now(), color: energyColors[0], count: 1 },
    ])
  }

  function updateEnergy(id: number, patch: Partial<Energy>) {
    setHasSolved(false)
    setEnergies((current) =>
      current.map((energy) => (energy.id === id ? { ...energy, ...patch } : energy)),
    )
  }

  function removeEnergy(id: number) {
    setHasSolved(false)
    setEnergies((current) => current.filter((energy) => energy.id !== id))
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Lonestar Companion</p>
          <h1>Lane strength solver</h1>
        </div>
        <div
          className={
            hasSolved ? (solution.possible ? 'status ready' : 'status blocked') : 'status idle'
          }
        >
          {hasSolved ? (solution.possible ? 'Possible' : 'Not enough energy') : 'Ready to solve'}
        </div>
      </header>

      <section className="panel">
        <div className="section-heading">
          <h2>Attack units</h2>
          <p>Set the attack power currently present in each lane.</p>
        </div>
        <div className="lane-grid">
          {lanes.map((lane, laneIndex) => (
            <article className="lane-card" key={laneNames[laneIndex]}>
              <div className="lane-header">
                <h3>{laneNames[laneIndex]}</h3>
                <strong>{laneSummaries[laneIndex].strength}</strong>
              </div>
              <div className="unit-list">
                {lane.units.map((unit, unitIndex) => (
                  <label className="unit-row" key={`${laneIndex}-${unitIndex}`}>
                    <span>Unit {unitIndex + 1}</span>
                    <input
                      min="0"
                      type="number"
                      value={unit}
                      onChange={(event) =>
                        updateUnit(laneIndex, unitIndex, Number(event.target.value))
                      }
                    />
                    <button
                      aria-label={`Remove unit ${unitIndex + 1} from ${laneNames[laneIndex]}`}
                      className="icon-button"
                      type="button"
                      onClick={() => removeUnit(laneIndex, unitIndex)}
                    >
                      -
                    </button>
                  </label>
                ))}
              </div>
              <button className="secondary-button" type="button" onClick={() => addUnit(laneIndex)}>
                Add unit
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Energies in hand</h2>
          <p>Enter each energy group by color and amount.</p>
        </div>
        <div className="energy-list">
          {energies.map((energy) => (
            <div className="energy-row" key={energy.id}>
              <select
                aria-label="Energy color"
                value={energy.color}
                onChange={(event) => updateEnergy(energy.id, { color: event.target.value })}
              >
                {energyColors.map((color) => (
                  <option key={color}>{color}</option>
                ))}
              </select>
              <input
                aria-label={`${energy.color} energy count`}
                min="0"
                type="number"
                value={energy.count}
                onChange={(event) =>
                  updateEnergy(energy.id, { count: clampNumber(Number(event.target.value)) })
                }
              />
              <span className={`swatch ${energy.color.toLowerCase()}`} aria-hidden="true" />
              <button
                aria-label={`Remove ${energy.color} energy`}
                className="icon-button"
                type="button"
                onClick={() => removeEnergy(energy.id)}
              >
                -
              </button>
            </div>
          ))}
        </div>
        <button className="secondary-button" type="button" onClick={addEnergy}>
          Add energy
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <h2>Goals</h2>
          <p>Set the strength target to reach in each lane.</p>
        </div>
        <div className="goal-grid">
          {lanes.map((lane, laneIndex) => (
            <label className="goal-row" key={laneNames[laneIndex]}>
              <span>{laneNames[laneIndex]}</span>
              <input
                min="0"
                type="number"
                value={lane.goal}
                onChange={(event) => updateGoal(laneIndex, Number(event.target.value))}
              />
              <small>
                {laneSummaries[laneIndex].deficit > 0
                  ? `Needs ${laneSummaries[laneIndex].deficit}`
                  : `Ahead by ${laneSummaries[laneIndex].surplus}`}
              </small>
            </label>
          ))}
        </div>
      </section>

      <section className="solution-panel">
        <button className="solve-button" type="button" onClick={() => setHasSolved(true)}>
          Solve
        </button>
        <div className="solution-copy" aria-live="polite">
          {hasSolved ? (
            <>
              <h2>{solution.possible ? 'Plan to reach the goals' : 'Goal is not reachable'}</h2>
              <p>
                Current lanes need {solution.totalNeeded} total strength. Your hand has{' '}
                {solution.totalEnergy} energy.
              </p>
              {solution.assignments.length > 0 ? (
                <ul>
                  {solution.assignments.map((assignment, index) => (
                    <li key={`${assignment.laneIndex}-${assignment.color}-${index}`}>
                      Put {assignment.count} {assignment.color.toLowerCase()} energy into{' '}
                      {laneNames[assignment.laneIndex].toLowerCase()}.
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No extra energy is required with the current attack units.</p>
              )}
              {!solution.possible && (
                <p className="warning">
                  Still missing {sum(solution.remainingByLane)} strength after all energy is
                  assigned.
                </p>
              )}
              {solution.possible && solution.spareEnergy > 0 && (
                <p className="success">You will have {solution.spareEnergy} energy left over.</p>
              )}
            </>
          ) : (
            <p className="placeholder">
              Press Solve to compare the lane goals against your current attack strength and energy
              hand.
            </p>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
