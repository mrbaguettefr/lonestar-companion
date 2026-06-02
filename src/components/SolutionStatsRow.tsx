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
      <span>Energy used: {stats.energiesUsed}</span>
      <span>Energy consumed: {stats.energyConsumed} pts</span>
      <span>Strength: {stats.strengthGenerated}</span>
      <span>Surplus: +{stats.damageDealt}</span>
      <span>Generated: +{stats.energyGenerated} pts</span>
      {stats.damageReceived > 0 && (
        <span className="solution-stat--warn">
          Short: {stats.damageReceived}
        </span>
      )}
    </>
  )
}
