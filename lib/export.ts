import type { ProfilePoint } from './geometry'

/**
 * Display number without unnecessary decimals.
 */
export function formatNumber(
  value: number,
): string {
  return Number.isInteger(value)
    ? String(value)
    : value
        .toFixed(2)
        .replace(/\.00$/, '')
}

/**
 * JSON export.
 */
export function generateJSON(
  points: ProfilePoint[],
): string {
  return JSON.stringify(
    points.map(({ x, r }) => ({
      x: Number(x.toFixed(4)),
      r: Number(r.toFixed(4)),
    })),
    null,
    2,
  )
}

/**
 * CSV export.
 */
export function generateCSV(
  points: ProfilePoint[],
): string {
  return [
    'x,r',
    ...points.map(
      ({ x, r }) =>
        `${formatNumber(x)},${formatNumber(r)}`,
    ),
  ].join('\n')
}

/**
 * Grasshopper point list.
 *
 * Coordinate convention:
 *
 *   X = axis direction
 *   Y = 0
 *   Z = radius
 *
 * Output:
 *
 *   x,0,r
 */
export function generateGrasshopperPointList(
  points: ProfilePoint[],
): string {
  return points
    .map(
      ({ x, r }) =>
        `${formatNumber(x)},0,${formatNumber(r)}`,
    )
    .join('\n')
}

/**
 * Clipboard copy.
 */
export function copyText(
  content: string,
): Promise<void> {
  return navigator.clipboard.writeText(
    content,
  )
}
