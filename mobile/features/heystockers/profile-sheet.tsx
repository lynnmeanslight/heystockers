import { useState } from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import { openBrowserAsync } from 'expo-web-browser'
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { searchProfiles, type UserProfile } from './api'
import { COLORS } from './theme'

type Props = {
  open: boolean
  wallet: string
  profile: UserProfile | null
  referralCode: string
  onClose(): void
  onSave(username: string): Promise<void>
  onFollow(wallet: string): Promise<boolean>
  onDelete(): Promise<void>
}

export function ProfileSheet({ open, wallet, profile, referralCode, onClose, onSave, onFollow, onDelete }: Props) {
  const [username, setUsername] = useState(profile?.username ?? '')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<UserProfile[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function save() {
    setBusy(true)
    setMessage('')
    try {
      await onSave(username)
      setMessage('Username saved.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Username could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function search() {
    if (query.trim().replace(/^@/, '').length < 2) {
      setMessage('Enter at least 2 characters.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const found = await searchProfiles(query, wallet)
      setResults(found)
      if (!found.length) setMessage('No usernames found.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Search is unavailable.')
    } finally {
      setBusy(false)
    }
  }

  async function follow(candidate: UserProfile) {
    try {
      const following = await onFollow(candidate.wallet)
      setResults((current) => current.map((item) => (item.wallet === candidate.wallet ? { ...item, following } : item)))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Follow could not be updated.')
    }
  }

  function copyInvite() {
    if (!profile) return
    Clipboard.setString(`https://heystockers.trade/?ref=${profile.referralCode}`)
    setMessage('Invite link copied.')
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your HeyStockers account?',
      'Your username, social activity, and position calls will be removed. Onchain transactions cannot be erased.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: () => {
            setBusy(true)
            void onDelete()
              .catch((error) => setMessage(error instanceof Error ? error.message : 'Account could not be deleted.'))
              .finally(() => setBusy(false))
          },
        },
      ],
    )
  }

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={open}>
      <View style={styles.backdrop}>
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.topline}>
            <Text style={styles.eyebrow}>COMMUNITY</Text>
            <Pressable accessibilityLabel="Close community" accessibilityRole="button" onPress={onClose}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text accessibilityRole="header" style={styles.title}>
              {profile ? `@${profile.username}` : 'Find your people.'}
            </Text>

            {wallet && !profile ? (
              <View style={styles.createBlock}>
                <Text style={styles.label}>CLAIM YOUR USERNAME</Text>
                <View style={styles.inputRow}>
                  <Text style={styles.prefix}>@</Text>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                    onChangeText={(value) => setUsername(value.toLowerCase())}
                    placeholder="stocktrader"
                    placeholderTextColor={COLORS.muted}
                    style={styles.input}
                    value={username}
                  />
                </View>
                <Text style={styles.help}>3–20 CHARACTERS · STARTS WITH A LETTER</Text>
                {referralCode ? <Text style={styles.help}>INVITE DETECTED · {referralCode.toUpperCase()}</Text> : null}
                <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={styles.primaryButton}>
                  <Text style={styles.primaryText}>{busy ? 'SAVING…' : 'CREATE PROFILE'}</Text>
                </Pressable>
              </View>
            ) : null}

            {!wallet ? (
              <Text style={styles.note}>Connect your wallet to claim a username. Search remains public.</Text>
            ) : null}

            {profile ? (
              <View style={styles.stats}>
                <View>
                  <Text style={styles.statValue}>{profile.referralCount}</Text>
                  <Text style={styles.statLabel}>REFERRALS</Text>
                </View>
                <View>
                  <Text style={styles.statValue}>{profile.followerCount}</Text>
                  <Text style={styles.statLabel}>FOLLOWERS</Text>
                </View>
                <View>
                  <Text style={styles.statValue}>
                    {profile.wins}W–{profile.losses}L
                  </Text>
                  <Text style={styles.statLabel}>RECORD</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={copyInvite} style={styles.copyButton}>
                  <Text style={styles.copyText}>COPY INVITE</Text>
                </Pressable>
              </View>
            ) : null}

            <Text style={styles.label}>SEARCH USERNAMES</Text>
            <View style={styles.inputRow}>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => setQuery(value.toLowerCase())}
                onSubmitEditing={search}
                placeholder="@username"
                placeholderTextColor={COLORS.muted}
                returnKeyType="search"
                style={styles.input}
                value={query}
              />
              <Pressable accessibilityRole="button" disabled={busy} onPress={search} style={styles.findButton}>
                <Text style={styles.findText}>{busy ? '…' : 'FIND'}</Text>
              </Pressable>
            </View>

            {results.map((candidate) => (
              <View key={candidate.wallet} style={styles.personRow}>
                <View style={styles.initial}>
                  <Text style={styles.initialText}>{candidate.username.slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={styles.personName}>
                  <Text style={styles.personUsername}>@{candidate.username}</Text>
                  <Text style={styles.personMeta}>
                    {candidate.wins}W–{candidate.losses}L · {candidate.followerCount} followers
                  </Text>
                </View>
                {profile && candidate.wallet !== wallet ? (
                  <Pressable accessibilityRole="button" onPress={() => follow(candidate)}>
                    <Text style={styles.followText}>{candidate.following ? 'FOLLOWING' : 'FOLLOW'}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {message ? (
              <Text accessibilityLiveRegion="polite" style={styles.message}>
                {message}
              </Text>
            ) : null}
            <View style={styles.legalLinks}>
              <Pressable accessibilityRole="link" onPress={() => openBrowserAsync('https://heystockers.trade/privacy')}>
                <Text style={styles.legalLink}>PRIVACY</Text>
              </Pressable>
              <Pressable accessibilityRole="link" onPress={() => openBrowserAsync('https://heystockers.trade/terms')}>
                <Text style={styles.legalLink}>TERMS</Text>
              </Pressable>
              {profile ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={confirmDelete}>
                  <Text style={styles.deleteLink}>DELETE ACCOUNT</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.72)', flex: 1, justifyContent: 'flex-end' },
  close: { color: COLORS.text, fontSize: 26, lineHeight: 28 },
  copyButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    minHeight: 38,
    paddingHorizontal: 12,
  },
  copyText: { color: COLORS.accentInk, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  createBlock: { marginBottom: 28 },
  eyebrow: { color: COLORS.muted, fontSize: 9, fontWeight: '900', letterSpacing: 0.8 },
  findButton: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    minWidth: 58,
  },
  findText: { color: COLORS.accentInk, fontSize: 9, fontWeight: '900' },
  followText: { color: COLORS.accent, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  help: { color: COLORS.muted, fontSize: 7, marginTop: 7 },
  initial: {
    alignItems: 'center',
    backgroundColor: COLORS.accentSoft,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  initialText: { color: COLORS.accent, fontSize: 10, fontWeight: '900' },
  input: { color: COLORS.text, flex: 1, fontSize: 13, minHeight: 44, paddingHorizontal: 12 },
  inputRow: { alignItems: 'center', backgroundColor: COLORS.surface, flexDirection: 'row', minHeight: 44 },
  legalLink: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  legalLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 30, paddingBottom: 8 },
  deleteLink: { color: COLORS.sell, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  label: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginBottom: 7 },
  message: { color: COLORS.text, fontSize: 10, marginTop: 14 },
  note: { color: COLORS.muted, fontSize: 11, marginBottom: 24 },
  personMeta: { color: COLORS.muted, fontSize: 8, marginTop: 3 },
  personName: { flex: 1 },
  personRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 60,
  },
  personUsername: { color: COLORS.text, fontSize: 11, fontWeight: '800' },
  prefix: { color: COLORS.muted, paddingLeft: 12 },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    marginTop: 14,
    minHeight: 40,
  },
  primaryText: { color: COLORS.accentInk, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  sheet: { backgroundColor: COLORS.background, maxHeight: '90%', padding: 22 },
  statLabel: { color: COLORS.muted, fontSize: 7, marginTop: 3 },
  stats: {
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    borderTopColor: COLORS.line,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 22,
    marginBottom: 26,
    paddingVertical: 16,
  },
  statValue: { color: COLORS.text, fontSize: 13, fontWeight: '800' },
  title: { color: COLORS.text, fontFamily: 'serif', fontSize: 34, letterSpacing: -1, marginBottom: 26, marginTop: 22 },
  topline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
})
