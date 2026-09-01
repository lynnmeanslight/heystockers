import { NextResponse } from 'next/server';
import { getStockMarket } from '../../../../lib/dflow-prices';

export async function GET() {
  const { prices, changes, volumes } = await getStockMarket();
  return NextResponse.json({ prices, changes, volumes, updatedAt: new Date().toISOString(), source: 'Solana market activity' }, {
    headers: { 'Cache-Control': 'public, max-age=10, s-maxage=15, stale-while-revalidate=30' },
  });
}
