import { NextResponse } from 'next/server';
import { getStockMarket } from '../../../../lib/dflow-prices';

export async function GET() {
  const { prices, volumes } = await getStockMarket();
  return NextResponse.json({ prices, volumes, updatedAt: new Date().toISOString(), source: 'Solana market activity' }, {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120' },
  });
}
