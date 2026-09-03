import type {
  ProfilePoint,
} from './geometry'

/**
 * Format a number for readable output.
 */
export function formatNumber(
  value: number
): string {
  return Number.isInteger(
    value
  )
    ? String(value)
    : value
        .toFixed(2)
        .replace(
          /\.00$/,
          ''
        )
}

/**
 * JSON output.
 *
 * Internal representation:
 *
 * {
 *   x: axis direction,
 *   r: radius
 * }
 *
 * JSON keeps the internal representation.
 */
export function generateJSON(
  points: ProfilePoint[]
): string {
  return JSON.stringify(
    points.map(
      ({ x, r }) => ({
        x: Number(
          x.toFixed(4)
        ),
        r: Number(
          r.toFixed(4)
        ),
      })
    ),
    null,
    2
  )
}

/**
 * CSV output.
 *
 * Internal representation:
 *
 * x,r
 */
export function generateCSV(
  points: ProfilePoint[]
): string {
  return [
    'x,r',
    ...points.map(
      ({ x, r }) =>
        `${formatNumber(
          x
        )},${formatNumber(r)}`
    ),
  ].join('\n')
}

/**
 * Grasshopper point list.
 *
 * IMPORTANT:
 *
 * The Grasshopper coordinate system is:
 *
 *   X = rotation-axis direction
 *   Y = 0
 *   Z = radius
 *
 * Therefore:
 *
 *   x,r
 *
 * becomes:
 *
 *   x,0,r
 *
 * Example:
 *
 *   internal:
 *     { x: 150, r: 40 }
 *
 *   Grasshopper:
 *     150,0,40
 */
export function generateGrasshopperPointList(
  points: ProfilePoint[]
): string {
  return points
    .map(
      ({ x, r }) =>
        `${formatNumber(
          x
        )},0,${formatNumber(r)}`
    )
    .join('\n')
}

/**
 * Copy text to clipboard.
 */
export function copyText(
  content: string
): Promise<void> {
  return navigator.clipboard.writeText(
    content
  )
}