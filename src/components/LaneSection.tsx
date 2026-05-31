import { getLaneName } from '../lib/gameData'
import type { Lane, LaneSummary, UnitOption } from '../types/lonestar'

type LaneSectionProps = {
  lanes: Lane[]
  laneSummaries: LaneSummary[]
  selectedShipName: string
  unitOptions: UnitOption[]
  onClearCell: (laneIndex: number, cellIndex: number) => void
  onConfigureCell: (laneIndex: number, cellIndex: number) => void
}

export function LaneSection({
  lanes,
  laneSummaries,
  selectedShipName,
  unitOptions,
  onClearCell,
  onConfigureCell,
}: LaneSectionProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Lane units</h2>
        <p>
          {selectedShipName} has {lanes.length} lanes. Each lane accepts up to{' '}
          {lanes[0]?.cells.length ?? 3} units.
        </p>
      </div>
      <div className="lane-table">
        {lanes.map((lane, laneIndex) => (
          <article className="lane-row-card" key={getLaneName(laneIndex)}>
            <div className="lane-header">
              <h3>{getLaneName(laneIndex)}</h3>
              <strong>{laneSummaries[laneIndex].strength}</strong>
            </div>
            <div className="lane-cells">
              {lane.cells.map((cell, cellIndex) => (
                <button
                  className={cell ? 'lane-cell filled' : 'lane-cell'}
                  key={`${laneIndex}-${cellIndex}`}
                  type="button"
                  onClick={() => onConfigureCell(laneIndex, cellIndex)}
                  disabled={unitOptions.length === 0}
                >
                  {cell ? (
                    <>
                      <span>{cell.name}</span>
                      <strong>{cell.power}</strong>
                    </>
                  ) : (
                    <span>Empty</span>
                  )}
                </button>
              ))}
            </div>
            {lane.cells.some(Boolean) && (
              <div className="cell-actions">
                {lane.cells.map((cell, cellIndex) =>
                  cell ? (
                    <button
                      className="text-button"
                      key={`${laneIndex}-${cellIndex}-clear`}
                      type="button"
                      onClick={() => onClearCell(laneIndex, cellIndex)}
                    >
                      Clear {cellIndex + 1}
                    </button>
                  ) : null,
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
