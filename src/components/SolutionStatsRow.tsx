import { solutionScore, type RankedSolution, type SolutionStats } from '../lib/solver'

type SolutionStatsRowProps = {
  stats: SolutionStats
  /** If provided, show a Score chip using the full RankedSolution. */
  solution?: RankedSolution
  /** Optional leading label chip (e.g. "Current"). */
  label?: string
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function formatNumber(value: number): string {
  return value.toFixed(1)
}

function netStatClass(value: number): string | undefined {
  if (value > 0) return 'solution-stat--positive'
  if (value < 0) return 'solution-stat--negative'
  return undefined
}

export function SolutionStatsRow({ stats, solution, label }: SolutionStatsRowProps) {
  const energyNet = stats.energyGeneratedCount - stats.energyUsedCount
  const energyPointNet = stats.energyPointsGenerated - stats.energyPointsUsed
  const averageHandValue =
    stats.handEnergyCount > 0 ? stats.handEnergyPointTotal / stats.handEnergyCount : 0

  return (
    <>
      {label && <span>{label}</span>}
      {solution && <span>Score: {solutionScore(solution).toFixed(1)}</span>}
      <span
        className={netStatClass(energyNet)}
        title={`Generated: ${stats.energyGeneratedCount}; Used: ${stats.energyUsedCount}`}
      >
        Energy: {formatSigned(energyNet)}
      </span>
      <span
        className={netStatClass(energyPointNet)}
        title={`Generated: ${stats.energyPointsGenerated} pts; Used: ${stats.energyPointsUsed} pts`}
      >
        Energy pts: {formatSigned(energyPointNet)}
      </span>
      <span>Steps: {stats.stepCount}</span>
      <span title={`Hand total: ${stats.handEnergyPointTotal} pts; Energy in hand: ${stats.handEnergyCount}`}>
        Avg hand: {formatNumber(averageHandValue)}
      </span>
      <span>Hand pts: {stats.handEnergyPointTotal}</span>
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
