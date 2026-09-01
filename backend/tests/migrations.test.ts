import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { TRADE_ASSETS } from '../src/assets'

const migrationsDirectory = join(process.cwd(), 'migrations')

function migratedDatabase() {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  const migrations = readdirSync(migrationsDirectory)
    .filter((filename) => filename.endsWith('.sql'))
    .sort()

  for (const migration of migrations) {
    database.exec(`BEGIN;\n${readFileSync(join(migrationsDirectory, migration), 'utf8')}\nCOMMIT;`)
  }

  return database
}

describe('database migrations', () => {
  it('accepts a position call for every supported stock symbol', () => {
    const database = migratedDatabase()
    database.prepare('INSERT INTO wallets (wallet, joined_at) VALUES (?, ?)').run('wallet', '2026-08-31T00:00:00.000Z')

    const insert = database.prepare(`
      INSERT INTO position_calls (
        id, wallet, symbol, side, thesis, entry_price, target_price,
        deadline, commitment_usdc, execution_signature, created_at
      ) VALUES (?, 'wallet', ?, 'BUY', 'A sufficiently detailed thesis.', 100, 110,
        '2026-09-30T00:00:00.000Z', 10, ?, '2026-08-31T00:00:00.000Z')
    `)

    for (const [index, asset] of TRADE_ASSETS.entries()) {
      expect(() => insert.run(`call-${index}`, asset.symbol, `signature-${index}`), asset.symbol).not.toThrow()
    }

    expect(database.prepare('SELECT COUNT(*) AS count FROM position_calls').get()).toEqual({ count: TRADE_ASSETS.length })
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    database.close()
  })
})
