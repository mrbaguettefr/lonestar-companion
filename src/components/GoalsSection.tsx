import { getLaneName } from '../lib/gameData'
import type { Lane, LaneSummary } from '../types/lonestar'

type GoalsSectionProps = {
  lanes: Lane[]
  laneSummaries: LaneSummary[]
  onUpdateGoal: (laneIndex: number, value: number) => void
}

export function GoalsSection({ lanes, laneSummaries, onUpdateGoal }: GoalsSectionProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Goals</h2>
        <p>Set the strength target to reach in each lane.</p>
      </div>
      <div className="goal-grid">
        {lanes.map((lane, laneIndex) => (
          <label className="goal-row" key={getLaneName(laneIndex)}>
            <span>{getLaneName(laneIndex)}</span>
            <input
              min="0"
              type="number"
              value={lane.goal}
              onChange={(event) => onUpdateGoal(laneIndex, Number(event.target.value))}
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
  )
}
