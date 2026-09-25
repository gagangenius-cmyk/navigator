'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

type Point = { x: number; y: number }
type Placement = 'top' | 'bottom' | 'left' | 'right'

interface Destination {
  id: string
  label: string
  at: Point
  placement: Placement
}

// Positions are percentages of the panel, from a simple equirectangular projection
// (longitude -125..180 -> x 6..90, latitude 62..-45 -> y 12..88). The arcs are drawn in real
// pixels from the measured panel size, so a marker always sits on the end of its line and
// curves keep their shape at any aspect ratio.
const HUB: Point = { x: 55.7, y: 38 } // Dubai, where the branch is

const DESTINATIONS: Destination[] = [
  { id: 'canada', label: 'Canada', at: { x: 18.6, y: 25 }, placement: 'top' },
  { id: 'europe', label: 'Europe', at: { x: 44.1, y: 18.7 }, placement: 'top' },
  { id: 'australia', label: 'Australia', at: { x: 82.1, y: 80.1 }, placement: 'left' },
  { id: 'new-zealand', label: 'New Zealand', at: { x: 88.6, y: 82.2 }, placement: 'bottom' },
]

const arcControl = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2 - Math.hypot(b.x - a.x, b.y - a.y) * 0.3,
})

const arcPath = (a: Point, b: Point) => {
  const c = arcControl(a, b)
  return `M${a.x},${a.y} Q${c.x},${c.y} ${b.x},${b.y}`
}

// Point at t (0..1) along the same quadratic curve, so the travelling dot rides the line.
const pointOnArc = (a: Point, b: Point, t: number): Point => {
  const c = arcControl(a, b)
  const u = 1 - t
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  }
}

const toPixels = (p: Point, box: { w: number; h: number }): Point => ({ x: (p.x / 100) * box.w, y: (p.y / 100) * box.h })

const LABEL_PLACEMENT: Record<Placement, string> = {
  top: 'bottom-3.5 left-0 -translate-x-1/2',
  bottom: 'top-3.5 left-0 -translate-x-1/2',
  left: 'right-4 top-0 -translate-y-1/2',
  right: 'left-4 top-0 -translate-y-1/2',
}

const GRID_STEPS = [0.25, 0.5, 0.75]
const TRAVEL_STEPS = 32

function Marker({
  at,
  label,
  placement,
  hub = false,
  showLabel,
  reduceMotion,
  delay,
}: {
  at: Point
  label: string
  placement: Placement
  hub?: boolean
  showLabel: boolean
  reduceMotion: boolean
  delay: number
}) {
  return (
    <div className="absolute" style={{ left: `${at.x}%`, top: `${at.y}%` }}>
      {!reduceMotion && (
        <motion.span
          className={`absolute -left-[5px] -top-[5px] block h-2.5 w-2.5 rounded-full border ${hub ? 'border-[#F6B44B]' : 'border-white/70'}`}
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: hub ? 4 : 3, opacity: 0 }}
          transition={{ duration: hub ? 2.8 : 3.4, repeat: Infinity, delay, ease: 'easeOut' }}
        />
      )}
      <span
        className={
          hub
            ? '-ml-[7px] -mt-[7px] block h-3.5 w-3.5 rounded-full bg-[#F6B44B] shadow-[0_0_0_5px_rgba(246,180,75,0.22),0_0_24px_4px_rgba(246,180,75,0.35)]'
            : '-ml-[5px] -mt-[5px] block h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(255,255,255,0.14)]'
        }
      />
      {showLabel && (
        <span
          className={`absolute whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.16em] ${LABEL_PLACEMENT[placement]} ${hub ? 'text-[#F6B44B]' : 'text-white/80'}`}
        >
          {label}
        </span>
      )}
    </div>
  )
}

/**
 * Decorative route map: a hub in Dubai with arcs out to the destinations Global Navigator
 * places clients in. Purely visual (aria-hidden); it fills its positioned parent.
 * `compact` drops the labels for the short banner shown on phones.
 */
export function RouteMap({ compact = false }: { compact?: boolean }) {
  const reduceMotion = Boolean(useReducedMotion())
  const rootRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const measured = box.w > 0 && box.h > 0
  const hubPx = toPixels(HUB, box)
  const dotGrid = 'radial-gradient(ellipse 72% 62% at 58% 42%, #000 22%, transparent 80%)'

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0" aria-hidden="true">
      {/* Dot matrix, fading out towards the edges */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.17) 1px, transparent 1.6px)',
          backgroundSize: '22px 22px',
          WebkitMaskImage: dotGrid,
          maskImage: dotGrid,
        }}
      />

      {/* Warm glow behind the hub */}
      <div
        className="absolute h-[70%] w-[70%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#F6B44B]/[0.09] blur-3xl"
        style={{ left: `${HUB.x}%`, top: `${HUB.y}%` }}
      />

      {/* Range rings around the hub */}
      {!compact &&
        [28, 48, 68].map((size) => (
          <div
            key={size}
            className="absolute rounded-full border border-white/[0.07]"
            style={{ left: `${HUB.x}%`, top: `${HUB.y}%`, width: `${size}%`, aspectRatio: '1', transform: 'translate(-50%, -50%)' }}
          />
        ))}

      {measured && (
        <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`} className="absolute inset-0">
          {GRID_STEPS.map((step) => (
            <g key={step} stroke="white" strokeOpacity="0.06" strokeWidth="1">
              <line x1="0" y1={step * box.h} x2={box.w} y2={step * box.h} />
              <line x1={step * box.w} y1="0" x2={step * box.w} y2={box.h} />
            </g>
          ))}
          {DESTINATIONS.map((destination, index) => (
            <motion.path
              key={destination.id}
              d={arcPath(hubPx, toPixels(destination.at, box))}
              fill="none"
              stroke="#F6B44B"
              strokeOpacity="0.6"
              strokeWidth="1.5"
              strokeLinecap="round"
              initial={reduceMotion ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.8, delay: 0.5 + index * 0.3, ease: 'easeInOut' }}
            />
          ))}
        </svg>
      )}

      {/* A dot travelling out along each route */}
      {!reduceMotion &&
        measured &&
        DESTINATIONS.map((destination, index) => {
          const end = toPixels(destination.at, box)
          const samples = Array.from({ length: TRAVEL_STEPS + 1 }, (_, step) => pointOnArc(hubPx, end, step / TRAVEL_STEPS))
          return (
            <motion.span
              key={destination.id}
              className="absolute -ml-[3px] -mt-[3px] block h-1.5 w-1.5 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.7)]"
              initial={{ opacity: 0, left: hubPx.x, top: hubPx.y }}
              animate={{
                left: samples.map((p) => p.x),
                top: samples.map((p) => p.y),
                opacity: [0, 1, 1, 0],
              }}
              transition={{
                duration: 5.5,
                delay: 2.4 + index * 0.9,
                repeat: Infinity,
                repeatDelay: 2.5,
                ease: 'easeInOut',
              }}
            />
          )
        })}

      {DESTINATIONS.map((destination, index) => (
        <Marker
          key={destination.id}
          at={destination.at}
          label={destination.label}
          placement={destination.placement}
          showLabel={!compact}
          reduceMotion={reduceMotion}
          delay={1 + index * 0.4}
        />
      ))}
      <Marker at={HUB} label="Dubai · HQ" placement="bottom" hub showLabel={!compact} reduceMotion={reduceMotion} delay={0} />
    </div>
  )
}
