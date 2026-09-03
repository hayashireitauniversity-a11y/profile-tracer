/**
 * Geometry utilities for Grasshopper
 * profile tracing.
 *
 * Coordinate system:
 *
 * Internal:
 *   x = rotation-axis direction
 *   r = radial distance
 *
 * Grasshopper output:
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
   * SCALE line projected onto
   * rotation-axis direction.
   *
   * Unit: pixel
   */
  axisPixel: number

  /**
   * Known physical cylinder
   * generatrix length.
   *
   * Unit: mm
   */
  realLengthMm: number

  /**
   * Physical scale.
   *
   * Unit: mm / px
   */
  scaleMmPerPx: number
}

/**
 * Normalize the rotation axis.
 *
 * A -> B defines positive X.
 */
export function normalizeAxis(
  pointA: Point,
  pointB: Point
): {
  direction: Point
  radialDirection: Point
} {
  const axisVector = {
    x:
      pointB.x -
      pointA.x,

    y:
      pointB.y -
      pointA.y,
  }

  const axisLength =
    Math.sqrt(
      axisVector.x *
        axisVector.x +
        axisVector.y *
          axisVector.y
    )

  if (
    axisLength === 0
  ) {
    throw new Error(
      'Axis points A and B cannot be identical'
    )
  }

  const direction = {
    x:
      axisVector.x /
      axisLength,

    y:
      axisVector.y /
      axisLength,
  }

  /**
   * 90° counterclockwise
   * perpendicular direction.
   */
  const radialDirection = {
    x:
      -direction.y,

    y:
      direction.x,
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
  b: Point
): number {
  return (
    a.x * b.x +
    a.y * b.y
  )
}

/**
 * Euclidean distance.
 */
export function distance(
  p1: Point,
  p2: Point
): number {
  const dx =
    p2.x - p1.x

  const dy =
    p2.y - p1.y

  return Math.sqrt(
    dx * dx +
      dy * dy
  )
}

/**
 * Project the SCALE line onto
 * the rotation-axis direction.
 *
 * IMPORTANT:
 *
 * The perpendicular component is
 * intentionally ignored.
 *
 * The resulting pixel length is
 * interpreted as the image length of
 * the known cylinder generatrix.
 *
 * Example:
 *
 * Axis:
 *
 *   ───────────────────→
 *
 * SCALE:
 *
 *   ╲──────────────────
 *
 * If the axis-parallel component
 * is 200 px, this function returns
 * 200 px regardless of the perpendicular
 * component.
 */
export function projectScaleToAxisDirection(
  scalePointA: Point,
  scalePointB: Point,
  axisDirection: Point
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
      axisDirection
    )
  )
}

/**
 * Calculate physical scale.
 *
 * Known physical cylinder generatrix
 * length [mm]
 * /
 * axis-parallel SCALE length [px]
 *
 * = mm / px
 */
export function calculateScale(
  realLengthMm: number,
  axisPixel: number
): number {
  if (
    axisPixel <= 0
  ) {
    throw new Error(
      'Projected SCALE length must be greater than 0'
    )
  }

  if (
    realLengthMm <= 0
  ) {
    throw new Error(
      'Cylinder generatrix length must be greater than 0'
    )
  }

  return (
    realLengthMm /
    axisPixel
  )
}

/**
 * Convert image point to
 * axis-local pixel coordinates.
 *
 * xPixel:
 *   parallel to rotation axis
 *
 * rPixel:
 *   perpendicular to rotation axis
 *
 * rPixel is always positive.
 */
export function toAxisLocalCoordinates(
  point: Point,
  axisPointA: Point,
  axisDirection: Point,
  radialDirection: Point
): {
  xPixel: number
  rPixel: number
} {
  const relative = {
    x:
      point.x -
      axisPointA.x,

    y:
      point.y -
      axisPointA.y,
  }

  /**
   * Axis direction → X.
   */
  const xPixel =
    dotProduct(
      relative,
      axisDirection
    )

  /**
   * Radial direction → radius.
   */
  const rPixelSigned =
    dotProduct(
      relative,
      radialDirection
    )

  const rPixel =
    Math.abs(
      rPixelSigned
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
  scaleMmPerPx: number
): number {
  return (
    pixel *
    scaleMmPerPx
  )
}

/**
 * Convert pixel-space profile point
 * into internal {x, r} millimeter data.
 */
export function pointToProfilePoint(
  point: Point,
  axisPointA: Point,
  axisDirection: Point,
  radialDirection: Point,
  scaleMmPerPx: number
): ProfilePoint {
  const {
    xPixel,
    rPixel,
  } =
    toAxisLocalCoordinates(
      point,
      axisPointA,
      axisDirection,
      radialDirection
    )

  return {
    x:
      pixelToMillimeter(
        xPixel,
        scaleMmPerPx
      ),

    r:
      pixelToMillimeter(
        rPixel,
        scaleMmPerPx
      ),
  }
}