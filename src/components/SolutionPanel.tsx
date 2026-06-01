import { useState } from 'react'
import { getLaneName } from '../lib/gameData'
import { computeSolutionSteps, type RankedSolution, type SolverStrategy } from '../lib/solver'
import type { Lane } from '../types/lonestar'
import { Button } from './ui/button'

type SolutionPanelProps = {
  hasSolved: boolean
  solvedResults: RankedSolution[]
  loadedSolutionIdx: number
  isPossible: boolean
  solverStrategy: SolverStrategy
  presolvedLanes: Lane[] | null
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
  presolvedLanes,
  onStrategyChange,
  onSolve,
  onClear,
  onLoadSolution,
}: SolutionPanelProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

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
              const isExpanded = expandedIdx === idx
              const laneIndices = [...new Set(result.placements.map((p) => p.laneIndex))]

              const steps =
                isExpanded && presolvedLanes
                  ? computeSolutionSteps(presolvedLanes, result.placements, result.totalEnergyUsed + result.spareEnergy)
                  : null

              return (
                <li key={idx} className={`solution-item${isLoaded ? ' solution-item--loaded' : ''}`}>
                  <div className="solution-item-header">
                    <span className="solution-item-title">
                      #{idx + 1}
                      {result.possible ? (
                        <span className="solution-badge solution-badge--ok">Goals met</span>
                      ) : (
                        <span className="solution-badge solution-badge--warn">Goals not met</span>
                      )}
                    </span>
                    <div className="solution-item-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                      >
                        {isExpanded ? 'Hide steps' : 'Show steps'}
                      </Button>
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
                  </div>

                  <div className="solution-stats">
                    <span>Cards: {result.stats.energiesUsed}</span>
                    <span>Strength: {result.stats.strengthGenerated}</span>
                    <span>Surplus: +{result.stats.damageDealt}</span>
                    {result.stats.damageReceived > 0 && (
                      <span className="solution-stat--warn">
                        Short: {result.stats.damageReceived}
                      </span>
                    )}
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
                      Still {result.remainingDeficit} strength short.
                    </p>
                  )}

                  {isExpanded && steps && (
                    <ol className="solution-steps">
                      {steps.map((step, si) => (
                        <li key={si} className="solution-step">
                          <div className="step-action">
                            {step.unitType === 'support' ? '⚙' : '⚔'}{' '}
                            Load <strong>{step.placement.point}pt {step.placement.color}</strong> into{' '}
                            <strong>{step.unitName}</strong>
                            {' '}({getLaneName(step.placement.laneIndex)}, {step.slotColor} slot)
                          </div>
                          {step.generatedEnergies.length > 0 && (
                            <div className="step-generated">
                              → Generates:{' '}
                              {step.generatedEnergies.map((g) => `${g.point}pt ${g.color}`).join(', ')}
                            </div>
                          )}
                          {step.unitType === 'attack' && step.effectLabel && (
                            <div className="step-effect">→ {step.effectLabel}</div>
                          )}
                          {step.unitType === 'attack' && step.laneGoal > 0 && (
                            <div className={`step-strength${step.laneStrengthAfter >= step.laneGoal ? ' step-strength--met' : ''}`}>
                              {getLaneName(step.placement.laneIndex)}: {step.laneStrengthAfter}/{step.laneGoal}
                              {step.laneStrengthAfter >= step.laneGoal ? ' ✓' : ''}
                            </div>
                          )}
                        </li>
                      ))}
                      {steps.length === 0 && (
                        <li className="step-action">No energy placements needed.</li>
                      )}
                    </ol>
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
