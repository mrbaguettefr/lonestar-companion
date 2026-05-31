import { laneNames } from '../lib/gameData'
import { sum } from '../lib/numbers'
import type { solveLaneAssignments } from '../lib/solver'

type Solution = ReturnType<typeof solveLaneAssignments>

type SolutionPanelProps = {
  hasSolved: boolean
  solution: Solution
  onSolve: () => void
}

export function SolutionPanel({ hasSolved, solution, onSolve }: SolutionPanelProps) {
  return (
    <section className="solution-panel">
      <button className="solve-button" type="button" onClick={onSolve}>
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
                Still missing {sum(solution.remainingByLane)} strength after all energy is assigned.
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
  )
}

