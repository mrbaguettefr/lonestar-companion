export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function clampNumber(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

