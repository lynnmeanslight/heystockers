import { describe, expect, it } from 'vitest'
import { AppConfig } from '@/constants/app-config'
import { API_BASE_URL } from './api'

describe('store release configuration', () => {
  it('uses the production API unless development explicitly overrides it', () => {
    expect(API_BASE_URL).toBe('https://api.heystockers.trade')
  })

  it('presents a complete wallet identity', () => {
    expect(AppConfig.identity).toEqual({
      name: 'HeyStockers',
      uri: 'https://heystockers.trade',
      icon: 'heystockers-mark-512.png',
    })
  })
})
