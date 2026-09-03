'use client'

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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

  fixedFrame:
    | HTMLCanvasElement
    | null

  onFixedFrame: (
    frame:
      | HTMLCanvasElement
      | null
  ) => void

  onPoint?: (
    point: Point
  ) => void

  onTrace?: (
    point: Point
  ) => void

  tracing?: boolean

  overlays?: React.ReactNode

  fullScreen?: boolean
}

export const CameraCanvas =
  forwardRef<
    CameraCanvasHandle,
    Props
  >(
    function CameraCanvas(
      {
        stream,
        fixedFrame,
        onFixedFrame,
        onPoint,
        onTrace,
        tracing,
        overlays,
        fullScreen,
      },
      ref
    ) {
      const videoRef =
        useRef<HTMLVideoElement>(
          null
        )

      const frameRef =
        useRef<HTMLDivElement>(
          null
        )

      const drawing =
        useRef(false)

      /**
       * Native live-camera resolution.
       *
       * Temporary 16:9 until metadata
       * is available.
       */
      const [videoSize, setVideoSize] =
        useState({
          width: 16,
          height: 9,
        })

      /**
       * Connect MediaStream to video.
       */
      useEffect(() => {
        const video =
          videoRef.current

        if (!video) {
          return
        }

        video.srcObject =
          stream

        if (stream) {
          void video
            .play()
            .catch(() => {
              // Playback may require user gesture.
            })
        }
      }, [stream])

      /**
       * Read native video dimensions.
       */
      useEffect(() => {
        const video =
          videoRef.current

        if (!video) {
          return
        }

        const handleLoadedMetadata =
          () => {
            if (
              video.videoWidth > 0 &&
              video.videoHeight > 0
            ) {
              setVideoSize({
                width:
                  video.videoWidth,
                height:
                  video.videoHeight,
              })
            }
          }

        video.addEventListener(
          'loadedmetadata',
          handleLoadedMetadata
        )

        if (
          video.videoWidth > 0 &&
          video.videoHeight > 0
        ) {
          handleLoadedMetadata()
        }

        return () => {
          video.removeEventListener(
            'loadedmetadata',
            handleLoadedMetadata
          )
        }
      }, [stream])

      /**
       * Capture the native video frame.
       */
      useImperativeHandle(
        ref,
        () => ({
          capture: async () => {
            const video =
              videoRef.current

            if (
              !video ||
              video.videoWidth <= 0 ||
              video.videoHeight <= 0
            ) {
              return null
            }

            const frame =
              document.createElement(
                'canvas'
              )

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
              frame.height
            )

            onFixedFrame(frame)

            return {
              width:
                frame.width,
              height:
                frame.height,
            }
          },
        }),
        [onFixedFrame]
      )

      /**
       * Convert client coordinates
       * into native fixed-frame pixels.
       *
       * This uses the actual displayed
       * frame rectangle, so scrolling does
       * not affect the resulting coordinates.
       */
      const toLocal = (
        event: ReactPointerEvent<HTMLDivElement>
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

        const x =
          (event.clientX -
            rect.left) *
          frame.width /
          rect.width

        const y =
          (event.clientY -
            rect.top) *
          frame.height /
          rect.height

        /**
         * Do not clamp.
         *
         * Points outside the actual
         * frame are ignored.
         */
        if (
          x < 0 ||
          x > frame.width ||
          y < 0 ||
          y > frame.height
        ) {
          return null
        }

        return {
          x,
          y,
        }
      }

      /**
       * Start point selection / tracing.
       */
      const down = (
        event: ReactPointerEvent<HTMLDivElement>
      ) => {
        /**
         * Measurements are only available
         * after CAPTURE FRAME.
         */
        if (!fixedFrame) {
          return
        }

        event.currentTarget.setPointerCapture(
          event.pointerId
        )

        const point =
          toLocal(event)

        if (!point) {
          return
        }

        if (tracing) {
          drawing.current =
            true

          onTrace?.(point)
        } else {
          onPoint?.(point)
        }
      }

      /**
       * Continue tracing.
       */
      const move = (
        event: ReactPointerEvent<HTMLDivElement>
      ) => {
        if (
          !drawing.current
        ) {
          return
        }

        const point =
          toLocal(event)

        if (point) {
          onTrace?.(point)
        }
      }

      /**
       * End tracing.
       */
      const end = (
        event?: ReactPointerEvent<HTMLDivElement>
      ) => {
        drawing.current =
          false

        if (
          event &&
          event.currentTarget.hasPointerCapture(
            event.pointerId
          )
        ) {
          event.currentTarget.releasePointerCapture(
            event.pointerId
          )
        }
      }

      /**
       * Display dimensions.
       *
       * Live:
       *   native video dimensions
       *
       * Fixed:
       *   native captured-frame dimensions
       */
      const width =
        fixedFrame?.width ??
        videoSize.width

      const height =
        fixedFrame?.height ??
        videoSize.height

      return (
        <div
          className={
            fullScreen
              ? 'relative w-full overflow-visible bg-foreground/90'
              : 'relative w-full overflow-visible rounded-lg bg-foreground/90'
          }
        >

          {/*
           * IMPORTANT:
           *
           * Do NOT constrain this container
           * to 100dvh.
           *
           * The image determines its own height
           * from its aspect ratio.
           *
           * Therefore a tall camera frame can
           * extend beyond the viewport and the
           * page can scroll.
           */}
          <div
            ref={frameRef}
            className="relative mx-auto w-full"
            style={{
              aspectRatio:
                `${width} / ${height}`,
              maxWidth:
                '100%',
            }}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >

            {/* FIXED FRAME */}
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
                    node.getContext(
                      '2d'
                    )

                  if (!context) {
                    return
                  }

                  context.clearRect(
                    0,
                    0,
                    node.width,
                    node.height
                  )

                  context.drawImage(
                    fixedFrame,
                    0,
                    0,
                    node.width,
                    node.height
                  )
                }}
                className="absolute inset-0 size-full"
                aria-label="Fixed camera frame"
              />
            ) : (

              /* LIVE CAMERA */
              <video
                ref={videoRef}
                className="absolute inset-0 size-full object-contain"
                playsInline
                muted
                autoPlay
                aria-label="Live camera preview"
              />

            )}

            {/* OVERLAY */}
            <div className="pointer-events-none absolute inset-0">
              {overlays}
            </div>

          </div>
        </div>
      )
    }
  )

CameraCanvas.displayName =
  'CameraCanvas'