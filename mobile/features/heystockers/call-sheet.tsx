import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { formatUsd, getAsset, TRADE_ASSETS } from './assets'
import type { NewCall } from './api'
import { COLORS } from './theme'

type Props = {
  open: boolean
  prices: Record<string, number | null>
  onClose(): void
  onPublish(call: NewCall): Promise<void>
}

export function CallSheet({ open, prices, onClose, onPublish }: Props) {
  const [symbol, setSymbol] = useState('NVDAx')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [target, setTarget] = useState('')
  const [days, setDays] = useState(7)
  const [commitment, setCommitment] = useState('10')
  const [thesis, setThesis] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  function suggestTarget(nextSymbol: string, nextSide: 'BUY' | 'SELL') {
    const price = prices[nextSymbol]
    setTarget(price ? (price * (nextSide === 'BUY' ? 1.05 : 0.95)).toFixed(2) : '')
  }

  useEffect(() => {
    if (!open) return
    setBusy(false)
    setMessage('')
    suggestTarget(symbol, side)
  }, [open]) // Reset transient state each time the sheet opens.

  async function publish() {
    const entry = prices[symbol]
    const targetPrice = Number(target)
    const commitmentUsdc = Number(commitment)
    if (!entry) return setMessage('A live entry price is required.')
    if (!Number.isFinite(targetPrice) || (side === 'BUY' ? targetPrice <= entry : targetPrice >= entry)) {
      return setMessage(
        side === 'BUY' ? 'A Buy target must be above the live price.' : 'A Sell target must be below the live price.',
      )
    }
    if (!Number.isFinite(commitmentUsdc) || commitmentUsdc < 1 || commitmentUsdc > 25) {
      return setMessage('Commit between $1 and $25.')
    }
    if (thesis.trim().length < 10 || thesis.trim().length > 280) {
      return setMessage('Explain your call in 10–280 characters.')
    }

    setBusy(true)
    setMessage('Verify your wallet, then review the matching trade.')
    try {
      await onPublish({
        symbol,
        side,
        targetPrice,
        commitmentUsdc,
        thesis: thesis.trim(),
        deadline: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
      })
      setThesis('')
      onClose()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The call could not be published.')
    } finally {
      setBusy(false)
    }
  }

  const asset = getAsset(symbol)
  const entry = prices[symbol] ?? null

  return (
    <Modal animationType="slide" visible={open} onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>POSITION CALL</Text>
            <Text style={styles.title}>Commit to a trade.</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>×</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>STOCK</Text>
          <View style={styles.options}>
            {TRADE_ASSETS.map((candidate) => (
              <Pressable
                accessibilityRole="button"
                key={candidate.symbol}
                onPress={() => {
                  setSymbol(candidate.symbol)
                  suggestTarget(candidate.symbol, side)
                }}
                style={[styles.option, symbol === candidate.symbol && styles.optionActive]}
              >
                <Text style={[styles.optionText, symbol === candidate.symbol && styles.optionTextActive]}>
                  {candidate.symbol}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.entry}>
            {asset.shortName} now {formatUsd(entry)}
          </Text>

          <Text style={styles.label}>DIRECTION</Text>
          <View style={styles.halfRow}>
            {(['BUY', 'SELL'] as const).map((value) => (
              <Pressable
                accessibilityRole="button"
                key={value}
                onPress={() => {
                  setSide(value)
                  suggestTarget(symbol, value)
                }}
                style={[
                  styles.half,
                  side === value && styles.optionActive,
                  side === value && (value === 'BUY' ? styles.optionBuy : styles.optionSell),
                ]}
              >
                <Text style={[styles.optionText, side === value && styles.optionTextActive]}>{value}</Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.fieldsRow}>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>TARGET</Text>
              <TextInput
                accessibilityLabel="Target price"
                keyboardType="decimal-pad"
                onChangeText={setTarget}
                placeholder="0.00"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={target}
              />
            </View>
            <View style={styles.fieldHalf}>
              <Text style={styles.label}>COMMITMENT</Text>
              <TextInput
                accessibilityLabel="Commitment in USDC"
                keyboardType="decimal-pad"
                onChangeText={setCommitment}
                placeholder="10"
                placeholderTextColor={COLORS.muted}
                style={styles.input}
                value={commitment}
              />
            </View>
          </View>

          <Text style={styles.label}>DEADLINE</Text>
          <View style={styles.options}>
            {[1, 7, 30].map((value) => (
              <Pressable
                accessibilityRole="button"
                key={value}
                onPress={() => setDays(value)}
                style={[styles.option, days === value && styles.optionActive]}
              >
                <Text style={[styles.optionText, days === value && styles.optionTextActive]}>{value}D</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>WHY?</Text>
          <TextInput
            accessibilityLabel="Reason for position call"
            maxLength={280}
            multiline
            onChangeText={setThesis}
            placeholder="What makes this trade worth taking?"
            placeholderTextColor={COLORS.muted}
            style={[styles.input, styles.thesis]}
            value={thesis}
          />
          <Text style={styles.count}>{thesis.length}/280</Text>

          {message ? <Text style={styles.message}>{message}</Text> : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={publish}
            style={({ pressed }) => [styles.primary, pressed && styles.pressed, busy && styles.disabled]}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.accentInk} />
            ) : (
              <Text style={styles.primaryText}>REVIEW TRADE</Text>
            )}
          </Pressable>
          <Text style={styles.note}>Approve trade → verify on-chain → publish. Rejecting creates no post.</Text>
        </ScrollView>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  close: { color: COLORS.text, fontSize: 32, lineHeight: 34 },
  content: { paddingBottom: 36, paddingHorizontal: 20 },
  count: { color: COLORS.muted, fontSize: 11, marginTop: 6, textAlign: 'right' },
  disabled: { opacity: 0.55 },
  entry: { color: COLORS.muted, fontSize: 13, marginTop: 12 },
  eyebrow: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
  fieldHalf: { flex: 1 },
  fieldsRow: { flexDirection: 'row', gap: 12 },
  half: { alignItems: 'center', flex: 1, paddingVertical: 13 },
  halfRow: { borderBottomColor: COLORS.line, borderBottomWidth: 1, flexDirection: 'row' },
  header: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', padding: 20 },
  input: {
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    color: COLORS.text,
    fontSize: 18,
    paddingVertical: 10,
  },
  label: { color: COLORS.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 26 },
  message: { color: COLORS.text, fontSize: 13, lineHeight: 19, marginTop: 18 },
  note: { color: COLORS.muted, fontSize: 11, lineHeight: 16, marginTop: 12, textAlign: 'center' },
  option: { alignItems: 'center', flex: 1, paddingVertical: 11 },
  optionActive: { backgroundColor: COLORS.accent },
  optionBuy: { backgroundColor: COLORS.buy },
  optionSell: { backgroundColor: COLORS.sell },
  optionText: { color: COLORS.muted, fontSize: 12, fontWeight: '800' },
  optionTextActive: { color: COLORS.accentInk },
  options: { borderBottomColor: COLORS.line, borderBottomWidth: 1, flexDirection: 'row', marginTop: 6 },
  pressed: { opacity: 0.75 },
  primary: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    marginTop: 24,
    minHeight: 52,
  },
  primaryText: { color: COLORS.accentInk, fontSize: 13, fontWeight: '900', letterSpacing: 0.8 },
  screen: { backgroundColor: COLORS.background, flex: 1, paddingTop: 18 },
  thesis: { minHeight: 88, textAlignVertical: 'top' },
  title: { color: COLORS.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
})
