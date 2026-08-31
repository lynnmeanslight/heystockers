import assert from 'node:assert/strict';
import test from 'node:test';
import { TRADE_ASSETS, toAtomicAmount, USDC } from '../lib/assets.ts';
import { WALLET_PATTERN } from '../lib/validation.ts';
import { positionProgress, settlePositionCall, targetMatchesSide } from '../lib/position-calls.ts';
import { matchesPositionTrade } from '../lib/solana-proof.ts';

test('the trade universe contains stocks and ETFs only', () => {
  assert.ok(TRADE_ASSETS.length >= 10 && TRADE_ASSETS.length <= 50);
  assert.ok(TRADE_ASSETS.every((asset) => asset.type === 'STOCK' || asset.type === 'ETF'));
  assert.ok(TRADE_ASSETS.every((asset) => asset.logo.startsWith('https://www.google.com/s2/favicons?')));
  assert.ok(TRADE_ASSETS.every((asset, index) => index === 0 || TRADE_ASSETS[index - 1].volume24h >= asset.volume24h));
  assert.equal(TRADE_ASSETS.some((asset) => asset.symbol === 'SOL'), false);
  assert.equal(new Set(TRADE_ASSETS.map((asset) => asset.mint)).size, TRADE_ASSETS.length);
});

test('buy and sell values convert to correct atomic units', () => {
  const nvidia = TRADE_ASSETS.find((asset) => asset.symbol === 'NVDAx');
  assert.ok(nvidia);
  assert.equal(toAtomicAmount(nvidia, 'buy', 20), String(20 * 10 ** USDC.decimals));
  assert.equal(toAtomicAmount(nvidia, 'sell', 20, 200), '10000000');
});

test('wallet validation accepts Solana base58 addresses and rejects unsafe input', () => {
  assert.equal(WALLET_PATTERN.test('8dZZqYCJdyk9XJG3WaaphpLRgzoC9bEMu3nncmEKMcf1'), true);
  assert.equal(WALLET_PATTERN.test('not-a-wallet'), false);
  assert.equal(WALLET_PATTERN.test('1111<script>alert(1)</script>'), false);
});

test('position calls require targets that match their direction', () => {
  assert.equal(targetMatchesSide('BUY', 100, 110), true);
  assert.equal(targetMatchesSide('BUY', 100, 90), false);
  assert.equal(targetMatchesSide('SELL', 100, 90), true);
  assert.equal(targetMatchesSide('SELL', 100, 110), false);
});

test('position calls settle against the target or deadline', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(settlePositionCall('BUY', 110, future, 111), 'WON');
  assert.equal(settlePositionCall('SELL', 90, future, 89), 'WON');
  assert.equal(settlePositionCall('BUY', 110, future, 105), 'OPEN');
  assert.equal(settlePositionCall('BUY', 110, past, 105), 'LOST');
  assert.equal(settlePositionCall('BUY', 110, past, null), 'OPEN');
});

test('position progress stays between zero and one', () => {
  assert.equal(positionProgress('BUY', 100, 110, 105), 0.5);
  assert.equal(positionProgress('BUY', 100, 110, 120), 1);
  assert.equal(positionProgress('SELL', 100, 90, 95), 0.5);
});

test('position proof must match the wallet, direction, and commitment', () => {
  const wallet = '8dZZqYCJdyk9XJG3WaaphpLRgzoC9bEMu3nncmEKMcf1';
  const assetMint = 'stock-mint';
  const usdcMint = 'usdc-mint';
  const token = (owner: string, mint: string, amount: string) => ({ owner, mint, uiTokenAmount: { amount, decimals: 6 } });
  const buy = {
    meta: {
      preTokenBalances: [token(wallet, usdcMint, '20000000'), token(wallet, assetMint, '0')],
      postTokenBalances: [token(wallet, usdcMint, '10000000'), token(wallet, assetMint, '1000000')],
    },
  };

  assert.equal(matchesPositionTrade(buy, wallet, { assetMint, usdcMint, side: 'BUY', commitmentUsdc: 10 }), true);
  assert.equal(matchesPositionTrade(buy, wallet, { assetMint, usdcMint, side: 'SELL', commitmentUsdc: 10 }), false);
  assert.equal(matchesPositionTrade(buy, wallet, { assetMint, usdcMint, side: 'BUY', commitmentUsdc: 20 }), false);
});
