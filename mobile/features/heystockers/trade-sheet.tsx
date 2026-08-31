import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { getBase58Decoder, getTransactionDecoder } from '@solana/kit'
import { toUint8Array, useMobileWallet } from '@wallet-ui/react-native-kit'
import { getOrder, type Order } from './api'
import { formatUsd, getAsset, toAtomicAmount, USDC } from './assets'
import { COLORS } from './theme'

type Props = {
  open: boolean
  symbol: string
  side: 'buy' | 'sell'
  initialAmount?: number
  livePrice: number | null
  maxBuyUsd: number
  maxSellUsd: number
  locked?: boolean
  onClose(): void
  onExecuted(signature: string): Promise<void>
}

function formatTokenAmount(value: string | undefined, decimals: number) {
  if (!value) return '—'
  return (Number(value) / 10 ** decimals).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

export function TradeSheet({
  open,
  symbol,
  side,
  initialAmount,
  livePrice,
  maxBuyUsd,
  maxSellUsd,
  locked = false,
  onClose,
  onExecuted,
}: Props) {
  const { account, connect, signAndSendTransaction } = useMobileWallet()
  const asset = useMemo(() => getAsset(symbol), [symbol])
  const limit = Math.max(0, Math.min(25, side === 'buy' ? maxBuyUsd : maxSellUsd))
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<Order | null>(null)
  const [busy, setBusy] = useState<'idle' | 'quote' | 'sign'>('idle')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    const nextAmount = Math.min(initialAmount ?? 10, limit)
    setAmount(nextAmount > 0 ? nextAmount.toFixed(2) : '')
    setQuote(null)
    setBusy('idle')
    setMessage('')
  }, [initialAmount, limit, open, side, symbol])

  async function preview() {
    const dollars = Number(amount)
    if (!Number.isFinite(dollars) || dollars <= 0 || dollars > limit) {
      setMessage(`Enter an amount between $0.01 and ${formatUsd(limit)}.`)
      return
    }
    if (!livePrice || livePrice <= 0) {
      setMessage('A live stock price is required before trading.')
      return
    }

    setBusy('quote')
    setMessage(account ? 'Building your order…' : 'Connect your wallet to build the order…')
    setQuote(null)
    try {
      const wallet = account ?? (await connect())
      const input = side === 'buy' ? USDC : asset
      const output = side === 'buy' ? asset : USDC
      const result = await getOrder({
        inputMint: input.mint,
        outputMint: output.mint,
        amount: toAtomicAmount(asset, side, dollars, livePrice),
        userPublicKey: wallet.address.toString(),
      })
      if (!result.transaction || result.contextSlot === undefined) {
        throw new Error(result.error ?? result.msg ?? 'The order is missing its transaction data.')
      }
      setQuote(result)
      setMessage('Ready. Your wallet will show the final transaction before approval.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order could not be prepared.')
    } finally {
      setBusy('idle')
    }
  }

  async function execute() {
    if (!quote?.transaction || quote.contextSlot === undefined) return
    setBusy('sign')
    setMessage('Review and approve in your wallet.')
    try {
      const transaction = getTransactionDecoder().decode(toUint8Array(quote.transaction))
      const signatureBytes = await signAndSendTransaction(transaction, BigInt(quote.contextSlot))
      const signature = getBase58Decoder().decode(signatureBytes)
      setMessage(`Submitted ${signature.slice(0, 4)}…${signature.slice(-4)}`)
      await onExecuted(signature)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The transaction was not approved.')
    } finally {
      setBusy('idle')
    }
  }

  const output = side === 'buy' ? asset : USDC

  return (
    <Modal animationType="slide" transparent visible={open} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel="Close trade" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>ORDER</Text>
              <Text style={styles.title}>
                {side === 'buy' ? 'Buy' : 'Sell'} {asset.symbol}
              </Text>
            </View>
            <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>VALUE · MAX {formatUsd(limit)}</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>$</Text>
            <TextInput
              accessibilityLabel="Order value"
              editable={!locked}
              keyboardType="decimal-pad"
              onChangeText={(value) => {
                setAmount(value)
                setQuote(null)
              }}
              placeholder="0.00"
              placeholderTextColor={COLORS.muted}
              style={styles.input}
              value={amount}
            />
            <Text style={styles.unit}>USDC</Text>
          </View>

          <View style={styles.summary}>
            <Text style={styles.summaryText}>PAY {formatUsd(Number(amount) || 0)}</Text>
            <Text style={styles.arrow}>→</Text>
            <Text style={[styles.summaryText, styles.summaryRight]}>
              GET {quote ? `${formatTokenAmount(quote.outAmount, output.decimals)} ${output.symbol}` : output.symbol}
            </Text>
          </View>

          {quote?.priceImpactPct ? (
            <Text style={styles.detail}>Estimated price impact {quote.priceImpactPct}%</Text>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={busy !== 'idle'}
            onPress={quote?.transaction ? execute : preview}
            style={({ pressed }) => [
              styles.primary,
              side === 'buy' ? styles.buyPrimary : styles.sellPrimary,
              pressed && styles.pressed,
              busy !== 'idle' && styles.disabled,
            ]}
          >
            {busy !== 'idle' ? (
              <ActivityIndicator color={COLORS.accentInk} />
            ) : (
              <Text style={styles.primaryText}>
                {quote?.transaction ? 'APPROVE IN WALLET' : account ? 'PREVIEW' : 'CONNECT & PREVIEW'}
              </Text>
            )}
          </Pressable>
          <Text style={styles.legal}>Tokenized stocks. You approve every transaction.</Text>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  amountRow: { alignItems: 'center', borderBottomColor: COLORS.line, borderBottomWidth: 2, flexDirection: 'row' },
  arrow: { color: COLORS.muted, fontSize: 18 },
  backdrop: { backgroundColor: 'rgba(0,0,0,.7)', flex: 1, justifyContent: 'flex-end' },
  close: { color: COLORS.text, fontSize: 32, lineHeight: 34 },
  currency: { color: COLORS.text, fontSize: 30, fontWeight: '700' },
  detail: { color: COLORS.muted, fontSize: 12, marginTop: 12 },
  disabled: { opacity: 0.55 },
  eyebrow: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  input: { color: COLORS.text, flex: 1, fontSize: 38, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 12 },
  label: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 28 },
  legal: { color: COLORS.muted, fontSize: 11, marginTop: 12, textAlign: 'center' },
  message: { color: COLORS.text, fontSize: 13, lineHeight: 19, marginTop: 16 },
  pressed: { opacity: 0.75 },
  primary: { alignItems: 'center', minHeight: 52, justifyContent: 'center', marginTop: 22 },
  buyPrimary: { backgroundColor: COLORS.buy },
  sellPrimary: { backgroundColor: COLORS.sell },
  primaryText: { color: COLORS.accentInk, fontSize: 13, fontWeight: '800', letterSpacing: 0.8 },
  sheet: { backgroundColor: COLORS.raised, paddingBottom: 28, paddingHorizontal: 22, paddingTop: 20 },
  summary: { alignItems: 'center', flexDirection: 'row', gap: 12, justifyContent: 'space-between', marginTop: 24 },
  summaryRight: { textAlign: 'right' },
  summaryText: { color: COLORS.text, flex: 1, fontSize: 13, fontWeight: '700' },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  unit: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
})
