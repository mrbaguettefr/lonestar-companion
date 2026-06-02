import { useState } from 'react'
import { getLaneName } from '../lib/gameData'
import { computeSolutionSteps, sortByStrategy, type RankedSolution, type SolverStrategy } from '../lib/solver'
import type { Energy, Lane } from '../types/lonestar'
import { Button } from './ui/button'
import { SolutionStatsRow } from './SolutionStatsRow'

type SolutionPanelProps = {
  hasSolved: boolean
  solvedResults: RankedSolution[]
  loadedSolutionIdx: number
  solverStrategy: SolverStrategy
  presolvedLanes: Lane[] | null
  presolvedEnergies: Energy[] | null
  onStrategyChange: (s: SolverStrategy) => void
  onSolve: () => void
  onLoadSolution: (idx: number) => void
}

export function SolutionPanel({
  hasSolved,
  solvedResults,
  loadedSolutionIdx,
  solverStrategy,
  presolvedLanes,
  presolvedEnergies,
  onStrategyChange,
  onSolve,
  onLoadSolution,
}: SolutionPanelProps) {
  const [expandedIndexes, setExpandedIndexes] = useState<number[]>([])
  const [showImpossible, setShowImpossible] = useState(false)

  return (
    <section className="solution-panel">
      <div className="solution-controls">
        <select
          value={solverStrategy}
          onChange={(e) => onStrategyChange(e.target.value as SolverStrategy)}
          aria-label="Solver strategy"
        >
          <option value="best">Best overall</option>
          <option value="least-cards">Least cards used</option>
          <option value="efficiency">Maximize strength efficiency</option>
          <option value="max-damage">Maximize damage</option>
          <option value="max-energy">Maximize energy generated</option>
        </select>
        <div className="solution-buttons">
          <Button className="min-h-13 text-lg" size="lg" type="button" onClick={onSolve}>
            Solve
          </Button>
          <label className="solution-show-impossible">
            <input
              type="checkbox"
              checked={showImpossible}
              onChange={(e) => setShowImpossible(e.target.checked)}
            />
            Show unmet goals
          </label>
        </div>
      </div>

      <div className="solution-copy" aria-live="polite">
        {hasSolved && solvedResults.length > 0 ? (
          <ol className="solution-list">
            {sortByStrategy(solvedResults, solverStrategy).filter((r) => showImpossible || r.possible).map((result, displayIdx) => {
              const idx = solvedResults.indexOf(result)
              const isLoaded = idx === loadedSolutionIdx
              const isExpanded = expandedIndexes.includes(idx)
              const laneIndices = [...new Set(result.placements.map((p) => p.laneIndex))]

              const steps =
                isExpanded && presolvedLanes
                  ? computeSolutionSteps(
                      presolvedLanes,
                      result.actions,
                      result.totalEnergyUsedCount + result.spareEnergyCount,
                      presolvedEnergies ?? [],
                    )
                  : null

              return (
                <li key={idx} className={`solution-item${isLoaded ? ' solution-item--loaded' : ''}`}>
                  <div className="solution-item-header">
                    <span className="solution-item-title">
                      #{displayIdx + 1}
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
                        onClick={() =>
                          setExpandedIndexes((current) =>
                            isExpanded ? current.filter((openIdx) => openIdx !== idx) : [...current, idx],
                          )
                        }
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
                    <SolutionStatsRow
                      stats={result.stats}
                      solution={solverStrategy === 'best' ? result : undefined}
                    />
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
                          {step.kind === 'activation' ? (
                            <>
                              <div className="step-action">
                                ✨ Activate <strong>{step.unitName}</strong>{' '}
                                ({getLaneName(step.laneIndex)})
                              </div>
                              <div className="step-generated">
                                Hand: [{step.handBefore.map((e) => `${e.point}pt ${e.color}`).join(', ')}]{' '}
                                → [{step.handAfter.map((e) => `${e.point}pt ${e.color}`).join(', ')}]
                              </div>
                            </>
                          ) : (
                            <>
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
                            </>
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
            Press Solve to place available energy toward the lane goals.
          </p>
        )}
      </div>
    </section>
  )
}
