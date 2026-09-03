'use client'

import {
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  Camera,
  Check,
  Copy,
  RotateCcw,
  RefreshCw,
  Trash2,
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

type Step =
  | 'AXIS'
  | 'SCALE'
  | 'PROFILE'
  | 'RESULT'

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

        {/* AXIS */}
        {axis.a && axis.b && (
          <>
            <line
              x1={axis.a.x}
              y1={axis.a.y}
              x2={axis.b.x}
              y2={axis.b.y}
              stroke="var(--primary)"
              strokeWidth="4"
            />

            <circle
              cx={axis.a.x}
              cy={axis.a.y}
              r="8"
              fill="var(--primary)"
            />

            <circle
              cx={axis.b.x}
              cy={axis.b.y}
              r="8"
              fill="var(--primary)"
            />
          </>
        )}

        {/* SCALE */}
        {scale.a && scale.b && (
          <>
            <line
              x1={scale.a.x}
              y1={scale.a.y}
              x2={scale.b.x}
              y2={scale.b.y}
              stroke="var(--accent-foreground)"
              strokeWidth="4"
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

        {/* PROFILE */}
        {trace.length > 1 && (
          <polyline
            points={trace
              .map(
                (p) => `${p.x},${p.y}`
              )
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

export default function Page() {
  const [stepIndex, setStepIndex] =
    useState(0)

  const [axis, setAxis] =
    useState<Pair>({
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
   * Known physical cylinder generatrix length.
   *
   * IMPORTANT:
   * This is NOT diameter.
   */
  const [realLength, setRealLength] =
    useState('100')

  const [count, setCount] =
    useState('24')

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
   * Current camera:
   *
   * environment = rear camera
   * user        = front camera
   */
  const [cameraFacing, setCameraFacing] =
    useState<'environment' | 'user'>(
      'environment'
    )

  const canvasRef =
    useRef<CameraCanvasHandle>(null)

  const step = steps[stepIndex]

  /**
   * Start camera.
   *
   * Camera selection:
   *
   * 1. exact facingMode
   * 2. ideal facingMode
   * 3. any available camera
   *
   * This avoids making the application
   * unusable on devices where a requested
   * facingMode cannot be satisfied.
   */
  const startCamera = async (
    facing: 'environment' | 'user' = cameraFacing
  ) => {
    try {
      if (
        typeof window === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setError(
          'この環境ではカメラを使用できません。HTTPSまたはlocalhostでアクセスしてください。'
        )
        return
      }

      let next: MediaStream

      try {
        next =
          await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: {
                exact: facing,
              },
            },
            audio: false,
          })
      } catch {
        try {
          next =
            await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: {
                  ideal: facing,
                },
              },
              audio: false,
            })
        } catch {
          next =
            await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            })
        }
      }

      /**
       * Stop the previous stream only after
       * a new stream has successfully started.
       */
      stream
        ?.getTracks()
        .forEach((track) => track.stop())

      setStream(next)
      setCameraFacing(facing)
      setError('')
    } catch (cameraError) {
      const name =
        cameraError instanceof DOMException
          ? cameraError.name
          : ''

      if (
        name === 'NotAllowedError'
      ) {
        setError(
          'カメラの使用が許可されていません。ブラウザのカメラ権限を確認してください。'
        )
      } else if (
        name === 'NotFoundError'
      ) {
        setError(
          '使用可能なカメラが見つかりません。'
        )
      } else if (
        name === 'NotReadableError'
      ) {
        setError(
          'カメラを使用できません。他のアプリがカメラを使用していないか確認してください。'
        )
      } else if (
        name === 'SecurityError'
      ) {
        setError(
          'カメラはHTTPSまたはlocalhostでのみ使用できます。'
        )
      } else {
        setError(
          'カメラを開始できません。'
        )
      }
    }
  }

  /**
   * Switch between rear and front camera.
   *
   * Existing measurement data is NOT changed.
   *
   * The new camera becomes the measurement
   * source only after CAPTURE FRAME.
   */
  const switchCamera = async () => {
    const nextFacing =
      cameraFacing === 'environment'
        ? 'user'
        : 'environment'

    await startCamera(
      nextFacing
    )
  }

  /**
   * Stop camera.
   *
   * Measurement data remains intact.
   * The live/fixed camera frame is removed.
   */
  const stopCamera = () => {
    stream
      ?.getTracks()
      .forEach((track) => track.stop())

    setStream(null)
    setFixedFrame(null)
    setCaptured(false)
  }

  /**
   * Capture current camera frame.
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
   * Return to live camera and discard
   * the current measurement frame/data.
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
   * Calculate axis direction.
   */
  const axisMath =
    axis.a && axis.b
      ? normalizeAxis(
          axis.a,
          axis.b
        )
      : null

  /**
   * SCALE:
   *
   * Project the SCALE line onto the
   * rotation-axis direction.
   *
   * This projected length is the pixel
   * representation of the known cylinder
   * generatrix length.
   */
  const scalePixel =
    axisMath &&
    scalePoints.a &&
    scalePoints.b
      ? projectScaleToAxisDirection(
          scalePoints.a,
          scalePoints.b,
          axisMath.direction
        )
      : 0

  /**
   * Physical scale:
   *
   * known generatrix length [mm]
   * /
   * axis-parallel SCALE length [px]
   *
   * = mm / px
   */
  const scaleMmPerPx =
    scalePixel > 0 &&
    Number(realLength) > 0
      ? calculateScale(
          Number(realLength),
          scalePixel
        )
      : 0

  /**
   * Convert traced profile into
   * evenly spaced profile points.
   */
  const profile = useMemo(() => {
    if (
      !axis.a ||
      !axisMath ||
      scaleMmPerPx <= 0 ||
      trace.length <= 1
    ) {
      return []
    }

    const targetCount =
      Math.max(
        2,
        Number(count)
      )

    return resampleByArcLength(
      trace,
      targetCount
    ).map((p) =>
      pointToProfilePoint(
        p,
        axis.a!,
        axisMath.direction,
        axisMath.radialDirection,
        scaleMmPerPx
      )
    )
  }, [
    axis,
    axisMath,
    scaleMmPerPx,
    trace,
    count,
  ])

  /**
   * Handle AXIS / SCALE point selection.
   */
  const point = (p: Point) => {
    if (step === 'AXIS') {
      setAxis((value) =>
        value.a
          ? {
              a: value.a,
              b: p,
            }
          : {
              a: p,
              b: null,
            }
      )

      /**
       * Changing AXIS invalidates SCALE
       * and PROFILE.
       */
      setScalePoints({
        a: null,
        b: null,
      })

      setTrace([])

      return
    }

    if (step === 'SCALE') {
      setScalePoints((value) =>
        value.a
          ? {
              a: value.a,
              b: p,
            }
          : {
              a: p,
              b: null,
            }
      )

      /**
       * Changing SCALE invalidates PROFILE.
       */
      setTrace([])

      return
    }
  }

  /**
   * Trace callback.
   */
  const tracePoint = (
    p: Point
  ) => {
    setTrace(
      (value) => [
        ...value,
        p,
      ]
    )
  }

  /**
   * Reset current step.
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

      return
    }

    if (step === 'SCALE') {
      setScalePoints({
        a: null,
        b: null,
      })

      setTrace([])

      return
    }

    if (step === 'PROFILE') {
      setTrace([])

      return
    }
  }

  /**
   * Validate and go to next step.
   */
  const next = () => {
    setError('')

    if (!captured) {
      setError(
        '先にCAPTURE FRAMEを実行してください。'
      )
      return
    }

    if (
      step === 'AXIS' &&
      (
        !axisMath ||
        !axis.a ||
        !axis.b
      )
    ) {
      setError(
        'AXISの2点を指定してください。'
      )
      return
    }

    if (
      step === 'SCALE' &&
      (
        !scalePoints.a ||
        !scalePoints.b ||
        scalePixel <= 0 ||
        Number(realLength) <= 0
      )
    ) {
      setError(
        'SCALEの2点と円柱の母線長を確認してください。'
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
        'トレース点とサンプリング点数を確認してください。'
      )
      return
    }

    setStepIndex(
      (index) =>
        Math.min(
          3,
          index + 1
        )
    )
  }

  /**
   * Global reset.
   */
  const reset = () => {
    stream
      ?.getTracks()
      .forEach((track) => track.stop())

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

    setCameraFacing(
      'environment'
    )

    setError('')
  }

  /**
   * Export.
   *
   * Grasshopper:
   *
   * X = axis direction
   * Y = 0
   * Z = radius
   */
  const output =
    generateGrasshopperPointList(
      profile
    )

  const json =
    generateJSON(profile)

  const csv =
    generateCSV(profile)

  /**
   * Copy text.
   */
  const copy = async (
    value: string
  ) => {
    try {
      await copyText(value)
      setError('コピーしました。')
    } catch {
      setError(
        'コピーに失敗しました。'
      )
    }
  }

  const full =
    step !== 'RESULT'

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

      {/* STEP INDICATOR */}
      <nav
        className="mx-auto flex max-w-[1400px] gap-3 px-6 py-5"
        aria-label="Workflow steps"
      >
        {steps.map(
          (item, index) => (
            <div
              key={item}
              className={`flex flex-1 items-center gap-3 rounded-lg border px-4 py-3 ${
                index === stepIndex
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card'
              }`}
            >
              <span className="font-mono text-xs font-bold">
                0{index + 1}
              </span>

              <span className="font-semibold">
                {index < stepIndex && (
                  <Check className="mr-1 inline" />
                )}

                {item}
              </span>
            </div>
          )
        )}
      </nav>

      {/* MAIN */}
      <section
        className={
          full
            ? 'relative min-h-[calc(100dvh-145px)]'
            : 'mx-auto grid max-w-[1400px] gap-6 px-6 pb-8 lg:grid-cols-[1fr_360px]'
        }
      >

        {/* CAMERA */}
        <div
          className={
            full
              ? 'relative w-full'
              : 'rounded-xl border border-border bg-card p-3'
          }
        >
          <CameraCanvas
            ref={canvasRef}
            stream={stream}
            fixedFrame={fixedFrame}
            onFixedFrame={setFixedFrame}
            onPoint={point}
            tracing={
              step === 'PROFILE'
            }
            onTrace={tracePoint}
            overlays={
              <Overlay
                axis={axis}
                scale={scalePoints}
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
            fullScreen={full}
          />
        </div>

        {/* CONTROL PANEL */}
        <aside
          className={
            full
              ? 'absolute left-4 right-4 top-4 z-10 flex max-w-md flex-col gap-4 rounded-xl border border-border bg-card/95 p-5 shadow-lg backdrop-blur'
              : 'flex flex-col gap-5 rounded-xl border border-border bg-card p-6'
          }
        >

          {/* DESCRIPTION */}
          <div>
            <p className="font-mono text-xs font-bold tracking-[.2em] text-muted-foreground">
              STEP 0{stepIndex + 1}
            </p>

            <h2 className="mt-2 text-4xl font-semibold">
              {step}
            </h2>

            <p className="mt-3 leading-6 text-muted-foreground">
              {step === 'AXIS' &&
                '回転軸の両端を2点タップしてください。A→Bが正のX方向になります。'}

              {step === 'SCALE' &&
                '既知の円柱母線に沿って2点をタップしてください。回転軸に平行な成分を入力した母線長と対応させます。'}

              {step === 'PROFILE' &&
                'TOPまたはBOTTOMを選択し、輪郭を指でなぞってください。'}

              {step === 'RESULT' &&
                '取得した断面座標を確認・出力できます。'}
            </p>
          </div>

          {/* CAMERA CONTROLS */}
          <div className="flex flex-wrap gap-2">

            {!stream && (
              <Button
                onClick={() =>
                  startCamera(
                    cameraFacing
                  )
                }
              >
                <Camera data-icon="inline-start" />
                START CAMERA
              </Button>
            )}

            {stream && !captured && (
              <Button
                onClick={capture}
              >
                CAPTURE FRAME
              </Button>
            )}

            {stream && !captured && (
              <Button
                variant="outline"
                onClick={switchCamera}
              >
                <RefreshCw data-icon="inline-start" />
                SWITCH CAMERA
              </Button>
            )}

            {captured && (
              <Button
                variant="outline"
                onClick={retake}
              >
                RETAKE
              </Button>
            )}

            {stream && (
              <Button
                variant="outline"
                onClick={stopCamera}
              >
                STOP CAMERA
              </Button>
            )}

            {(step === 'AXIS' ||
              step === 'SCALE' ||
              step === 'PROFILE') && (
              <Button
                variant="outline"
                onClick={resetStep}
              >
                <Trash2 data-icon="inline-start" />
                RESET {step}
              </Button>
            )}

          </div>

          {/* CURRENT CAMERA */}
          {stream && !captured && (
            <div className="text-xs text-muted-foreground">
              CAMERA:{' '}
              <strong className="text-foreground">
                {cameraFacing ===
                'environment'
                  ? 'REAR'
                  : 'FRONT'}
              </strong>
            </div>
          )}

          {/* SCALE */}
          {step === 'SCALE' && (
            <div className="space-y-4">

              <div className="rounded-lg border border-border p-3">
                <span className="text-xs text-muted-foreground">
                  AXIS-PARALLEL LENGTH
                </span>

                <strong className="block text-xl">
                  {Math.round(
                    scalePixel
                  )}{' '}
                  px
                </strong>

                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  SCALE線分を回転軸方向へ射影した長さ
                </p>
              </div>

              <label className="block text-xs text-muted-foreground">
                CYLINDER GENERATRIX LENGTH

                <input
                  className="mt-1 h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground"
                  value={realLength}
                  onChange={(event) =>
                    setRealLength(
                      event.target.value
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

              <div className="rounded-lg border border-border p-3">
                <span className="text-xs text-muted-foreground">
                  SCALE
                </span>

                <strong className="block text-xl">
                  {scaleMmPerPx > 0
                    ? `${scaleMmPerPx.toFixed(4)} mm/px`
                    : '—'}
                </strong>
              </div>

            </div>
          )}

          {/* PROFILE */}
          {step === 'PROFILE' && (
            <div className="flex gap-2">

              <Button
                variant={
                  side === 'TOP'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSide('TOP')
                }
              >
                TOP
              </Button>

              <Button
                variant={
                  side === 'BOTTOM'
                    ? 'default'
                    : 'outline'
                }
                onClick={() =>
                  setSide('BOTTOM')
                }
              >
                BOTTOM
              </Button>

              <label className="ml-auto text-xs text-muted-foreground">
                POINTS

                <input
                  className="mt-1 h-11 w-20 rounded-md border border-input bg-background px-3 text-base text-foreground"
                  value={count}
                  onChange={(event) =>
                    setCount(
                      event.target.value
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
          {step === 'RESULT' && (
            <div className="flex flex-col gap-3">

              <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 text-xs leading-5">
                {output || 'No points'}
              </pre>

              <Button
                onClick={() =>
                  copy(output)
                }
              >
                <Copy data-icon="inline-start" />
                COPY
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  copy(json)
                }
              >
                COPY JSON
              </Button>

              <Button
                variant="outline"
                onClick={() =>
                  copy(csv)
                }
              >
                COPY CSV
              </Button>

            </div>
          )}

          {/* ERROR */}
          {error && (
            <p
              role="alert"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}

          {/* NAVIGATION */}
          <div className="flex justify-between gap-3 pt-2">

            <Button
              variant="outline"
              disabled={
                stepIndex === 0
              }
              onClick={() =>
                setStepIndex(
                  (index) =>
                    index - 1
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