export type PositionSide = 'BUY' | 'SELL';
export type PositionOutcome = 'OPEN' | 'WON' | 'LOST';

export function targetMatchesSide(side: PositionSide, entryPrice: number, targetPrice: number) {
  return side === 'BUY' ? targetPrice > entryPrice : targetPrice < entryPrice;
}

export function settlePositionCall(side: PositionSide, targetPrice: number, deadline: string, currentPrice: number | null, now = Date.now()): PositionOutcome {
  if (currentPrice === null) return 'OPEN';
  const hit = side === 'BUY' ? currentPrice >= targetPrice : currentPrice <= targetPrice;
  if (hit) return 'WON';
  return new Date(deadline).getTime() <= now ? 'LOST' : 'OPEN';
}

export function positionProgress(side: PositionSide, entryPrice: number, targetPrice: number, currentPrice: number | null) {
  if (currentPrice === null || entryPrice === targetPrice) return 0;
  const raw = side === 'BUY'
    ? (currentPrice - entryPrice) / (targetPrice - entryPrice)
    : (entryPrice - currentPrice) / (entryPrice - targetPrice);
  return Math.max(0, Math.min(1, raw));
}
