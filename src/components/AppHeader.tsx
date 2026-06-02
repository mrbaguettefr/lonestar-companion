import { Button } from './ui/button'

type AppHeaderProps = {
  hasSolved: boolean
  isPossible: boolean
  copyFeedback: boolean
  canUndo: boolean
  canRedo: boolean
  onExport: () => void
  onImport: () => void
  onFastImport: () => void
  onUndo: () => void
  onRedo: () => void
  onReset: () => void
  canFastImport: boolean
}

export function AppHeader({
  hasSolved,
  isPossible,
  copyFeedback,
  canUndo,
  canRedo,
  onExport,
  onImport,
  onFastImport,
  onUndo,
  onRedo,
  onReset,
  canFastImport,
}: AppHeaderProps) {
  const statusClass = hasSolved ? (isPossible ? 'status ready' : 'status blocked') : 'status idle'
  const statusLabel = hasSolved ? (isPossible ? 'Possible' : 'Not enough energy') : 'Ready to solve'

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
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onFastImport}
          disabled={!canFastImport}
          title="Load public/configs/bleaching-tap-pair.json"
        >
          Bleaching Tap Pair
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
