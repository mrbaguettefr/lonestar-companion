import type { DragEvent } from 'react'
import { getLaneName } from '../lib/gameData'
import type { Lane, LaneSummary, UnitOption } from '../types/lonestar'
import { Button } from './ui/button'

type LaneSectionProps = {
  lanes: Lane[]
  laneSummaries: LaneSummary[]
  selectedShipName: string
  unitOptions: UnitOption[]
  onClearCell: (laneIndex: number, cellIndex: number) => void
  onConfigureCell: (laneIndex: number, cellIndex: number) => void
  onMoveCell: (
    fromLaneIndex: number,
    fromCellIndex: number,
    toLaneIndex: number,
    toCellIndex: number,
  ) => void
}

export function LaneSection({
  lanes,
  laneSummaries,
  selectedShipName,
  unitOptions,
  onClearCell,
  onConfigureCell,
  onMoveCell,
}: LaneSectionProps) {
  function handleDrop(
    event: DragEvent<HTMLDivElement>,
    toLaneIndex: number,
    toCellIndex: number,
  ) {
    event.preventDefault()
    const [fromLaneIndex, fromCellIndex] = event.dataTransfer
      .getData('text/plain')
      .split(':')
      .map(Number)

    if (Number.isNaN(fromLaneIndex) || Number.isNaN(fromCellIndex)) {
      return
    }

    onMoveCell(fromLaneIndex, fromCellIndex, toLaneIndex, toCellIndex)
  }

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
        {lanes.map((lane, laneIndex) => {
          const summary = laneSummaries[laneIndex]

          return (
            <article className="lane-row-card" key={getLaneName(laneIndex)}>
              <div className="lane-header">
                <h3>{getLaneName(laneIndex)}</h3>
                <strong>{summary.strength}</strong>
              </div>
              <div className="lane-cells">
                {lane.cells.map((cell, cellIndex) => {
                  const breakdown = summary.unitBreakdowns[cellIndex]

                  return (
                    <div
                      className={cell ? 'lane-cell filled' : 'lane-cell'}
                      draggable={Boolean(cell)}
                      key={`${laneIndex}-${cellIndex}`}
                      onDragOver={(event) => event.preventDefault()}
                      onDragStart={(event) => {
                        if (!cell) {
                          return
                        }

                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', `${laneIndex}:${cellIndex}`)
                      }}
                      onDrop={(event) => handleDrop(event, laneIndex, cellIndex)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onConfigureCell(laneIndex, cellIndex)
                        }
                      }}
                      onClick={() => onConfigureCell(laneIndex, cellIndex)}
                      role="button"
                      tabIndex={unitOptions.length === 0 ? -1 : 0}
                    >
                      {cell ? (
                        <>
                          <span className="unit-name">{cell.name}</span>
                          <span className="unit-slots" aria-label={`Slots: ${cell.slots.join(', ')}`}>
                            {cell.slots.map((slot, slotIndex) => (
                              <span
                                aria-hidden="true"
                                className={`slot-dot ${slot}`}
                                key={`${slot}-${slotIndex}`}
                              />
                            ))}
                          </span>
                          <strong>
                            {breakdown?.isManualOverride ? 'Manual' : 'Strength'}{' '}
                            {breakdown?.total ?? 0}
                          </strong>
                          {breakdown?.effectLabel && (
                            <span className="unit-effect-label">{breakdown.effectLabel}</span>
                          )}
                        </>
                      ) : (
                        <span>Empty</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {lane.cells.some(Boolean) && (
                <div className="cell-actions">
                  {lane.cells.map((cell, cellIndex) =>
                    cell ? (
                      <Button
                        key={`${laneIndex}-${cellIndex}-clear`}
                        type="button"
                        variant="link"
                        onClick={() => onClearCell(laneIndex, cellIndex)}
                      >
                        Clear {cellIndex + 1}
                      </Button>
                    ) : null,
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
