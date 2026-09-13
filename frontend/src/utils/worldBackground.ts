export type WorldFallbackArtwork = {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
  backgroundRepeat: string
}

function seededFraction(seed: number, salt: number): number {
  const normalizedSeed = Number.isFinite(seed) ? seed : 1
  const raw = Math.sin(normalizedSeed * 12.9898 + salt * 78.233) * 43758.5453
  return raw - Math.floor(raw)
}

// Every palette is a lit one: a saturated key colour, a mid tone that carries it, and a deep
// base that keeps white text readable. The previous set was three desaturated greys apiece
// plus a near-black scrim baked into the artwork, which is what made a wall of coverless
// cards read as uniformly grim. Darkening for legibility is the card's job, not the
// artwork's -- CommunityWorldCard already lays its own bottom scrim over this.
const CINEMATIC_FALLBACK_PALETTES = [
  ['#7b4bd4', '#4a2a8f', '#1d1338'], // arcane violet
  ['#1f8fbf', '#1a5480', '#0c2135'], // deep water
  ['#d4643a', '#8f3320', '#331210'], // ember
  ['#2eae86', '#1a6b58', '#0b2620'], // verdant
  ['#d94f76', '#8a2b4c', '#2c0f1d'], // rose court
  ['#3f6fd8', '#2a3f8f', '#101636'], // royal blue
  ['#c9a227', '#8a6414', '#2e2008'], // gilded
  ['#5b8f3a', '#356024', '#12240d'], // wildwood
  ['#8f4bbf', '#5a2a80', '#22102f'], // dusk orchid
  ['#2f9fa8', '#1c6670', '#0a2428'], // teal depths
  ['#bf4a4a', '#802e2e', '#2b0f0f'], // crimson
  ['#4a5fd4', '#2f3a8f', '#121538'], // midnight indigo
] as const

// Four pattern families, so a grid of coverless cards does not look like one repeated tile.
type PatternKind = 'weave' | 'dots' | 'rays' | 'grid'
const PATTERN_KINDS: readonly PatternKind[] = ['weave', 'dots', 'rays', 'grid']

function buildPatternLayer(kind: PatternKind, angle: number): { image: string; size: (tile: number) => string } {
  switch (kind) {
    case 'dots':
      return {
        image: 'radial-gradient(circle, rgba(255,255,255,0.085) 1.1px, transparent 1.2px)',
        size: (tile) => `${tile.toFixed(2)}px ${tile.toFixed(2)}px`,
      }
    case 'rays':
      return {
        image: `repeating-linear-gradient(${angle}deg, rgba(255,255,255,0.055) 0px, rgba(255,255,255,0.055) 2px, transparent 2px, transparent 22px)`,
        size: (tile) => `${(tile * 2.4).toFixed(2)}px ${(tile * 2.4).toFixed(2)}px`,
      }
    case 'grid':
      return {
        image: [
          `repeating-linear-gradient(${angle}deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 17px)`,
          `repeating-linear-gradient(${angle + 90}deg, rgba(255,255,255,0.05) 0px, rgba(255,255,255,0.05) 1px, transparent 1px, transparent 17px)`,
        ].join(', '),
        size: (tile) => `${tile.toFixed(2)}px ${tile.toFixed(2)}px, ${tile.toFixed(2)}px ${tile.toFixed(2)}px`,
      }
    case 'weave':
    default:
      return {
        image: `repeating-linear-gradient(${angle}deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 14px)`,
        size: (tile) => `${tile.toFixed(2)}px ${tile.toFixed(2)}px`,
      }
  }
}

export function buildWorldFallbackArtwork(worldId: number): WorldFallbackArtwork {
  const safeWorldId = Math.max(1, Math.trunc(Number.isFinite(worldId) ? worldId : 1))
  const palette =
    CINEMATIC_FALLBACK_PALETTES[
      Math.floor(seededFraction(safeWorldId, 1) * CINEMATIC_FALLBACK_PALETTES.length)
    ] ?? CINEMATIC_FALLBACK_PALETTES[0]
  const [colorOne, colorTwo, colorThree] = palette

  // Two offset light sources give the flat gradient some depth without costing an image.
  const auraAX = 12 + seededFraction(safeWorldId, 5) * 40
  const auraAY = 6 + seededFraction(safeWorldId, 6) * 34
  const auraBX = 58 + seededFraction(safeWorldId, 7) * 36
  const auraBY = 52 + seededFraction(safeWorldId, 8) * 40

  const patternKind = PATTERN_KINDS[Math.floor(seededFraction(safeWorldId, 11) * PATTERN_KINDS.length)] ?? 'weave'
  const patternAngle = Math.floor(seededFraction(safeWorldId, 9) * 180)
  const pattern = buildPatternLayer(patternKind, patternAngle)
  const patternTile = 26 + seededFraction(safeWorldId, 12) * 22

  const gradientAngle = 138 + Math.floor(seededFraction(safeWorldId, 13) * 58)
  const patternShiftX = safeWorldId * 1.71
  const patternShiftY = safeWorldId * 1.29
  const patternLayerCount = patternKind === 'grid' ? 2 : 1

  return {
    backgroundImage: [
      `radial-gradient(120% 92% at ${auraAX.toFixed(2)}% ${auraAY.toFixed(2)}%, rgba(255,255,255,0.2) 0%, transparent 58%)`,
      `radial-gradient(90% 80% at ${auraBX.toFixed(2)}% ${auraBY.toFixed(2)}%, ${colorOne}66 0%, transparent 62%)`,
      pattern.image,
      `linear-gradient(${gradientAngle}deg, ${colorOne} 0%, ${colorTwo} 52%, ${colorThree} 100%)`,
    ].join(', '),
    backgroundSize: ['cover', 'cover', pattern.size(patternTile), 'cover'].join(', '),
    backgroundPosition: [
      'center',
      'center',
      `${patternShiftX.toFixed(2)}px ${patternShiftY.toFixed(2)}px`,
      'center',
    ].join(', '),
    backgroundRepeat: [
      'no-repeat',
      'no-repeat',
      Array.from({ length: patternLayerCount }, () => 'repeat').join(', '),
      'no-repeat',
    ].join(', '),
  }
}
