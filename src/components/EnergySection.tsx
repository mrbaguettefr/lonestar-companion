import { type DragEvent, useState } from 'react'
import { energyColors, energyPoints } from '../lib/gameData'
import type { DragPayload, Energy } from '../types/lonestar'
import { Button } from './ui/button'
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
  onAddEnergy: (spec: { color: string; point: number }) => void
  onRemoveEnergy: (id: number) => void
  onUpdateEnergy: (id: number, patch: Partial<Energy>) => void
  onDropEnergyToHand: (payload: DragPayload) => void
  onReorderEnergyInHand: (energyId: number, targetIndex: number) => void
  canAddEnergy: boolean
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
  onReorderEnergyInHand,
  canAddEnergy,
}: EnergySectionProps) {
  const [dialogMode, setDialogMode] = useState<DialogMode>('add')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [draftColor, setDraftColor] = useState('white')
  const [draftPoint, setDraftPoint] = useState(3)
  const [isDragOver, setIsDragOver] = useState(false)

  function openAddDialog() {
    if (!canAddEnergy) return
    setDialogMode('add')
    setDraftColor('white')
    setDraftPoint(3)
    setEditingId(null)
    setIsDialogOpen(true)
  }

  function openEditDialog(energy: Energy) {
    setDialogMode('edit')
    setEditingId(energy.id)
    setDraftColor(energy.color)
    setDraftPoint(energy.point)
    setIsDialogOpen(true)
  }

  function handleSubmit() {
    if (dialogMode === 'add') {
      if (!canAddEnergy) return
      onAddEnergy({ color: draftColor, point: draftPoint })
    } else if (editingId !== null) {
      onUpdateEnergy(editingId, { color: draftColor, point: draftPoint })
    }
    setIsDialogOpen(false)
  }

  function handleSectionDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setIsDragOver(false)
    const payload = parseDragPayload(event.dataTransfer.getData('text/plain'))
    if (!payload) return
    if (payload.type === 'energy-slot') {
      onDropEnergyToHand(payload)
    } else if (payload.type === 'energy-hand') {
      onReorderEnergyInHand(payload.energyId, energies.length)
    }
  }

  return (
    <>
      <section
        className={`panel${isDragOver ? ' energy-drop-target' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          if (!isDragOver) setIsDragOver(true)
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleSectionDrop}
      >
        <div className="section-heading">
          <h2>Energies in hand</h2>
          <p>Drag cards to unit slots · drop slot energy here to return it · click to edit.</p>
        </div>

        <div className="energy-cards">
          {energies.map((energy, energyIndex) => (
            <div
              key={energy.id}
              className={`energy-card ${energy.color}`}
              draggable
              title={`${energy.color} ${energy.point}pt — drag to a unit slot or reorder in hand`}
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
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setIsDragOver(false)
                const payload = parseDragPayload(event.dataTransfer.getData('text/plain'))
                if (payload?.type === 'energy-hand') {
                  onReorderEnergyInHand(payload.energyId, energyIndex)
                }
              }}
              onClick={() => openEditDialog(energy)}
            >
              <span className="energy-card-point">{energy.point}</span>
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
            disabled={!canAddEnergy}
            onClick={openAddDialog}
            aria-label="Add energy to hand"
            title={canAddEnergy ? 'Add energy to hand' : 'Hand is full'}
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
                  ? 'Choose the color and point value to add.'
                  : 'Update the color or point value.'}
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2" role="radiogroup" aria-labelledby="energy-color-label">
              <Label id="energy-color-label">Color</Label>
              <div className="energy-radio-row">
                {energyColors.map((color) => (
                  <label key={color} className={`energy-radio energy-radio--color ${draftColor === color ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="energy-color"
                      value={color}
                      checked={draftColor === color}
                      onChange={() => setDraftColor(color)}
                    />
                    <span className={`swatch ${color}`} aria-hidden="true" />
                    <span>{color}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-2" role="radiogroup" aria-labelledby="energy-point-label">
              <Label id="energy-point-label">Point value</Label>
              <div className="energy-radio-row energy-radio-row--points">
                {energyPoints.map((pt) => (
                  <label key={pt} className={`energy-radio energy-radio--point ${draftPoint === pt ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="energy-point"
                      value={pt}
                      checked={draftPoint === pt}
                      onChange={() => setDraftPoint(pt)}
                    />
                    <span>{pt}</span>
                  </label>
                ))}
              </div>
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
