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

const CINEMATIC_FALLBACK_PALETTES = [
  ['#5e3e54', '#2e2230', '#181219'],
  ['#525860', '#272b30', '#15181b'],
  ['#4a3a66', '#2a2142', '#15101f'],
  ['#356b66', '#26384c', '#181f2a'],
  ['#5e2c34', '#321a22', '#1a1014'],
  ['#2c5346', '#193029', '#0f1814'],
] as const

export function buildWorldFallbackArtwork(worldId: number): WorldFallbackArtwork {
  const safeWorldId = Math.max(1, Math.trunc(Number.isFinite(worldId) ? worldId : 1))
  const palette = CINEMATIC_FALLBACK_PALETTES[
    Math.floor(seededFraction(safeWorldId, 1) * CINEMATIC_FALLBACK_PALETTES.length)
  ] ?? CINEMATIC_FALLBACK_PALETTES[0]
  const [colorOne, colorTwo, colorThree] = palette
  const auraAX = 16 + seededFraction(safeWorldId, 5) * 68
  const auraAY = 10 + seededFraction(safeWorldId, 6) * 54
  const stripeAngle = Math.floor(seededFraction(safeWorldId, 9) * 180)

  const sizeOneX = 210 + safeWorldId * 0.53
  const sizeOneY = 250 + safeWorldId * 0.41
  const stripeSize = 32 + safeWorldId * 0.19

  const shiftAX = safeWorldId * 4.83
  const shiftAY = safeWorldId * 3.17
  const shiftCX = safeWorldId * 1.71
  const shiftCY = safeWorldId * 1.29

  return {
    backgroundImage: [
      `radial-gradient(circle at ${auraAX.toFixed(2)}% ${auraAY.toFixed(2)}%, rgba(255,255,255,0.08) 0%, transparent 52%)`,
      `linear-gradient(160deg, ${colorOne}, ${colorTwo} 68%, ${colorThree})`,
      'linear-gradient(180deg, transparent 45%, rgba(10,8,12,0.82))',
      `repeating-linear-gradient(${stripeAngle}deg, rgba(255,255,255,0.032) 0px, rgba(255,255,255,0.032) 1px, transparent 1px, transparent 16px)`,
    ].join(', '),
    backgroundSize: `${sizeOneX.toFixed(2)}px ${sizeOneY.toFixed(2)}px, cover, cover, ${stripeSize.toFixed(2)}px ${stripeSize.toFixed(2)}px`,
    backgroundPosition: `${shiftAX.toFixed(2)}px ${shiftAY.toFixed(2)}px, center, center, ${shiftCX.toFixed(2)}px ${shiftCY.toFixed(2)}px`,
    backgroundRepeat: 'repeat, no-repeat, no-repeat, repeat',
  }
}
