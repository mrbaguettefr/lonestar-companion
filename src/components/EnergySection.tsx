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

type DialogMode = 'add' | 'edit'

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
  const [dialogMode, setDialogMode] = useState<DialogMode>('add')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [draftColor, setDraftColor] = useState('white')
  const [draftPoint, setDraftPoint] = useState(3)
  const [draftCount, setDraftCount] = useState(1)
  const [isDragOver, setIsDragOver] = useState(false)

  function openAddDialog() {
    setDialogMode('add')
    setDraftColor('white')
    setDraftPoint(3)
    setDraftCount(1)
    setEditingId(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(energy: Energy) {
    setDialogMode('edit')
    setEditingId(energy.id)
    setDraftColor(energy.color)
    setDraftPoint(energy.point)
    setDraftCount(energy.count)
    setIsDialogOpen(true)
  }

  function handleSubmit() {
    if (dialogMode === 'add') {
      onAddEnergy({ color: draftColor, point: draftPoint, count: draftCount })
    } else if (editingId !== null) {
      onUpdateEnergy(editingId, { color: draftColor, point: draftPoint, count: draftCount })
    }
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
          event.preventDefault()
          setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleSectionDrop}
      >
        <div className="section-heading">
          <h2>Energies in hand</h2>
          <p>Drag cards to unit slots · drop slot energy here to return it · click to edit.</p>
        </div>

        <div className="energy-cards">
          {energies.map((energy) => (
            <div
              key={energy.id}
              className={`energy-card ${energy.color}`}
              draggable
              title={`${energy.color} ${energy.point}pt ×${energy.count} — drag to a unit slot`}
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
              onClick={() => openEditDialog(energy)}
            >
              <span className="energy-card-point">{energy.point}</span>
              <span className="energy-card-count">×{energy.count}</span>
              <button
                className="energy-card-remove"
                type="button"
                aria-label={`Remove ${energy.color} ${energy.point}pt energy`}
                onClick={(e) => {
                  e.stopPropagation()
                  onRemoveEnergy(energy.id)
                }}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className="energy-card energy-card-add"
            onClick={openAddDialog}
            aria-label="Add energy to hand"
          >
            <span className="energy-card-plus">+</span>
          </button>
        </div>
      </section>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && setIsDialogOpen(false)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmit()
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {dialogMode === 'add' ? 'Add energy to hand' : 'Edit energy'}
              </DialogTitle>
              <DialogDescription>
                {dialogMode === 'add'
                  ? 'Choose the color, point value, and quantity to add.'
                  : 'Update the color, point value, or quantity.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="energy-color">Color</Label>
              <div className="flex items-center gap-2">
                <select
                  id="energy-color"
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
              <Label htmlFor="energy-point">Point value</Label>
              <select
                id="energy-point"
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
              <Label htmlFor="energy-count">Quantity</Label>
              <Input
                id="energy-count"
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
              <Button type="submit">{dialogMode === 'add' ? 'Add' : 'Save'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
