# Project Notes

## Node.js

Use `fnm` to find and activate Node.js. Prepend the active fnm Node path to `PATH` before running npm commands if `node` is not found.

## Project Overview

**Lonestar Companion** is a React + TypeScript web app that serves as a battle planner / solver for the *Lonestar* board game. Players set up their ship's unit lanes, configure the energy cards in their hand, set lane goals, then ask the solver to suggest optimal energy placements.

**Dev server:** `npm run dev` (Vite, port 5173)
**Build:** `npm run build` (tsc + Vite)

## Tech Stack

- React 19, TypeScript ~6, Vite 8
- Tailwind CSS v4 + shadcn/ui components (via Radix UI primitives in `src/components/ui/`)
- No test suite — verify by running the dev server and using the UI
- Game data loaded at runtime from `public/lonestar_data.json`

## Repository Layout

```
src/
  App.tsx                  # Root component + all state management
  types/lonestar.ts        # All shared TypeScript types
  lib/
    gameData.ts            # Data helpers: initialLanes, canDropEnergyInSlot, extractStaticPower, etc.
    effects.ts             # Unit skill handlers, support on-load/activation/passive logic
    solver.ts              # Backtracking solver + lane strength summariser
    numbers.ts             # Tiny arithmetic utilities
    utils.ts               # shadcn cn() helper
  components/
    AppHeader.tsx          # Header bar with Solve status, export/import, undo/redo
    LaneSection.tsx        # Lane grid — drag-and-drop unit placement, energy slots
    EnergySection.tsx      # Energy hand panel — add/remove/drag energy cards
    GoalsSection.tsx       # Per-lane goal inputs and strength summary
    SolutionPanel.tsx      # Solver results list with step-by-step guide
    ui/                    # shadcn primitives (button, dialog, input, label)
public/
  lonestar_data.json       # Ships + units game data (loaded at runtime)
```

## Core Data Types (`src/types/lonestar.ts`)

| Type | Purpose |
|------|---------|
| `Lane` | One lane on the ship: `cells: (LaneUnit | null)[]` + `goal: number` |
| `LaneUnit` | A unit placed in a cell: slots, loadedEnergy, skillPath, staticPower, activateCount, etc. |
| `Energy` | A stack of energy cards in hand: `{ id, color, count, point }` |
| `LoadedEnergy` | One energy card loaded into a slot: `{ color, point }` |
| `UnitOption` | A selectable unit+level combo from `lonestar_data.json` |
| `PlayerShip` | Ship definition with lane/column count and starting units |
| `RankedSolution` | Solver output: placements + stats (energiesUsed, strengthGenerated, etc.) |
| `SolverStrategy` | `'best' | 'least-cards' | 'efficiency' | 'max-damage' | 'max-energy'` |

Energy colors are `'white'`, `'blue'`, `'orange'` (ascending value/constraint order).  
Slot color rules: orange slots accept orange only; blue slots accept blue or orange; white slots accept any color.

## Solver Architecture (`src/lib/solver.ts`)

1. **`summarizeLanes(lanes, battleContext)`** — computes per-lane strength in 3 passes:
   - Pass 1: each unit's own strength via `computeUnitStrength` (effects.ts)
   - Pass 2: `Skill_FullLoadPower` cross-unit bonus
   - Pass 3: support passive bonuses from `computeSupportPassiveBonus`

2. **`solveMultiple(lanes, laneSummaries, energies, max=5)`** — global backtracking solver:
   - Collects all empty slots across all lanes; sorts support slots first, then by color constraint (orange → blue → white)
   - Enumerates all subsets of activatable support units (up to 6); for each subset applies activation effects then runs `searchGlobal`
   - `searchGlobal`: recursive backtracking, budget-capped at 50 000 calls; tries each card in the pool for each slot, also tries skipping a slot
   - Returns up to `max` deduplicated `RankedSolution`s, sorted possible-first then by energy count

3. **`sortByStrategy(solutions, strategy)`** — client-side re-sort of already-computed solutions
4. **`computeSolutionSteps`** — annotated step-by-step walkthrough of a placement list (support first)
5. **`solutionScore`** — composite scoring for `'best'` strategy: `(strength/cards)*2 + energyGenerated - surplus*0.5`

## Effects System (`src/lib/effects.ts`)

- **`computeUnitStrength(unit, ctx)`**: dispatches to `SKILL_HANDLERS[unit.skillPath]`. Returns `UnitStrengthBreakdown` with `basePoints + staticPower + effectBonus`, optionally doubled.
- **`triggerSupportOnLoad(unit, loadedEnergy)`**: returns `GeneratedEnergy[]` to add to hand when energy is dropped onto a support slot. Covers ~20 support skill paths.
- **`triggerActivation(unit, energies)`**: applies an activated support unit's one-shot effect to the energy pool. Returns `Energy[] | null` (null = no auto effect, just track manually).
- **`computeSupportPassiveBonus(support, ..., target, ...)`**: returns additive strength bonus a support unit provides to a specific attack unit (adjacency-based, checked in App's Pass 3).
- **`AUTO_ACTIVATION_SKILLS`**: set of skill paths whose activation modifies the energy pool automatically (others show Activate button but effect is manual).
- **`SUPPORT_GENERATES_ENERGY`**: set of skill paths that trigger `triggerSupportOnLoad`.
- **`IMPLEMENTED_SKILLS`**: set of all skill paths with computed handlers — units outside this set get a manual override UI.

## App State (`App.tsx`)

Key state:
- `lanes / energies` — current board state
- `undoStack / redoStack` — 30-step undo/redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z)
- `solvedResults / loadedSolutionIdx / solverStrategy` — solver outputs and active solution
- `presolvedLanes / presolvedEnergies` — snapshot taken just before Solve, used by Clear to restore
- `hasSolved` — cleared on any input change so the header indicator stays accurate

Key patterns:
- `markInputChanged()` — call before any user edit; resets solve state
- `pushHistory()` — call before destructive operations (drag, activate, clear)
- Energy drag payloads: `DragPayload` union of `energy-hand`, `energy-slot`, `unit`
- Displacement swap: dragging from slot A to slot B swaps them if the displaced card fits back in A
- Migration effect: on `unitOptions` load, cells missing `overclockThresholds`/`maxActivations` are patched from the live unit data

## Import / Export

Config format (`version: 1`): `{ version, shipId, lanes, energies }` — exported as pretty-printed JSON to clipboard; imported via paste dialog. Missing fields in imported cells are patched against current `unitOptions`.
