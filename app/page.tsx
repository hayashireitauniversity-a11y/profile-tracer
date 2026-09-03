'use client'

import { useMemo, useRef, useState } from 'react'
import {
  Camera,
  Check,
  Copy,
  RotateCcw,
  Trash2,
  SwitchCamera,
  Share2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

import {
  CameraCanvas,
  type CameraCanvasHandle,
} from '@/components/canvas/CameraCanvas'

import {
  calculateScale,
  normalizeAxis,
  pointToProfilePoint,
  projectScaleToAxisDirection,
  type Point,
} from '@/lib/geometry'

import { resampleByArcLength } from '@/lib/resampling'

import {
  copyText,
  generateCSV,
  generateGrasshopperPointList,
  generateJSON,
} from '@/lib/export'

type Step = 'AXIS' | 'SCALE' | 'PROFILE' | 'RESULT'

type Pair = {
  a: Point | null
  b: Point | null
}

const steps: Step[] = [
  'AXIS',
  'SCALE',
  'PROFILE',
  'RESULT',
]

/**
 * Drawing overlay
 *
 * All coordinates are Canvas-local coordinates.
 */
function Overlay({
  axis,
  scale,
  trace,
  width,
  height,
}: {
  axis: Pair
  scale: Pair
  trace: Point[]
  width: number
  height: number
}) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g vectorEffect="non-scaling-stroke">
        {axis.a && axis.b && (
          <>
            <line
              x1={axis.a.x}
              y1={axis.a.y}
              x2={axis.b.x}
              y2={axis.b.y}
              stroke="var(--primary)"
              strokeWidth="4"
              strokeLinecap="round"
            />

            <circle
              cx={axis.a.x}
              cy={axis.a.y}
              r="9"
              fill="var(--primary)"
            />

            <circle
              cx={axis.b.x}
              cy={axis.b.y}
              r="9"
              fill="var(--primary)"
            />
          </>
        )}

        {scale.a && scale.b && (
          <>
            <line
              x1={scale.a.x}
              y1={scale.a.y}
              x2={scale.b.x}
              y2={scale.b.y}
              stroke="var(--accent-foreground)"
              strokeWidth="4"
              strokeLinecap="round"
            />

            <circle
              cx={scale.a.x}
              cy={scale.a.y}
              r="7"
              fill="var(--accent-foreground)"
            />

            <circle
              cx={scale.b.x}
              cy={scale.b.y}
              r="7"
              fill="var(--accent-foreground)"
            />
          </>
        )}

        {trace.length > 1 && (
          <polyline
            points={trace
              .map((p) => `${p.x},${p.y}`)
              .join(' ')}
            fill="none"
            stroke="var(--accent-foreground)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </g>
    </svg>
  )
}

/**
 * Generate FreeFEM coordinate variables.
 *
 * Example:
 *
 * dx1=0.000000;
 * dy1=12.345678;
 * dx2=4.123456;
 * dy2=13.456789;
 * dx3=8.246912;
 * dy3=14.567890;
 *
 * x = profile.x
 * r = profile.r
 *
 * No additional coordinate transformation is applied here.
 */
function generateFreeFEMVariables(
  points: Array<{
    x: number
    r: number
  }>,
) {
  return points
    .map(
      (point, index) =>
        `dx${index + 1}=${point.x.toFixed(6)};\n` +
        `dy${index + 1}=${point.r.toFixed(6)};`,
    )
    .join('\n')
}

export default function Page() {
  const [stepIndex, setStepIndex] = useState(0)

  const [axis, setAxis] = useState<Pair>({
    a: null,
    b: null,
  })

  const [scalePoints, setScalePoints] =
    useState<Pair>({
      a: null,
      b: null,
    })

  const [trace, setTrace] =
    useState<Point[]>([])

  /**
   * Known physical length of the cylinder generatrix.
   *
   * This is NOT the diameter.
   */
  const [realLength, setRealLength] =
    useState('100')

  const [count, setCount] =
    useState('24')

  /**
   * TOP / BOTTOM is descriptive only.
   * It does not change the sign of radius.
   */
  const [side, setSide] =
    useState<'TOP' | 'BOTTOM'>('TOP')

  const [error, setError] =
    useState('')

  const [stream, setStream] =
    useState<MediaStream | null>(null)

  const [fixedFrame, setFixedFrame] =
    useState<HTMLCanvasElement | null>(null)

  const [captured, setCaptured] =
    useState(false)

  /**
   * environment = rear camera
   * user        = front camera
   */
  const [cameraFacing, setCameraFacing] =
    useState<
      'environment' | 'user'
    >('environment')

  const canvasRef =
    useRef<CameraCanvasHandle>(null)

  const step = steps[stepIndex]

  /**
   * Start camera.
   *
   * Use ideal facingMode first because some
   * iPad/Safari combinations reject exact
   * facingMode constraints.
   */
  const startCamera = async (
    facing:
      | 'environment'
      | 'user' = cameraFacing,
  ) => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError(
        'このブラウザではカメラを利用できません。',
      )
      return
    }

    try {
      /**
       * Stop the previous stream before
       * requesting another camera.
       */
      stream?.getTracks().forEach(
        (track) => {
          track.stop()
        },
      )

      let nextStream: MediaStream

      try {
        /**
         * Preferred camera.
         */
        nextStream =
          await navigator.mediaDevices.getUserMedia(
            {
              video: {
                facingMode: {
                  ideal: facing,
                },
              },
              audio: false,
            },
          )
      } catch (firstError) {
        console.warn(
          'Preferred camera request failed:',
          firstError,
        )

        /**
         * Fallback:
         * let the browser choose an available camera.
         */
        nextStream =
          await navigator.mediaDevices.getUserMedia(
            {
              video: true,
              audio: false,
            },
          )
      }

      setStream(nextStream)
      setCameraFacing(facing)
      setError('')
    } catch (cameraError) {
      console.error(
        'Camera error:',
        cameraError,
      )

      if (
        cameraError instanceof DOMException
      ) {
        setError(
          `カメラを開始できません。${cameraError.name}: ${cameraError.message}`,
        )
      } else {
        setError(
          'カメラを開始できません。HTTPSまたはカメラの使用許可を確認してください。',
        )
      }
    }
  }

  /**
   * Switch between front and rear cameras.
   *
   * Camera switching is intentionally disabled
   * after capture.
   *
   * The fixed frame must remain the
   * measurement basis.
   */
  const switchCamera = async () => {
    if (captured) {
      return
    }

    const nextFacing =
      cameraFacing === 'environment'
        ? 'user'
        : 'environment'

    await startCamera(nextFacing)
  }

  /**
   * Stop camera.
   */
  const stopCamera = () => {
    stream?.getTracks().forEach(
      (track) => {
        track.stop()
      },
    )

    setStream(null)
  }

  /**
   * Capture the native video frame.
   */
  const capture = async () => {
    const result =
      await canvasRef.current?.capture()

    if (result) {
      setCaptured(true)
      setError('')
    }
  }

  /**
   * Retake replaces the measurement frame.
   *
   * All geometry based on the old frame
   * is cleared.
   */
  const retake = () => {
    setFixedFrame(null)
    setCaptured(false)

    setAxis({
      a: null,
      b: null,
    })

    setScalePoints({
      a: null,
      b: null,
    })

    setTrace([])

    setStepIndex(0)

    setError('')
  }

  /**
   * AXIS mathematics.
   */
  const axisMath =
    axis.a && axis.b
      ? normalizeAxis(
          axis.a,
          axis.b,
        )
      : null

  /**
   * SCALE:
   *
   * The SCALE line itself may be diagonal.
   *
   * Only the component parallel to the
   * rotation axis is used for scaling.
   */
  const axisPixel =
    axisMath &&
    scalePoints.a &&
    scalePoints.b
      ? projectScaleToAxisDirection(
          scalePoints.a,
          scalePoints.b,
          axisMath.direction,
        )
      : 0

  /**
   * mm / pixel
   *
   * known physical generatrix length
   * --------------------------------
   * projected SCALE length in pixels
   */
  const scaleMmPerPx =
    axisPixel > 0 &&
    Number(realLength) > 0
      ? calculateScale(
          Number(realLength),
          axisPixel,
        )
      : 0

  /**
   * Convert the traced profile into
   * evenly spaced arc-length samples.
   */
  const profile = useMemo(() => {
    if (
      !axis.a ||
      !axisMath ||
      scaleMmPerPx <= 0 ||
      trace.length < 2
    ) {
      return []
    }

    const targetCount = Math.max(
      2,
      Number(count) || 0,
    )

    if (targetCount < 2) {
      return []
    }

    const sampled =
      resampleByArcLength(
        trace,
        targetCount,
      )

    return sampled.map(
      (point) =>
        pointToProfilePoint(
          point,
          axis.a!,
          axisMath.direction,
          axisMath.radialDirection,
          scaleMmPerPx,
        ),
    )
  }, [
    axis,
    axisMath,
    scaleMmPerPx,
    trace,
    count,
  ])

  /**
   * Handle a single point in AXIS / SCALE.
   */
  const point = (p: Point) => {
    if (step === 'AXIS') {
      setAxis((current) =>
        current.a
          ? {
              a: current.a,
              b: p,
            }
          : {
              a: p,
              b: null,
            },
      )

      return
    }

    if (step === 'SCALE') {
      setScalePoints(
        (current) =>
          current.a
            ? {
                a: current.a,
                b: p,
              }
            : {
                a: p,
                b: null,
              },
      )
    }
  }

  /**
   * Reset only the current drawing step.
   */
  const resetStep = () => {
    setError('')

    if (step === 'AXIS') {
      setAxis({
        a: null,
        b: null,
      })

      setScalePoints({
        a: null,
        b: null,
      })

      setTrace([])
    }

    if (step === 'SCALE') {
      setScalePoints({
        a: null,
        b: null,
      })

      setTrace([])
    }

    if (step === 'PROFILE') {
      setTrace([])
    }
  }

  /**
   * Move to the next step after validation.
   */
  const next = () => {
    setError('')

    if (!captured) {
      setError(
        '先にCAPTURE FRAMEを実行してください。',
      )
      return
    }

    if (
      step === 'AXIS' &&
      (!axisMath ||
        !axis.a ||
        !axis.b)
    ) {
      setError(
        'AXISの2点を指定してください。',
      )
      return
    }

    if (
      step === 'SCALE' &&
      (
        !scalePoints.a ||
        !scalePoints.b ||
        axisPixel <= 0 ||
        Number(realLength) <= 0
      )
    ) {
      setError(
        'SCALEの2点と円柱の母線長を確認してください。',
      )
      return
    }

    if (
      step === 'PROFILE' &&
      (
        trace.length < 2 ||
        Number(count) < 2 ||
        !scaleMmPerPx
      )
    ) {
      setError(
        'トレース点とサンプリング点数を確認してください。',
      )
      return
    }

    setStepIndex(
      (current) =>
        Math.min(3, current + 1),
    )
  }

  /**
   * Full application reset.
   */
  const reset = () => {
    stream?.getTracks().forEach(
      (track) => {
        track.stop()
      },
    )

    setStream(null)
    setFixedFrame(null)
    setCaptured(false)

    setStepIndex(0)

    setAxis({
      a: null,
      b: null,
    })

    setScalePoints({
      a: null,
      b: null,
    })

    setTrace([])

    setError('')
  }

  /**
   * Grasshopper point list.
   */
  const output =
    generateGrasshopperPointList(
      profile,
    )

  /**
   * JSON.
   */
  const json =
    generateJSON(profile)

  /**
   * CSV.
   */
  const csv =
    generateCSV(profile)

  /**
   * FreeFEM variables.
   *
   * These are generated from the same
   * final profile coordinates.
   *
   * Example:
   *
   * dx1=0.000000;
   * dy1=12.345678;
   * dx2=4.123456;
   * dy2=13.456789;
   */
  const freeFEM =
    generateFreeFEMVariables(
      profile,
    )

  /**
   * Copy text.
   */
  const copy = async (
    value: string,
  ) => {
    try {
      await copyText(value)

      setError(
        'コピーしました。',
      )
    } catch {
      setError(
        'コピーに失敗しました。',
      )
    }
  }

  /**
   * Share coordinates.
   *
   * On iPad/iPhone this opens the native
   * share sheet.
   *
   * The shared file is a plain-text file
   * specifically formatted for FreeFEM.
   */
  const shareCoordinates =
    async () => {
      if (!freeFEM) {
        setError(
          '共有する座標データがありません。',
        )
        return
      }

      if (!navigator.share) {
        setError(
          'このブラウザでは共有機能を利用できません。COPY CSVを使用してください。',
        )
        return
      }

      try {
        const blob =
          new Blob(
            [freeFEM],
            {
              type:
                'text/plain;charset=utf-8',
            },
          )

        const file =
          new File(
            [blob],
            'profile-coordinates.txt',
            {
              type: 'text/plain',
            },
          )

        /**
         * Preferred:
         * share the actual text file.
         */
        if (
          navigator.canShare &&
          navigator.canShare({
            files: [file],
          })
        ) {
          await navigator.share({
            title:
              'Profile Coordinates',
            text:
              'PROFILE TRACER / FreeFEM coordinates',
            files: [file],
          })

          setError('')
          return
        }

        /**
         * Fallback:
         * share the FreeFEM variables
         * directly as text.
         */
        await navigator.share({
          title:
            'Profile Coordinates',
          text: freeFEM,
        })

        setError('')
      } catch (shareError) {
        /**
         * Closing the native share sheet
         * is not an actual error.
         */
        if (
          shareError instanceof DOMException &&
          shareError.name ===
            'AbortError'
        ) {
          return
        }

        console.error(
          'Share error:',
          shareError,
        )

        setError(
          '共有できませんでした。COPY CSVを使用してください。',
        )
      }
    }

  /**
   * The drawing surface is always the
   * main visual area.
   *
   * The control panel is BELOW it,
   * never over it.
   */
  return (
    <main className="min-h-screen bg-background">
      {/* HEADER */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="font-mono text-xs font-bold tracking-[.2em] text-primary">
              GRASSHOPPER / PROFILE TRACER
            </p>

            <h1 className="mt-1 text-2xl font-semibold">
              Human-made geometry, ready for the next move.
            </h1>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            aria-label="Reset"
          >
            <RotateCcw />
          </Button>
        </div>
      </header>

      {/* WORKFLOW */}
      <nav
        className="mx-auto flex max-w-[1400px] gap-3 overflow-x-auto px-6 py-5"
        aria-label="Workflow steps"
      >
        {steps.map(
          (item, index) => (
            <div
              key={item}
              className={`flex min-w-[150px] flex-1 items-center gap-3 rounded-lg border px-4 py-3 ${
                index === stepIndex
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card'
              }`}
            >
              <span className="font-mono text-xs font-bold">
                0{index + 1}
              </span>

              <span className="font-semibold">
                {index <
                  stepIndex && (
                  <Check className="mr-1 inline size-4" />
                )}

                {item}
              </span>
            </div>
          ),
        )}
      </nav>

      {/* MAIN */}
      <section className="mx-auto flex max-w-[1400px] flex-col gap-6 px-6 pb-10">
        {/* CAMERA / FIXED FRAME */}
        <div className="rounded-xl border border-border bg-card p-3">
          <CameraCanvas
            ref={canvasRef}
            stream={stream}
            fixedFrame={fixedFrame}
            onFixedFrame={
              setFixedFrame
            }
            onPoint={point}
            tracing={
              step === 'PROFILE'
            }
            onTrace={(p) =>
              setTrace(
                (current) => [
                  ...current,
                  p,
                ],
              )
            }
            overlays={
              <Overlay
                axis={axis}
                scale={
                  scalePoints
                }
                trace={trace}
                width={
                  fixedFrame?.width ??
                  16
                }
                height={
                  fixedFrame?.height ??
                  9
                }
              />
            }
          />
        </div>

        {/* CONTROLS */}
        <aside className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6">
          <div>
            <p className="font-mono text-xs font-bold tracking-[.2em] text-muted-foreground">
              STEP 0{stepIndex + 1}
            </p>

            <h2 className="mt-2 text-4xl font-semibold">
              {step}
            </h2>

            <p className="mt-3 leading-6 text-muted-foreground">
              {step ===
                'AXIS' &&
                '回転軸の両端を2点タップしてください'}

              {step ===
                'SCALE' &&
                '円柱の母線方向に対応する線分を2点タップしてください'}

              {step ===
                'PROFILE' &&
                'TOPまたはBOTTOMを選択し、輪郭を指でなぞってください'}

              {step ===
                'RESULT' &&
                '取得した断面座標を確認・出力できます'}
            </p>
          </div>

          {/* CAMERA CONTROLS */}
          <div className="flex flex-wrap gap-2">
            {!stream &&
              !captured && (
                <Button
                  onClick={() =>
                    startCamera()
                  }
                >
                  <Camera data-icon="inline-start" />
                  START CAMERA
                </Button>
              )}

            {stream &&
              !captured && (
                <>
                  <Button
                    onClick={
                      capture
                    }
                  >
                    CAPTURE FRAME
                  </Button>

                  <Button
                    variant="outline"
                    onClick={
                      switchCamera
                    }
                    aria-label={
                      cameraFacing ===
                      'environment'
                        ? 'Switch to front camera'
                        : 'Switch to rear camera'
                    }
                  >
                    <SwitchCamera data-icon="inline-start" />
                    SWITCH CAMERA
                  </Button>
                </>
              )}

            {captured && (
              <Button
                variant="outline"
                onClick={
                  retake
                }
              >
                RETAKE
              </Button>
            )}

            {stream && (
              <Button
                variant="outline"
                onClick={
                  stopCamera
                }
              >
                STOP CAMERA
              </Button>
            )}

            {(step ===
              'AXIS' ||
              step ===
                'SCALE' ||
              step ===
                'PROFILE') && (
              <Button
                variant="outline"
                onClick={
                  resetStep
                }
              >
                <Trash2 data-icon="inline-start" />
                RESET {step}
              </Button>
            )}
          </div>

          {/* SCALE */}
          {step ===
            'SCALE' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <span className="text-xs text-muted-foreground">
                  PROJECTED SCALE
                </span>

                <strong className="block text-xl">
                  {Math.round(
                    axisPixel,
                  )}{' '}
                  px
                </strong>

                <p className="mt-1 text-xs text-muted-foreground">
                  AXIS方向への投影長
                </p>
              </div>

              <label className="text-xs text-muted-foreground">
                CYLINDER GENERATRIX

                <input
                  className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                  value={
                    realLength
                  }
                  onChange={(
                    event,
                  ) =>
                    setRealLength(
                      event.target
                        .value,
                    )
                  }
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                />

                <span className="mt-1 block">
                  mm
                </span>
              </label>

              {scaleMmPerPx >
                0 && (
                <div className="sm:col-span-2">
                  <span className="text-xs text-muted-foreground">
                    SCALE
                  </span>

                  <strong className="block text-xl">
                    {scaleMmPerPx.toFixed(
                      4,
                    )}{' '}
                    mm / px
                  </strong>
                </div>
              )}
            </div>
          )}

          {/* PROFILE */}
          {step ===
            'PROFILE' && (
            <div className="flex flex-wrap items-end gap-2">
              <Button
                variant={
                  side ===
                  'TOP'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSide(
                    'TOP',
                  )
                }
              >
                TOP
              </Button>

              <Button
                variant={
                  side ===
                  'BOTTOM'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSide(
                    'BOTTOM',
                  )
                }
              >
                BOTTOM
              </Button>

              <label className="ml-auto text-xs text-muted-foreground">
                POINTS

                <input
                  className="mt-1 h-11 w-20 rounded-md border border-input bg-background px-3 text-base text-foreground"
                  value={count}
                  onChange={(
                    event,
                  ) =>
                    setCount(
                      event.target
                        .value,
                    )
                  }
                  type="number"
                  min="2"
                  step="1"
                  inputMode="numeric"
                />
              </label>
            </div>
          )}

          {/* RESULT */}
          {step ===
            'RESULT' && (
            <div className="flex flex-col gap-3">
              <div>
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  GRASSHOPPER POINT LIST
                </p>

                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">
                  {output ||
                    'No points'}
                </pre>
              </div>

              <Button
                onClick={() =>
                  copy(output)
                }
                disabled={!output}
              >
                <Copy data-icon="inline-start" />
                COPY
              </Button>

              <Button
                variant="outline"
                onClick={
                  shareCoordinates
                }
                disabled={!freeFEM}
              >
                <Share2 data-icon="inline-start" />
                SHARE / AIRDROP
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  copy(json)
                }
                disabled={!json}
              >
                COPY JSON
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  copy(csv)
                }
                disabled={!csv}
              >
                COPY CSV
              </Button>
            </div>
          )}

          {/* ERROR / MESSAGE */}
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {/* NAVIGATION */}
          <div className="flex justify-between gap-3 border-t border-border pt-5">
            <Button
              variant="outline"
              disabled={
                stepIndex === 0
              }
              onClick={() =>
                setStepIndex(
                  (current) =>
                    current - 1,
                )
              }
            >
              BACK
            </Button>

            <Button
              onClick={next}
              disabled={
                stepIndex === 3
              }
            >
              NEXT
            </Button>
          </div>
        </aside>
      </section>
    </main>
  )
}