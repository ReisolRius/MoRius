import type { CSSProperties, ReactNode } from 'react'

/**
 * The presentation page's icon set. The mockup drew these as Georgia glyphs (✒ ⚄ ❖ ↗ ✧ ⚙),
 * which render differently on every platform and look broken on Windows, so each one is a real
 * SVG here. They all paint with `currentColor` and inherit the surrounding font size, so a
 * colour change on the parent is enough to restyle them.
 */

export type LandingIconProps = {
  size?: number | string
  className?: string
  style?: CSSProperties
  title?: string
}

type PathIconProps = LandingIconProps & {
  children: ReactNode
  viewBox?: string
  strokeBased?: boolean
}

function Icon({ size = 24, className, style, title, children, viewBox = '0 0 24 24', strokeBased = true }: PathIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', flexShrink: 0, ...style }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...(strokeBased
        ? { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
        : { fill: 'currentColor' })}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  )
}

/** Storytelling — a quill over a written line. */
export function QuillIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20.5c4.6.6 8.2-.7 10.9-3.9 2.7-3.2 3.9-7.2 3.6-12-3.2 1-5.9 2.4-8 4.2-2.1 1.8-3.4 4-3.9 6.6-.2 1.2-.5 2.2-.9 3.1-.4.9-1 1.6-1.7 2Z" />
      <path d="M7.4 17.1c1.9-2.9 4.3-5.2 7.2-6.9" />
    </Icon>
  )
}

/** D&D / RPG — a die showing five pips. */
export function DiceIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="3.4" />
      <circle cx="8.4" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="8.4" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15.6" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** Visual novel — the mockup's ❖, drawn as a large rhombus flanked by two small ones. */
export function RhombusIcon(props: LandingIconProps) {
  return (
    <Icon {...props} strokeBased={false}>
      <path d="M12 3.4 16.1 12 12 20.6 7.9 12 12 3.4Z" />
      <path d="M4.6 8.2 7.1 12l-2.5 3.8L2.1 12l2.5-3.8ZM19.4 8.2 21.9 12l-2.5 3.8L16.9 12l2.5-3.8Z" opacity="0.62" />
    </Icon>
  )
}

/** The page's workhorse arrow. Replaces the mockup's ↗ glyph. */
export function ArrowUpRightIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M7.5 16.5 16.5 7.5" />
      <path d="M9.4 7.5h7.1v7.1" />
    </Icon>
  )
}

export function ArrowDownIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M6.6 13.4 12 18.8l5.4-5.4" />
    </Icon>
  )
}

export function ArrowUpIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 19V5" />
      <path d="M6.6 10.6 12 5.2l5.4 5.4" />
    </Icon>
  )
}

/** The ✧ ornament: a four-point star used as a bullet and divider. */
export function SparkIcon(props: LandingIconProps) {
  return (
    <Icon {...props} strokeBased={false}>
      <path d="M12 2.4c.5 4.6 2.6 7.2 7.2 7.6-4.6.5-6.7 3-7.2 7.6-.5-4.6-2.6-7.1-7.2-7.6 4.6-.4 6.7-3 7.2-7.6Z" />
    </Icon>
  )
}

/** Quick start. */
export function BoltIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M13.2 2.8 4.9 13.4h5.6l-.7 7.8 8.3-10.6h-5.6l.7-7.8Z" />
    </Icon>
  )
}

/** Own game / advanced controls. */
export function SlidersIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.6v5M5 14v5.4M12 4.6v8.2M12 17.2v2.2M19 4.6v2.6M19 11.8v7.6" />
      <circle cx="5" cy="11.7" r="2.1" />
      <circle cx="12" cy="15.1" r="2.1" />
      <circle cx="19" cy="9.5" r="2.1" />
    </Icon>
  )
}

/** The memory pipeline — stacked layers that get smaller as they compress. */
export function LayersIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.2 21 7.6l-9 4.4-9-4.4 9-4.4Z" />
      <path d="M4.4 11.6 12 15.3l7.6-3.7" />
      <path d="M6.2 15.9 12 18.8l5.8-2.9" />
    </Icon>
  )
}

/** Long campaigns — an hourglass. */
export function HourglassIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M7 3.2h10M7 20.8h10" />
      <path d="M8 3.2v3.2c0 1.6 1.3 2.9 2.6 4.1.8.7.8 2.2 0 2.9-1.3 1.2-2.6 2.5-2.6 4.1v3.3" />
      <path d="M16 3.2v3.2c0 1.6-1.3 2.9-2.6 4.1-.8.7-.8 2.2 0 2.9 1.3 1.2 2.6 2.5 2.6 4.1v3.3" />
    </Icon>
  )
}

/** Growth from first step to veteran. */
export function StairsIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M3.2 19.4h4.2v-4.2h4.2V11h4.2V6.8h5" />
      <path d="M17.6 3.6 20.8 6.8l-3.2 3.2" />
    </Icon>
  )
}

/** Freedom / few limits — an open padlock. */
export function UnlockIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <rect x="4.4" y="10.6" width="15.2" height="9.6" rx="2.4" />
      <path d="M8.2 10.6V7.8a3.8 3.8 0 0 1 7.4-1.3" />
      <circle cx="12" cy="15.4" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

/** Community. */
export function PeopleIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <circle cx="9" cy="8.4" r="3.4" />
      <path d="M2.8 20.2c.6-3.3 3.1-5.3 6.2-5.3s5.6 2 6.2 5.3" />
      <path d="M16.2 5.4a3.4 3.4 0 0 1 0 6.6" />
      <path d="M17.4 15.3c2.1.5 3.5 2.2 3.9 4.9" />
    </Icon>
  )
}

export function TelegramIcon(props: LandingIconProps) {
  return (
    <Icon {...props} strokeBased={false}>
      <path d="M21.6 4.3 18.7 19c-.2 1-.8 1.2-1.6.8l-4.5-3.3-2.2 2.1c-.2.2-.4.5-.9.5l.3-4.6 8.3-7.5c.4-.3-.1-.5-.6-.2L7.3 13 2.9 11.6c-1-.3-1-1 .2-1.4l17-6.6c.8-.3 1.5.2 1.5 1.1Z" />
    </Icon>
  )
}

/** FAQ accordion markers. */
export function PlusIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.6v12.8M5.6 12h12.8" />
    </Icon>
  )
}

export function MinusIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M5.6 12h12.8" />
    </Icon>
  )
}

export function MenuIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function CloseIcon(props: LandingIconProps) {
  return (
    <Icon {...props}>
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />
    </Icon>
  )
}
