import { clampNumber } from '../lib/numbers'
import { energyColors } from '../lib/gameData'
import type { Energy } from '../types/lonestar'
import { Button } from './ui/button'
import { Input } from './ui/input'

type EnergySectionProps = {
  energies: Energy[]
  onAddEnergy: () => void
  onRemoveEnergy: (id: number) => void
  onUpdateEnergy: (id: number, patch: Partial<Energy>) => void
}

export function EnergySection({
  energies,
  onAddEnergy,
  onRemoveEnergy,
  onUpdateEnergy,
}: EnergySectionProps) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Energies in hand</h2>
        <p>Enter each energy group by color and amount.</p>
      </div>
      <div className="energy-list">
        {energies.map((energy) => (
          <div className="energy-row" key={energy.id}>
            <select
              aria-label="Energy color"
              value={energy.color}
              onChange={(event) => onUpdateEnergy(energy.id, { color: event.target.value })}
            >
              {energyColors.map((color) => (
                <option key={color}>{color}</option>
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
      <Button className="mt-3.5" type="button" variant="outline" onClick={onAddEnergy}>
        Add energy
      </Button>
    </section>
  )
}
