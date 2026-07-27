export function calculateCheckoutAmountKopecks(priceRub: number, coverCommission: boolean): number {
  const baseAmountKopecks = Math.max(0, Math.trunc(priceRub)) * 100
  return coverCommission
    ? Math.round((baseAmountKopecks * 1035) / 1000)
    : baseAmountKopecks
}

export function formatCheckoutPrice(priceRub: number, coverCommission: boolean): string {
  const amountKopecks = calculateCheckoutAmountKopecks(priceRub, coverCommission)
  const hasKopecks = amountKopecks % 100 !== 0
  return `${(amountKopecks / 100).toLocaleString('ru-RU', {
    minimumFractionDigits: hasKopecks ? 2 : 0,
    maximumFractionDigits: 2,
  })} ₽`
}
