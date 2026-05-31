type AppHeaderProps = {
  hasSolved: boolean
  isPossible: boolean
}

export function AppHeader({ hasSolved, isPossible }: AppHeaderProps) {
  const statusClass = hasSolved ? (isPossible ? 'status ready' : 'status blocked') : 'status idle'
  const statusLabel = hasSolved ? (isPossible ? 'Possible' : 'Not enough energy') : 'Ready to solve'

  return (
    <header className="app-header">
      <div>
        <p className="eyebrow">Lonestar Companion</p>
        <h1>Lane strength solver</h1>
      </div>
      <div className={statusClass}>{statusLabel}</div>
    </header>
  )
}

