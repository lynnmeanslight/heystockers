import { describe, expect, it } from 'vitest'
import { formatUsd, getAsset, toAtomicAmount } from './assets'

describe('mobile stock orders', () => {
  const nvidia = getAsset('NVDAx')

  it('converts buy value to atomic USDC', () => {
    expect(toAtomicAmount(nvidia, 'buy', 10, 200)).toBe('10000000')
  })

  it('converts sell value to atomic stock units at the live price', () => {
    expect(toAtomicAmount(nvidia, 'sell', 10, 200)).toBe('5000000')
  })

  it('never replaces an unavailable live value with mock money', () => {
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd(undefined)).toBe('—')
  })
})
