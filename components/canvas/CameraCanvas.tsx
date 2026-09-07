'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import type { Point } from '@/lib/geometry'

export type CameraCanvasHandle = {
  capture: () => Promise<{
    width: number
    height: number
  } | null>
}

type Props = {
  stream: MediaStream | null
  fixedFrame: HTMLCanvasElement | null
  onFixedFrame: (frame: HTMLCanvasElement | null) => void
  onPoint?: (point: Point) => void
  onTrace?: (point: Point) => void
  tracing?: boolean
  overlays?: React.ReactNode
}

export const CameraCanvas = forwardRef<
  CameraCanvasHandle,
  Props
>(function CameraCanvas(
  {
    stream,
    fixedFrame,
    onFixedFrame,
    onPoint,
    onTrace,
    tracing,
    overlays,
  },
  ref,
) {
  const videoRef =
    useRef<HTMLVideoElement>(null)

  const frameRef =
    useRef<HTMLDivElement>(null)

  /*
   * True while the pointer is physically down.
   *
   * This is especially important for Apple Pencil.
   */
  const drawing =
    useRef(false)

  /*
   * Pointer ID currently drawing.
   *
   * Prevents another pointer from accidentally
   * modifying the trace.
   */
  const activePointerId =
    useRef<number | null>(null)

  /*
   * The latest point received from the pointer.
   */
  const pendingPoint =
    useRef<Point | null>(null)

  /*
   * requestAnimationFrame ID.
   *
   * PointerMove can fire much more frequently than
   * React needs to re-render.
   */
  const frameRequest =
    useRef<number | null>(null)

  /*
   * Keep the latest onTrace callback without
   * forcing pointer handlers to be recreated.
   */
  const onTraceRef =
    useRef(onTrace)

  useEffect(() => {
    onTraceRef.current = onTrace
  }, [onTrace])

  /*
   * ---------------------------------------------------------
   * CAPTURE
   * ---------------------------------------------------------
   */
  useImperativeHandle(
    ref,
    () => ({
      capture: async () => {
        const video =
          videoRef.current

        if (
          !video ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          return null
        }

        const frame =
          document.createElement('canvas')

        frame.width =
          video.videoWidth

        frame.height =
          video.videoHeight

        const context =
          frame.getContext('2d')

        if (!context) {
          return null
        }

        context.drawImage(
          video,
          0,
          0,
          frame.width,
          frame.height,
        )

        onFixedFrame(frame)

        return {
          width: frame.width,
          height: frame.height,
        }
      },
    }),
    [onFixedFrame],
  )

  /*
   * ---------------------------------------------------------
   * VIDEO STREAM
   * ---------------------------------------------------------
   */
  useEffect(() => {
    const video =
      videoRef.current

    if (!video) {
      return
    }

    video.srcObject = stream

    if (stream) {
      void video.play().catch(() => {})
    }
  }, [stream])

  /*
   * ---------------------------------------------------------
   * CLEANUP
   * ---------------------------------------------------------
   */
  useEffect(() => {
    return () => {
      const current =
        videoRef.current
          ?.srcObject as
          | MediaStream
          | null

      current
        ?.getTracks()
        .forEach((track) =>
          track.stop(),
        )

      if (
        frameRequest.current !== null
      ) {
        cancelAnimationFrame(
          frameRequest.current,
        )
      }
    }
  }, [])

  /*
   * ---------------------------------------------------------
   * CONVERT POINTER COORDINATES
   *
   * Client coordinates
   *        ↓
   * displayed frame coordinates
   *        ↓
   * native captured-frame coordinates
   *
   * Points stored by the app are ALWAYS in
   * captured-frame coordinates.
   * ---------------------------------------------------------
   */
  const toLocal = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): Point | null => {
    const frame =
      fixedFrame

    const layer =
      frameRef.current

    if (
      !frame ||
      !layer
    ) {
      return null
    }

    const rect =
      layer.getBoundingClientRect()

    if (
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      return null
    }

    const localX =
      event.clientX - rect.left

    const localY =
      event.clientY - rect.top

    /*
     * Do NOT clamp points outside the image.
     *
     * If the Pencil leaves the frame,
     * simply ignore that point.
     */
    if (
      localX < 0 ||
      localY < 0 ||
      localX > rect.width ||
      localY > rect.height
    ) {
      return null
    }

    return {
      x:
        localX *
        (frame.width /
          rect.width),

      y:
        localY *
        (frame.height /
          rect.height),
    }
  }

  /*
   * ---------------------------------------------------------
   * FLUSH PENDING TRACE POINT
   *
   * React state is updated at most once per animation frame.
   *
   * This prevents hundreds of React renders per second
   * while the Apple Pencil is moving.
   * ---------------------------------------------------------
   */
  const flushTrace = () => {
    frameRequest.current =
      null

    const point =
      pendingPoint.current

    if (!point) {
      return
    }

    pendingPoint.current =
      null

    onTraceRef.current?.(
      point,
    )
  }

  /*
   * ---------------------------------------------------------
   * QUEUE TRACE POINT
   * ---------------------------------------------------------
   */
  const queueTracePoint = (
    point: Point,
  ) => {
    pendingPoint.current =
      point

    if (
      frameRequest.current !==
      null
    ) {
      return
    }

    frameRequest.current =
      requestAnimationFrame(
        flushTrace,
      )
  }

  /*
   * ---------------------------------------------------------
   * POINTER DOWN
   * ---------------------------------------------------------
   */
  const down = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!fixedFrame) {
      return
    }

    /*
     * PROFILE:
     *
     * Pencil/finger becomes the active drawing pointer.
     */
    if (tracing) {
      /*
       * Ignore additional pointers.
       */
      if (
        activePointerId.current !==
          null
      ) {
        return
      }

      /*
       * Prevent browser gestures.
       */
      event.preventDefault()

      /*
       * Capture the pointer so that
       * PointerMove continues to arrive
       * even if the Pencil moves quickly.
       */
      event.currentTarget.setPointerCapture(
        event.pointerId,
      )

      activePointerId.current =
        event.pointerId

      drawing.current =
        true

      const point =
        toLocal(event)

      if (point) {
        /*
         * IMPORTANT:
         *
         * The very first Pencil position is
         * immediately recorded.
         */
        onTraceRef.current?.(
          point,
        )
      }

      return
    }

    /*
     * AXIS / SCALE:
     *
     * These remain simple two-point taps.
     */
    event.preventDefault()

    const point =
      toLocal(event)

    if (!point) {
      return
    }

    onPoint?.(point)
  }

  /*
   * ---------------------------------------------------------
   * POINTER MOVE
   * ---------------------------------------------------------
   */
  const move = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!tracing) {
      return
    }

    /*
     * Only the active Pencil/touch may draw.
     */
    if (
      !drawing.current ||
      activePointerId.current !==
        event.pointerId
    ) {
      return
    }

    event.preventDefault()

    const point =
      toLocal(event)

    if (!point) {
      return
    }

    /*
     * Queue the latest point instead of
     * immediately causing a React render.
     */
    queueTracePoint(point)
  }

  /*
   * ---------------------------------------------------------
   * END DRAWING
   * ---------------------------------------------------------
   */
  const stopDrawing = (
    event?: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (
      event &&
      activePointerId.current !==
        event.pointerId
    ) {
      return
    }

    drawing.current =
      false

    activePointerId.current =
      null

    /*
     * Flush the final point immediately.
     */
    if (
      frameRequest.current !==
      null
    ) {
      cancelAnimationFrame(
        frameRequest.current,
      )

      frameRequest.current =
        null
    }

    const finalPoint =
      pendingPoint.current

    pendingPoint.current =
      null

    if (finalPoint) {
      onTraceRef.current?.(
        finalPoint,
      )
    }

    /*
     * Release pointer capture.
     */
    if (
      event &&
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      )
    }
  }

  /*
   * ---------------------------------------------------------
   * FRAME SIZE
   * ---------------------------------------------------------
   */
  const width =
    fixedFrame?.width ?? 16

  const height =
    fixedFrame?.height ?? 9

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */
  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-foreground/90">
      <div
        ref={frameRef}
        className="relative mx-auto w-full max-w-full"
        style={{
          aspectRatio:
            `${width} / ${height}`,

          /*
           * CRITICAL FOR IPAD / APPLE PENCIL
           *
           * Prevent:
           * - page scrolling
           * - browser panning
           * - pinch gesture interference
           *
           * while drawing.
           */
          touchAction: 'none',

          /*
           * Prevent text selection during tracing.
           */
          userSelect: 'none',

          /*
           * Prevent native drag behavior.
           */
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onLostPointerCapture={() => {
          /*
           * If Safari unexpectedly releases
           * the pointer capture, terminate
           * the current stroke cleanly.
           */
          drawing.current =
            false

          activePointerId.current =
            null

          pendingPoint.current =
            null

          if (
            frameRequest.current !==
            null
          ) {
            cancelAnimationFrame(
              frameRequest.current,
            )

            frameRequest.current =
              null
          }
        }}
      >
        {fixedFrame ? (
          <canvas
            ref={(node) => {
              if (!node) {
                return
              }

              node.width =
                fixedFrame.width

              node.height =
                fixedFrame.height

              const context =
                node.getContext('2d')

              if (!context) {
                return
              }

              context.clearRect(
                0,
                0,
                node.width,
                node.height,
              )

              context.drawImage(
                fixedFrame,
                0,
                0,
              )
            }}
            className="absolute inset-0 size-full"
            aria-label="Fixed camera frame"
            draggable={false}
          />
        ) : (
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-contain"
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview"
            draggable={false}
          />
        )}

        <div className="pointer-events-none absolute inset-0">
          {overlays}
        </div>
      </div>
    </div>
  )
})

CameraCanvas.displayName =
  'CameraCanvas'