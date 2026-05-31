import { laneNames } from '../lib/gameData'
import type { Lane, LaneSummary } from '../types/lonestar'

type LaneSectionProps = {
  lanes: Lane[]
  laneSummaries: LaneSummary[]
  onAddUnit: (laneIndex: number) => void
  onRemoveUnit: (laneIndex: number, unitIndex: number) => void
  onUpdateUnit: (laneIndex: number, unitIndex: number, value: number) => void
}

export function LaneSection({
  lanes,
  laneSummaries,
  onAddUnit,
  onRemoveUnit,
  onUpdateUnit,
}: LaneSectionProps) {
  return (
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
                      onUpdateUnit(laneIndex, unitIndex, Number(event.target.value))
                    }
                  />
                  <button
                    aria-label={`Remove unit ${unitIndex + 1} from ${laneNames[laneIndex]}`}
                    className="icon-button"
                    type="button"
                    onClick={() => onRemoveUnit(laneIndex, unitIndex)}
                  >
                    -
                  </button>
                </label>
              ))}
            </div>
            <button className="secondary-button" type="button" onClick={() => onAddUnit(laneIndex)}>
              Add unit
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

