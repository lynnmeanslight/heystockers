import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { COLORS } from './theme'

const STEPS = [
  {
    title: 'Connect your wallet.',
    body: 'HeyStockers reads only your USDC and supported stock balances. Nothing moves until you approve a transaction.',
  },
  {
    title: 'Choose a stock.',
    body: 'Browse the highest-volume Solana stocks. Buy with USDC, or sell a stock already held in your wallet.',
  },
  {
    title: 'Preview, then approve.',
    body: 'Preview gets a live route. Your wallet shows the final transaction; closing or rejecting it changes nothing.',
  },
  {
    title: 'Publish a verified call.',
    body: 'Set a target, deadline and reason. Your call becomes public only after its matching trade is verified onchain.',
  },
] as const

type Props = { open: boolean; onClose(): void }

export function GuideSheet({ open, onClose }: Props) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const last = step === STEPS.length - 1

  function close() {
    setStep(0)
    onClose()
  }

  return (
    <Modal animationType="fade" onRequestClose={close} transparent visible={open}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.card}>
          <View style={styles.topline}>
            <Text style={styles.eyebrow}>
              GUIDE · {step + 1}/{STEPS.length}
            </Text>
            <Pressable accessibilityLabel="Close user guide" accessibilityRole="button" onPress={close}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <View style={styles.progress}>
            {STEPS.map((_, index) => (
              <View key={index} style={[styles.progressStep, index <= step && styles.progressStepActive]} />
            ))}
          </View>
          <Text accessibilityRole="header" style={styles.title}>
            {current.title}
          </Text>
          <Text style={styles.body}>{current.body}</Text>
          <View style={styles.actions}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setStep((value) => value - 1)}
                style={styles.backButton}
              >
                <Text style={styles.backText}>BACK</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => (last ? close() : setStep((value) => value + 1))}
              style={styles.nextButton}
            >
              <Text style={styles.nextText}>{last ? 'START TRADING' : 'NEXT'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  actions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 32 },
  backdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.78)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  backButton: { justifyContent: 'center', minHeight: 44, paddingHorizontal: 8 },
  backText: { color: COLORS.muted, fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  body: { color: COLORS.text, fontSize: 15, lineHeight: 22 },
  card: {
    backgroundColor: COLORS.raised,
    borderColor: COLORS.line,
    borderWidth: 1,
    maxWidth: 420,
    padding: 24,
    width: '100%',
  },
  close: { color: COLORS.text, fontSize: 25, lineHeight: 28 },
  eyebrow: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.9 },
  nextButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 18,
  },
  nextText: { color: COLORS.accentInk, fontSize: 11, fontWeight: '900', letterSpacing: 0.5 },
  progress: { flexDirection: 'row', gap: 5, marginBottom: 28, marginTop: 18 },
  progressStep: { backgroundColor: COLORS.line, flex: 1, height: 2 },
  progressStepActive: { backgroundColor: COLORS.accent },
  title: { color: COLORS.text, fontSize: 25, fontWeight: '900', letterSpacing: -0.7, marginBottom: 12 },
  topline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
})
