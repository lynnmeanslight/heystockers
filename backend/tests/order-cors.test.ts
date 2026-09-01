import { afterEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/index'
import type { Bindings } from '../src/types'

const origin = 'https://heystockers.trade'
const orderUrl =
  'http://worker.test/api/trades/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh&amount=20000000'

describe('order proxy CORS', () => {
  afterEach(() => vi.restoreAllMocks())

  it('preserves approved-origin headers when the upstream returns an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream timeout', {
        status: 504,
        headers: { 'Content-Type': 'text/plain' },
      }),
    )

    const response = await app.request(
      orderUrl,
      { headers: { Origin: origin } },
      {
        ALLOWED_ORIGINS: origin,
        DFLOW_TRADE_API_URL: 'https://quotes.example',
      } as Bindings,
    )

    expect(response.status).toBe(504)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })
})
