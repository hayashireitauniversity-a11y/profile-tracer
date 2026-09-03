/**
 * Arc-length based resampling for curve traces.
 * Ensures endpoint preservation and even arc-length spacing.
 */

import { Point } from './geometry'

/**
 * Calculate cumulative arc lengths along a polyline.
 */
export function calculateCumulativeLengths(points: Point[]): number[] {
  if (points.length === 0) return []

  const lengths: number[] = [0]

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    const segmentLength = Math.sqrt(dx * dx + dy * dy)
    lengths.push(lengths[lengths.length - 1] + segmentLength)
  }

  return lengths
}

/**
 * Linear interpolation between two points.
 */
export function interpolatePoint(p1: Point, p2: Point, t: number): Point {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  }
}

/**
 * Resample a curve to exactly N points using arc-length parameterization.
 * Guarantees that the first and last resampled points equal the original endpoints.
 */
export function resampleByArcLength(
  rawTrace: Point[],
  targetCount: number
): Point[] {
  if (rawTrace.length < 2) {
    throw new Error('Raw trace must contain at least 2 points')
  }

  if (targetCount < 2) {
    throw new Error('Target count must be at least 2')
  }

  const lengths = calculateCumulativeLengths(rawTrace)
  const totalLength = lengths[lengths.length - 1]

  if (totalLength === 0) {
    // All points are identical; return targetCount copies of the first point
    return Array(targetCount).fill({ ...rawTrace[0] })
  }

  const sampledPoints: Point[] = []

  for (let i = 0; i < targetCount; i++) {
    let targetLength: number

    if (i === 0) {
      targetLength = 0
    } else if (i === targetCount - 1) {
      targetLength = totalLength
    } else {
      targetLength = (totalLength * i) / (targetCount - 1)
    }

    // Find the segment containing targetLength
    let segmentIdx = 0
    for (let j = 0; j < lengths.length - 1; j++) {
      if (targetLength >= lengths[j] && targetLength <= lengths[j + 1]) {
        segmentIdx = j
        break
      }
    }

    if (i === 0) {
      sampledPoints.push({ ...rawTrace[0] })
    } else if (i === targetCount - 1) {
      sampledPoints.push({ ...rawTrace[rawTrace.length - 1] })
    } else {
      const p1 = rawTrace[segmentIdx]
      const p2 = rawTrace[segmentIdx + 1]
      const segmentStart = lengths[segmentIdx]
      const segmentEnd = lengths[segmentIdx + 1]
      const segmentLength = segmentEnd - segmentStart

      let t = 0
      if (segmentLength > 0) {
        t = (targetLength - segmentStart) / segmentLength
      }

      sampledPoints.push(interpolatePoint(p1, p2, t))
    }
  }

  return sampledPoints
}
