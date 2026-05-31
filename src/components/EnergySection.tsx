import { type DragEvent, useState } from 'react'
import { clampNumber } from '../lib/numbers'
import { energyColors, energyPoints } from '../lib/gameData'
import type { DragPayload, Energy } from '../types/lonestar'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog'

type EnergySectionProps = {
  energies: Energy[]
  onAddEnergy: (spec: { color: string; point: number; count: number }) => void
  onRemoveEnergy: (id: number) => void
  onUpdateEnergy: (id: number, patch: Partial<Energy>) => void
  onDropEnergyToHand: (payload: DragPayload) => void
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

export function EnergySection({
  energies,
  onAddEnergy,
  onRemoveEnergy,
  onUpdateEnergy,
  onDropEnergyToHand,
}: EnergySectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [draftColor, setDraftColor] = useState('white')
  const [draftPoint, setDraftPoint] = useState(3)
  const [draftCount, setDraftCount] = useState(1)
  const [isDragOver, setIsDragOver] = useState(false)

  function openDialog() {
    setDraftColor('white')
    setDraftPoint(3)
    setDraftCount(1)
    setIsDialogOpen(true)
  }

  function handleAdd() {
    onAddEnergy({ color: draftColor, point: draftPoint, count: draftCount })
    setIsDialogOpen(false)
  }

  function handleSectionDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragOver(false)
    const payload = parseDragPayload(event.dataTransfer.getData('text/plain'))
    if (!payload || payload.type !== 'energy-slot') return
    onDropEnergyToHand(payload)
  }

  return (
    <>
      <section
        className={`panel${isDragOver ? ' energy-drop-target' : ''}`}
        onDragOver={(event) => {
          // Only accept energy-slot drags (can't read data during dragover, accept all non-unit)
          event.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleSectionDrop}
      >
        <div className="section-heading">
          <h2>Energies in hand</h2>
          <p>Drop energy from unit slots here to return it to hand.</p>
        </div>
        <div className="energy-list">
          {energies.map((energy) => (
            <div
              className="energy-row"
              key={energy.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(
                  'text/plain',
                  JSON.stringify({
                    type: 'energy-hand',
                    energyId: energy.id,
                    color: energy.color,
                    point: energy.point,
                  } satisfies DragPayload),
                )
              }}
            >
              <select
                aria-label="Energy color"
                value={energy.color}
                onChange={(event) => onUpdateEnergy(energy.id, { color: event.target.value })}
              >
                {energyColors.map((color) => (
                  <option key={color}>{color}</option>
                ))}
              </select>
              <select
                aria-label={`${energy.color} energy point value`}
                value={energy.point}
                onChange={(event) =>
                  onUpdateEnergy(energy.id, { point: Number(event.target.value) })
                }
              >
                {energyPoints.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}pt
                  </option>
                ))}
              </select>
              <Input
                aria-label={`${energy.color} energy count`}
                min="0"
                type="number"
                value={energy.count}
                onChange={(event) =>
                  onUpdateEnergy(energy.id, { count: clampNumber(Number(event.target.value)) })
                }
              />
              <span className={`swatch ${energy.color.toLowerCase()}`} aria-hidden="true" />
              <Button
                aria-label={`Remove ${energy.color} energy`}
                size="icon"
                type="button"
                variant="destructive"
                onClick={() => onRemoveEnergy(energy.id)}
              >
                -
              </Button>
            </div>
          ))}
        </div>
        <Button className="mt-3.5" type="button" variant="outline" onClick={openDialog}>
          Add energy
        </Button>
      </section>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && setIsDialogOpen(false)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              handleAdd()
            }}
          >
            <DialogHeader>
              <DialogTitle>Add energy to hand</DialogTitle>
              <DialogDescription>
                Choose the color, point value, and quantity to add.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="new-energy-color">Color</Label>
              <div className="flex items-center gap-2">
                <select
                  id="new-energy-color"
                  value={draftColor}
                  onChange={(event) => setDraftColor(event.target.value)}
                >
                  {energyColors.map((color) => (
                    <option key={color}>{color}</option>
                  ))}
                </select>
                <span className={`swatch ${draftColor}`} aria-hidden="true" />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-energy-point">Point value</Label>
              <select
                id="new-energy-point"
                value={draftPoint}
                onChange={(event) => setDraftPoint(Number(event.target.value))}
              >
                {energyPoints.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}pt
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="new-energy-count">Quantity</Label>
              <Input
                id="new-energy-count"
                min="1"
                max="99"
                type="number"
                value={draftCount}
                onChange={(event) =>
                  setDraftCount(Math.max(1, clampNumber(Number(event.target.value))))
                }
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
