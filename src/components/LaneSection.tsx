import { type DragEvent, useState } from 'react'
import { getLaneName, canDropEnergyInSlot } from '../lib/gameData'
import { formatEffect } from '../lib/effects'
import type { DragPayload, Lane, LaneSummary, LaneUnit, UnitOption, UnitStrengthBreakdown, LoadedEnergy } from '../types/lonestar'
import { Button } from './ui/button'

type LaneSectionProps = {
  lanes: Lane[]
  laneSummaries: LaneSummary[]
  selectedShipName: string
  unitOptions: UnitOption[]
  onClearCell: (laneIndex: number, cellIndex: number) => void
  onActivateUnit: (laneIndex: number, cellIndex: number) => void
  onConfigureCell: (laneIndex: number, cellIndex: number) => void
  onMoveCell: (
    fromLaneIndex: number,
    fromCellIndex: number,
    toLaneIndex: number,
    toCellIndex: number,
  ) => void
  onDropEnergyToSlot: (
    payload: DragPayload,
    toLane: number,
    toCell: number,
    toSlot: number,
  ) => void
}

function buildStrengthFormula(cell: LaneUnit, breakdown: UnitStrengthBreakdown): string {
  if (breakdown.isManualOverride) return `Manual: ${breakdown.total}`
  if (cell.unitType === 'support') return 'Support unit'

  const energies = cell.loadedEnergy.filter((e): e is LoadedEnergy => e !== null)
  const parts: string[] = energies.map(e => String(e.point))

  if (breakdown.staticPower > 0) parts.push(`${breakdown.staticPower} (power)`)

  if (breakdown.effectBonus !== 0) {
    const compactLabel = breakdown.effectLabel?.match(/^[-+]?\d+\s*\(([^)]+)\)$/)?.[1]
    if (compactLabel) {
      parts.push(`${breakdown.effectBonus} (${compactLabel})`)
    } else {
      parts.push(breakdown.effectLabel ?? `${breakdown.effectBonus} (effect)`)
    }
  }

  if (parts.length === 0) return `0 = ${breakdown.total}`

  const expr = breakdown.isDoubled
    ? `(${parts.join(' + ')}) × 2`
    : parts.join(' + ').replace(/\+ -(\d)/g, '- $1')

  return `${expr} = ${breakdown.total}`
}

function parseDragPayload(data: string): DragPayload | null {
  try {
    const parsed = JSON.parse(data) as DragPayload
    if (parsed && typeof parsed.type === 'string') return parsed
    return null
  } catch {
    return null
  }
}

export function LaneSection({
  lanes,
  laneSummaries,
  selectedShipName,
  unitOptions,
  onClearCell,
  onActivateUnit,
  onConfigureCell,
  onMoveCell,
  onDropEnergyToSlot,
}: LaneSectionProps) {
  const [slotDragOver, setSlotDragOver] = useState<string | null>(null)

  function handleCellDrop(event: DragEvent<HTMLDivElement>, toLaneIndex: number, toCellIndex: number) {
    event.preventDefault()
    const payload = parseDragPayload(event.dataTransfer.getData('text/plain'))
    if (!payload) return

    if (payload.type === 'unit') {
      onMoveCell(payload.laneIndex, payload.cellIndex, toLaneIndex, toCellIndex)
    }
    // energy drops are handled at the slot level
  }

  function handleSlotDrop(
    event: DragEvent<HTMLSpanElement>,
    laneIndex: number,
    cellIndex: number,
    slotIndex: number,
    slotColor: string,
  ) {
    event.preventDefault()
    event.stopPropagation()
    setSlotDragOver(null)

    const payload = parseDragPayload(event.dataTransfer.getData('text/plain'))
    if (!payload || payload.type === 'unit') return
    if (!canDropEnergyInSlot(payload.color, slotColor)) return

    onDropEnergyToSlot(payload, laneIndex, cellIndex, slotIndex)
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
                        if (!cell) return
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(
                          'text/plain',
                          JSON.stringify({ type: 'unit', laneIndex, cellIndex } satisfies DragPayload),
                        )
                      }}
                      onDrop={(event) => handleCellDrop(event, laneIndex, cellIndex)}
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
                          <div className="unit-tooltip" role="tooltip">
                            {cell.effect && (
                              <p>{formatEffect(cell.effect, cell.args, cell.overclockThresholds)}</p>
                            )}
                            <span className="tooltip-formula">
                              {buildStrengthFormula(cell, breakdown)}
                            </span>
                          </div>
                          <button
                            className="lane-cell-remove"
                            type="button"
                            aria-label={`Remove ${cell.name}`}
                            onClick={(e) => { e.stopPropagation(); onClearCell(laneIndex, cellIndex) }}
                          >
                            ×
                          </button>
                          <span className="unit-name">{cell.name}</span>
                          <span
                            className="unit-slots"
                            aria-label={`Slots: ${cell.slots.join(', ')}`}
                          >
                            {cell.slots.map((slot, slotIndex) => {
                              const loaded = cell.loadedEnergy[slotIndex] ?? null
                              const slotKey = `${laneIndex}-${cellIndex}-${slotIndex}`
                              const isDragOver = slotDragOver === slotKey

                              return (
                                <span
                                  key={slotKey}
                                  className={[
                                    'slot-dot',
                                    slot,
                                    loaded ? 'slot-loaded' : 'slot-empty',
                                    isDragOver ? 'slot-drag-over' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  title={
                                    loaded
                                      ? `${loaded.color} ${loaded.point}pt — drag to move`
                                      : `${slot} slot (empty) — drop energy here`
                                  }
                                  draggable={Boolean(loaded)}
                                  onDragStart={(event) => {
                                    event.stopPropagation() // prevent unit drag
                                    if (!loaded) return
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData(
                                      'text/plain',
                                      JSON.stringify({
                                        type: 'energy-slot',
                                        laneIndex,
                                        cellIndex,
                                        slotIndex,
                                        color: loaded.color,
                                        point: loaded.point,
                                      } satisfies DragPayload),
                                    )
                                  }}
                                  onDragEnd={() => setSlotDragOver(null)}
                                  onDragOver={(event) => {
                                    event.stopPropagation()
                                    // Peek at drag data to check compatibility
                                    // We can't read data during dragover but we stored it in dataTransfer types
                                    // Use a permissive accept during dragover; real check at drop
                                    event.preventDefault()
                                    setSlotDragOver(slotKey)
                                  }}
                                  onDragLeave={(event) => {
                                    event.stopPropagation()
                                    setSlotDragOver((prev) => (prev === slotKey ? null : prev))
                                  }}
                                  onDrop={(event) =>
                                    handleSlotDrop(event, laneIndex, cellIndex, slotIndex, slot)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={
                                    loaded
                                      ? `${slot} slot loaded with ${loaded.color} ${loaded.point}pt`
                                      : `${slot} slot empty`
                                  }
                                >
                                  {loaded && (
                                    <span className="slot-point" aria-hidden="true">
                                      {loaded.point}
                                    </span>
                                  )}
                                </span>
                              )
                            })}
                          </span>
                          <div className="unit-badges">
                            <span className="unit-badge">{breakdown?.total ?? 0}</span>
                            {breakdown.staticPower > 0 && (
                              <span className="unit-badge unit-badge--power">{breakdown.staticPower}</span>
                            )}
                            {breakdown.supportPower > 0 && (
                              <span className="unit-badge unit-badge--power">Power: {breakdown.supportPower}</span>
                            )}
                          </div>
                        </>
                      ) : (
                        <span>Empty</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {lane.cells.some((cell) => cell && cell.maxActivations > 0) && (
                <div className="cell-actions">
                  {lane.cells.map((cell, cellIndex) =>
                    cell && cell.maxActivations > 0 ? (
                      <span key={`${laneIndex}-${cellIndex}-actions`} className="cell-action-group">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={cell.activateCount > 0}
                          title={cell.activateCount > 0 ? 'Already activated' : 'Activate this unit'}
                          onClick={(e) => { e.stopPropagation(); onActivateUnit(laneIndex, cellIndex) }}
                        >
                          {cell.activateCount > 0 ? 'Activated' : 'Activate'} {cellIndex + 1}
                        </Button>
                      </span>
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
