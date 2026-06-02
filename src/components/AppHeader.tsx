import { useState } from 'react'
import { Button } from './ui/button'

type FastloadConfig = { label: string; filename: string }

type AppHeaderProps = {
  hasSolved: boolean
  isPossible: boolean
  copyFeedback: boolean
  canUndo: boolean
  canRedo: boolean
  onExport: () => void
  onImport: () => void
  onFastImportConfig: (filename: string) => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  canFastImport: boolean
  fastloadConfigs: FastloadConfig[]
}

export function AppHeader({
  hasSolved,
  isPossible,
  copyFeedback,
  canUndo,
  canRedo,
  onExport,
  onImport,
  onFastImportConfig,
  onUndo,
  onRedo,
  onReset,
  canFastImport,
  fastloadConfigs,
}: AppHeaderProps) {
  const statusClass = hasSolved ? (isPossible ? 'status ready' : 'status blocked') : 'status idle'
  const statusLabel = hasSolved ? (isPossible ? 'Possible' : 'Not enough energy') : 'Ready to solve'
  const [selectedConfig, setSelectedConfig] = useState(fastloadConfigs[0]?.filename ?? '')

  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Lonestar Companion</p>
        <h1>Lane strength solver</h1>
      </div>
      <div className="app-header-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
        >
          Undo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Y)"
        >
          Redo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onImport}>
          Import
        </Button>
        <select
          value={selectedConfig}
          onChange={(e) => setSelectedConfig(e.target.value)}
          disabled={!canFastImport}
        >
          {fastloadConfigs.map((cfg) => (
            <option key={cfg.filename} value={cfg.filename}>
              {cfg.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onFastImportConfig(selectedConfig)}
          disabled={!canFastImport || !selectedConfig}
        >
          Load
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onExport}>
          {copyFeedback ? 'Copied!' : 'Export'}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onReset}>
          Reset
        </Button>
        <div className={statusClass}>{statusLabel}</div>
      </div>
    </header>
  )
}
