import { getLaneName } from '../lib/gameData'
import type { RankedSolution, SolverStrategy } from '../lib/solver'
import { Button } from './ui/button'

type SolutionPanelProps = {
  hasSolved: boolean
  solvedResults: RankedSolution[]
  loadedSolutionIdx: number
  isPossible: boolean
  solverStrategy: SolverStrategy
  onStrategyChange: (s: SolverStrategy) => void
  onSolve: () => void
  onClear: () => void
  onLoadSolution: (idx: number) => void
}

export function SolutionPanel({
  hasSolved,
  solvedResults,
  loadedSolutionIdx,
  isPossible,
  solverStrategy,
  onStrategyChange,
  onSolve,
  onClear,
  onLoadSolution,
}: SolutionPanelProps) {
  return (
    <section className="solution-panel">
      <div className="solution-controls">
        <select
          value={solverStrategy}
          onChange={(e) => onStrategyChange(e.target.value as SolverStrategy)}
          aria-label="Solver strategy"
        >
          <option value="least-cards">Least cards used</option>
          <option value="efficiency">Maximize strength efficiency</option>
          <option value="max-damage">Maximize damage</option>
        </select>
        <div className="solution-buttons">
          <Button className="min-h-13 text-lg" size="lg" type="button" onClick={onSolve}>
            Solve
          </Button>
          <Button type="button" variant="outline" onClick={onClear}>
            Clear energies
          </Button>
        </div>
      </div>
      <div className="solution-copy" aria-live="polite">
        {hasSolved && solvedResults.length > 0 ? (
          <ol className="solution-list">
            {solvedResults.map((result, idx) => {
              const isLoaded = idx === loadedSolutionIdx
              const laneIndices = [...new Set(result.placements.map((p) => p.laneIndex))]
              return (
                <li key={idx} className={`solution-item${isLoaded ? ' solution-item--loaded' : ''}`}>
                  <div className="solution-item-header">
                    <span className="solution-item-title">
                      Solution {idx + 1}
                      {result.possible ? (
                        <span className="solution-badge solution-badge--ok">Goals met</span>
                      ) : (
                        <span className="solution-badge solution-badge--warn">Goals not met</span>
                      )}
                    </span>
                    {isLoaded ? (
                      <span className="solution-loaded-badge">Loaded</span>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onLoadSolution(idx)}
                      >
                        Load
                      </Button>
                    )}
                  </div>
                  <div className="solution-stats">
                    <span>Cards: {result.stats.energiesUsed}</span>
                    <span>Strength: {result.stats.strengthGenerated}</span>
                    <span>Dealt: {result.stats.damageDealt}</span>
                    {result.stats.damageReceived > 0 && (
                      <span className="solution-stat--warn">
                        Received: {result.stats.damageReceived}
                      </span>
                    )}
                    <span>
                      Ratio:{' '}
                      {result.stats.strengthGenerated > 0
                        ? result.stats.efficiencyRatio.toFixed(2)
                        : '—'}
                    </span>
                  </div>
                  {laneIndices.length > 0 && (
                    <ul className="solution-placements">
                      {laneIndices.map((li) => {
                        const lp = result.placements.filter((p) => p.laneIndex === li)
                        return (
                          <li key={li}>
                            <strong>{getLaneName(li)}:</strong>{' '}
                            {lp.map((p) => `${p.point}pt ${p.color}`).join(', ')}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  {!result.possible && (
                    <p className="warning">
                      Still {result.remainingDeficit} strength short — not enough compatible energy
                      in hand.
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
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
