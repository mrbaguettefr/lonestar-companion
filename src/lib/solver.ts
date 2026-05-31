import type { Assignment, Energy, Lane, LaneSummary } from '../types/lonestar'
import { sum } from './numbers'

export function summarizeLanes(lanes: Lane[]): LaneSummary[] {
  return lanes.map((lane) => {
    const strength = sum(lane.units)

    return {
      strength,
      deficit: Math.max(0, lane.goal - strength),
      surplus: Math.max(0, strength - lane.goal),
    }
  })
}

export function solveLaneAssignments(energies: Energy[], laneSummaries: LaneSummary[]) {
  const totalEnergy = sum(energies.map((energy) => energy.count))
  const totalNeeded = sum(laneSummaries.map((lane) => lane.deficit))
  const assignments: Assignment[] = []
  const remainingByLane = laneSummaries.map((lane) => lane.deficit)

  for (const energy of energies) {
    let available = energy.count

    for (let laneIndex = 0; laneIndex < remainingByLane.length; laneIndex += 1) {
      if (available === 0) {
        break
      }

      const used = Math.min(available, remainingByLane[laneIndex])
      if (used > 0) {
        assignments.push({ laneIndex, color: energy.color, count: used })
        available -= used
        remainingByLane[laneIndex] -= used
      }
    }
  }

  return {
    assignments,
    possible: totalEnergy >= totalNeeded,
    remainingByLane,
    spareEnergy: Math.max(0, totalEnergy - totalNeeded),
    totalEnergy,
    totalNeeded,
  }
}

