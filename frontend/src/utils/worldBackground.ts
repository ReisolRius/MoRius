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

export function buildWorldFallbackArtwork(worldId: number): WorldFallbackArtwork {
  const safeWorldId = Math.max(1, Math.trunc(Number.isFinite(worldId) ? worldId : 1))
  const hueA = Math.floor(seededFraction(safeWorldId, 1) * 360)
  const hueB = Math.floor(seededFraction(safeWorldId, 2) * 360)
  const hueC = Math.floor(seededFraction(safeWorldId, 3) * 360)
  const hueD = Math.floor(seededFraction(safeWorldId, 4) * 360)

  const auraAX = 12 + seededFraction(safeWorldId, 5) * 76
  const auraAY = 8 + seededFraction(safeWorldId, 6) * 74
  const auraBX = 18 + seededFraction(safeWorldId, 7) * 72
  const auraBY = 20 + seededFraction(safeWorldId, 8) * 68
  const stripeAngle = Math.floor(seededFraction(safeWorldId, 9) * 180)

  const sizeOneX = 180 + safeWorldId * 0.73
  const sizeOneY = 220 + safeWorldId * 0.61
  const sizeTwoX = 240 + safeWorldId * 0.57
  const sizeTwoY = 210 + safeWorldId * 0.67
  const stripeSize = 32 + safeWorldId * 0.19

  const shiftAX = safeWorldId * 4.83
  const shiftAY = safeWorldId * 3.17
  const shiftBX = safeWorldId * 2.91
  const shiftBY = safeWorldId * 5.27
  const shiftCX = safeWorldId * 1.71
  const shiftCY = safeWorldId * 1.29

  return {
    backgroundImage: [
      `radial-gradient(circle at ${auraAX.toFixed(2)}% ${auraAY.toFixed(2)}%, hsla(${hueA}, 72%, 56%, 0.25) 0%, transparent 54%)`,
      `radial-gradient(circle at ${auraBX.toFixed(2)}% ${auraBY.toFixed(2)}%, hsla(${hueB}, 64%, 44%, 0.21) 0%, transparent 58%)`,
      `linear-gradient(156deg, hsla(${hueC}, 42%, 19%, 0.97) 0%, hsla(${hueD}, 48%, 10%, 0.99) 100%)`,
      `repeating-linear-gradient(${stripeAngle}deg, rgba(255, 255, 255, 0.045) 0px, rgba(255, 255, 255, 0.045) 1px, transparent 1px, transparent 14px)`,
    ].join(', '),
    backgroundSize: `${sizeOneX.toFixed(2)}px ${sizeOneY.toFixed(2)}px, ${sizeTwoX.toFixed(2)}px ${sizeTwoY.toFixed(2)}px, cover, ${stripeSize.toFixed(2)}px ${stripeSize.toFixed(2)}px`,
    backgroundPosition: `${shiftAX.toFixed(2)}px ${shiftAY.toFixed(2)}px, ${shiftBX.toFixed(2)}px ${shiftBY.toFixed(2)}px, center, ${shiftCX.toFixed(2)}px ${shiftCY.toFixed(2)}px`,
    backgroundRepeat: 'repeat, repeat, no-repeat, repeat',
  }
}
