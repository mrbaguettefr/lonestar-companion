import { solutionScore, type RankedSolution, type SolutionStats } from '../lib/solver'

type SolutionStatsRowProps = {
  stats: SolutionStats
  /** If provided, show a Score chip using the full RankedSolution. */
  solution?: RankedSolution
  /** Optional leading label chip (e.g. "Current"). */
  label?: string
}

export function SolutionStatsRow({ stats, solution, label }: SolutionStatsRowProps) {
  return (
    <>
      {label && <span>{label}</span>}
      {solution && <span>Score: {solutionScore(solution).toFixed(1)}</span>}
      <span>Energy: {stats.energiesUsed}/{stats.energiesGenerated}</span>
      <span>Energy pts: {stats.energyConsumed}/{stats.energyGenerated}</span>
      <span>Steps: {stats.stepCount}</span>
      <span>Strength: {stats.strengthGenerated}</span>
      <span>Surplus: +{stats.damageDealt}</span>
      {stats.damageReceived > 0 && (
        <span className="solution-stat--warn">
          Short: {stats.damageReceived}
        </span>
      )}
    </>
  )
}
