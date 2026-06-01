import { getLaneName } from '../lib/gameData'
import type { OptimalSolution } from '../lib/solver'
import { Button } from './ui/button'

type SolutionPanelProps = {
  hasSolved: boolean
  solvedResult: OptimalSolution | null
  isPossible: boolean
  onSolve: () => void
}

export function SolutionPanel({ hasSolved, solvedResult, isPossible, onSolve }: SolutionPanelProps) {
  return (
    <section className="solution-panel">
      <Button className="min-h-13 text-lg" size="lg" type="button" onClick={onSolve}>
        Solve
      </Button>
      <div className="solution-copy" aria-live="polite">
        {hasSolved && solvedResult ? (
          <>
            <h2>{solvedResult.possible ? 'Goals met' : 'Goal not fully reachable'}</h2>
            <p>
              {solvedResult.totalEnergyUsed > 0
                ? `${solvedResult.totalEnergyUsed} energy card${solvedResult.totalEnergyUsed !== 1 ? 's' : ''} placed.`
                : 'No extra energy was needed.'}
              {solvedResult.spareEnergy > 0 &&
                ` ${solvedResult.spareEnergy} card${solvedResult.spareEnergy !== 1 ? 's' : ''} remaining in hand.`}
            </p>
            {solvedResult.placements.length > 0 && (
              <ul>
                {[...new Set(solvedResult.placements.map((p) => p.laneIndex))].map((li) => {
                  const lp = solvedResult.placements.filter((p) => p.laneIndex === li)
                  return (
                    <li key={li}>
                      <strong>{getLaneName(li)}:</strong>{' '}
                      {lp.map((p) => `${p.point}pt ${p.color}`).join(', ')}
                    </li>
                  )
                })}
              </ul>
            )}
            {!solvedResult.possible && (
              <p className="warning">
                Still {solvedResult.remainingDeficit} strength short — not enough compatible energy in
                hand.
              </p>
            )}
          </>
        ) : (
          <p className="placeholder">
            {isPossible
              ? 'Press Solve to automatically load the minimum energy needed to reach all goals.'
              : 'Press Solve to place what energy is available (goals may not all be met).'}
          </p>
        )}
      </div>
    </section>
  )
}
