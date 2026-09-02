import AsyncStorage from '@react-native-async-storage/async-storage'
import { fromUint8Array } from '@wallet-ui/react-native-kit'
import { createChallenge, verifyChallenge, type NewCall } from './api'

type SignMessages = (message: Uint8Array) => Promise<Uint8Array>

function key(wallet: string) {
  return `heystockers:session:${wallet}`
}

export async function getSession(wallet: string, signMessages: SignMessages) {
  const stored = await AsyncStorage.getItem(key(wallet))
  if (stored) return stored

  const challenge = await createChallenge(wallet)
  const signed = await signMessages(new TextEncoder().encode(challenge.message))
  // Mobile Wallet Adapter returns the signed message as the original bytes with the
  // 64-byte signature appended. The backend verifies a detached signature, so send
  // only the trailing 64 bytes. (slice(-64) is a no-op for a wallet that already
  // returns a bare signature.)
  const signature = signed.slice(-64)
  const verified = await verifyChallenge(wallet, challenge.challengeId, fromUint8Array(signature))
  await AsyncStorage.setItem(key(wallet), verified.token)
  return verified.token
}

export function clearSession(wallet: string) {
  return AsyncStorage.removeItem(key(wallet))
}

export type PendingProof = { call: NewCall; signature: string }

function proofKey(wallet: string) {
  return `heystockers:proof:${wallet}`
}

export async function loadPendingProof(wallet: string) {
  const stored = await AsyncStorage.getItem(proofKey(wallet))
  if (!stored) return null
  const proof = JSON.parse(stored) as Partial<PendingProof>
  if (!proof.call || typeof proof.signature !== 'string') {
    await AsyncStorage.removeItem(proofKey(wallet))
    return null
  }
  return proof as PendingProof
}

export function savePendingProof(wallet: string, proof: PendingProof) {
  return AsyncStorage.setItem(proofKey(wallet), JSON.stringify(proof))
}

export function clearPendingProof(wallet: string) {
  return AsyncStorage.removeItem(proofKey(wallet))
}
