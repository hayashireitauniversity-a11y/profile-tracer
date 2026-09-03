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

  onFixedFrame: (
    frame: HTMLCanvasElement | null,
  ) => void

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

  const drawing =
    useRef(false)

  /**
   * Capture the exact native video frame.
   *
   * The measurement coordinate system is based on
   * videoWidth / videoHeight, not CSS pixels.
   */
  useImperativeHandle(
    ref,
    () => ({
      capture: async () => {
        const video = videoRef.current

        if (
          !video ||
          !video.videoWidth ||
          !video.videoHeight
        ) {
          return null
        }

        const frame =
          document.createElement('canvas')

        frame.width = video.videoWidth
        frame.height = video.videoHeight

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

  /**
   * Attach MediaStream to the video element.
   */
  useEffect(() => {
    const video = videoRef.current

    if (!video) {
      return
    }

    video.srcObject = null

    if (!stream) {
      return
    }

    video.srcObject = stream

    const playVideo = async () => {
      try {
        await video.play()
      } catch (error) {
        console.warn(
          'Video autoplay/play failed:',
          error,
        )
      }
    }

    void playVideo()
  }, [stream])

  /**
   * Stop the stream when this component is unmounted.
   */
  useEffect(() => {
    return () => {
      const current =
        videoRef.current?.srcObject as
          | MediaStream
          | null

      current
        ?.getTracks()
        .forEach((track) => {
          track.stop()
        })
    }
  }, [])

  /**
   * Convert pointer/client coordinates
   * into fixed-frame Canvas coordinates.
   *
   * IMPORTANT:
   * No CSS/client coordinates are stored.
   */
  const toLocal = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): Point | null => {
    const frame = fixedFrame
    const layer = frameRef.current

    if (!frame || !layer) {
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

    /**
     * Ignore pointer events outside
     * the displayed frame.
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
        (frame.width / rect.width),

      y:
        localY *
        (frame.height / rect.height),
    }
  }

  const down = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!fixedFrame) {
      return
    }

    event.currentTarget.setPointerCapture(
      event.pointerId,
    )

    const point = toLocal(event)

    if (!point) {
      return
    }

    if (tracing) {
      drawing.current = true

      onTrace?.(point)

      return
    }

    onPoint?.(point)
  }

  const move = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!drawing.current) {
      return
    }

    const point = toLocal(event)

    if (point) {
      onTrace?.(point)
    }
  }

  const stopDrawing = () => {
    drawing.current = false
  }

  const width =
    fixedFrame?.width ?? 16

  const height =
    fixedFrame?.height ?? 9

  return (
    <div className="relative w-full overflow-hidden rounded-lg bg-foreground/90">
      <div
        ref={frameRef}
        className="relative mx-auto w-full max-w-full"
        style={{
          aspectRatio: `${width} / ${height}`,
          touchAction: 'none',
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={stopDrawing}
        onPointerCancel={stopDrawing}
        onPointerLeave={stopDrawing}
      >
        {fixedFrame ? (
          <canvas
            ref={(node) => {
              if (!node) {
                return
              }

              node.width = fixedFrame.width
              node.height = fixedFrame.height

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
          />
        ) : (
          <video
            ref={videoRef}
            className="absolute inset-0 size-full object-contain"
            playsInline
            muted
            autoPlay
            aria-label="Live camera preview"
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