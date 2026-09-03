/**
 * Geometry utilities for Grasshopper
 * profile tracing.
 *
 * Internal coordinate system:
 *
 *   x = distance along rotation axis
 *   r = radial distance from rotation axis
 *
 * Grasshopper:
 *
 *   X = x
 *   Y = 0
 *   Z = r
 */

export interface Point {
  x: number
  y: number
}

export interface ProfilePoint {
  x: number
  r: number
}

export interface AxisState {
  pointA: Point | null
  pointB: Point | null
  direction: Point | null
  radialDirection: Point | null
}

export interface ScaleState {
  pointA: Point | null
  pointB: Point | null

  /**
   * SCALE line projected onto the rotation axis.
   */
  axisPixel: number

  /**
   * Known physical length of the cylinder generatrix.
   */
  realLengthMm: number

  /**
   * Millimeters per pixel.
   */
  scaleMmPerPx: number
}

/**
 * Normalize the rotation axis.
 *
 * A -> B defines positive X.
 *
 * radialDirection is perpendicular to the axis.
 */
export function normalizeAxis(
  pointA: Point,
  pointB: Point,
): {
  direction: Point
  radialDirection: Point
} {
  const axisVector = {
    x: pointB.x - pointA.x,
    y: pointB.y - pointA.y,
  }

  const axisLength = Math.sqrt(
    axisVector.x * axisVector.x +
      axisVector.y * axisVector.y,
  )

  if (axisLength === 0) {
    throw new Error(
      'Axis points A and B cannot be identical',
    )
  }

  const direction = {
    x: axisVector.x / axisLength,
    y: axisVector.y / axisLength,
  }

  const radialDirection = {
    x: -direction.y,
    y: direction.x,
  }

  return {
    direction,
    radialDirection,
  }
}

/**
 * 2D dot product.
 */
export function dotProduct(
  a: Point,
  b: Point,
): number {
  return a.x * b.x + a.y * b.y
}

/**
 * Euclidean distance.
 */
export function distance(
  p1: Point,
  p2: Point,
): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y

  return Math.sqrt(
    dx * dx + dy * dy,
  )
}

/**
 * Project the SCALE line onto the rotation axis.
 *
 * This is the important SCALE definition:
 *
 *     SCALE line
 *          ↓
 *     axis-parallel component
 *          ↓
 *     pixel length used for calibration
 *
 * The line itself can be diagonal.
 */
export function projectScaleToAxisDirection(
  scalePointA: Point,
  scalePointB: Point,
  axisDirection: Point,
): number {
  const scaleVector = {
    x:
      scalePointB.x -
      scalePointA.x,

    y:
      scalePointB.y -
      scalePointA.y,
  }

  return Math.abs(
    dotProduct(
      scaleVector,
      axisDirection,
    ),
  )
}

/**
 * Calculate mm / pixel.
 *
 * Known physical cylinder generatrix length
 * divided by the axis-parallel pixel length.
 */
export function calculateScale(
  realLengthMm: number,
  axisPixel: number,
): number {
  if (axisPixel <= 0) {
    throw new Error(
      'Projected SCALE length must be greater than 0',
    )
  }

  if (realLengthMm <= 0) {
    throw new Error(
      'Cylinder generatrix length must be greater than 0',
    )
  }

  return realLengthMm / axisPixel
}

/**
 * Convert a Canvas-local point into
 * axis-local coordinates.
 *
 * xPixel:
 *   signed distance along A -> B.
 *
 * rPixel:
 *   absolute distance from the rotation axis.
 */
export function toAxisLocalCoordinates(
  point: Point,
  axisPointA: Point,
  axisDirection: Point,
  radialDirection: Point,
): {
  xPixel: number
  rPixel: number
} {
  const relative = {
    x: point.x - axisPointA.x,
    y: point.y - axisPointA.y,
  }

  const xPixel = dotProduct(
    relative,
    axisDirection,
  )

  const rPixelSigned =
    dotProduct(
      relative,
      radialDirection,
    )

  const rPixel = Math.abs(
    rPixelSigned,
  )

  return {
    xPixel,
    rPixel,
  }
}

/**
 * Convert pixels to millimeters.
 */
export function pixelToMillimeter(
  pixel: number,
  scaleMmPerPx: number,
): number {
  return pixel * scaleMmPerPx
}

/**
 * Convert a Canvas-local point into
 * final profile coordinates.
 */
export function pointToProfilePoint(
  point: Point,
  axisPointA: Point,
  axisDirection: Point,
  radialDirection: Point,
  scaleMmPerPx: number,
): ProfilePoint {
  const {
    xPixel,
    rPixel,
  } =
    toAxisLocalCoordinates(
      point,
      axisPointA,
      axisDirection,
      radialDirection,
    )

  return {
    x: pixelToMillimeter(
      xPixel,
      scaleMmPerPx,
    ),

    r: pixelToMillimeter(
      rPixel,
      scaleMmPerPx,
    ),
  }
}
