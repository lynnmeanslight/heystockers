import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Image } from 'expo-image'
import { useURL } from 'expo-linking'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import {
  ApiError,
  createPositionCall,
  deleteProfile,
  getFeed,
  getPortfolio,
  getProfile,
  getQuotes,
  saveProfile,
  searchProfiles,
  toggleFollow,
  toggleSignal,
  type NewCall,
  type PositionCall,
} from './api'
import { formatUsd, formatVolume, getAsset, shortAddress, TRADE_ASSETS } from './assets'
import { CallSheet } from './call-sheet'
import { GuideSheet } from './guide-sheet'
import { hasSeenGuide, markGuideSeen } from './guide-state'
import {
  clearPendingProof,
  clearSession,
  getSession,
  loadPendingProof,
  savePendingProof,
  type PendingProof,
} from './session'
import { TradeSheet } from './trade-sheet'
import { ProfileSheet } from './profile-sheet'
import { COLORS } from './theme'

type TradeState = {
  open: boolean
  symbol: string
  side: 'buy' | 'sell'
  amount?: number
  call?: NewCall
}

const emptyTrade: TradeState = { open: false, symbol: 'NVDAx', side: 'buy' }

function timeAgo(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function callStatus(call: PositionCall) {
  if (!call.executionSignature) return 'WAITING FOR TRADE'
  return call.outcome
}

export function HeyStockersScreen() {
  const { account, connect, disconnect, signMessages } = useMobileWallet()
  const queryClient = useQueryClient()
  const wallet = account?.address.toString() ?? ''
  const incomingUrl = useURL()
  const [trade, setTrade] = useState<TradeState>(emptyTrade)
  const [callOpen, setCallOpen] = useState(false)
  const [banner, setBanner] = useState('')
  const [walletBusy, setWalletBusy] = useState(false)
  const [pendingProof, setPendingProof] = useState<PendingProof | null>(null)
  const [proofBusy, setProofBusy] = useState(false)
  const [marketExpanded, setMarketExpanded] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [peopleSearchTerm, setPeopleSearchTerm] = useState('')
  const feePulse = useRef(new Animated.Value(0.25)).current
  const referralCode = useMemo(() => {
    if (!incomingUrl) return ''
    try {
      return new URL(incomingUrl).searchParams.get('ref')?.trim() ?? ''
    } catch {
      return ''
    }
  }, [incomingUrl])

  const quotes = useQuery({
    queryKey: ['stock-quotes'],
    queryFn: getQuotes,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  })
  const portfolio = useQuery({
    queryKey: ['portfolio', wallet],
    queryFn: () => getPortfolio(wallet),
    enabled: Boolean(wallet),
    staleTime: 15_000,
    refetchInterval: wallet ? 60_000 : false,
    retry: 1,
  })
  const feed = useQuery({
    queryKey: ['position-calls', wallet],
    queryFn: () => getFeed(wallet),
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: 1,
  })
  const profile = useQuery({
    queryKey: ['profile', wallet],
    queryFn: () => getProfile(wallet, wallet),
    enabled: Boolean(wallet),
    staleTime: 30_000,
    retry: 1,
  })
  const normalizedPeopleQuery = peopleQuery.trim().replace(/^@/, '')
  const peopleSearchPending = normalizedPeopleQuery !== peopleSearchTerm
  const peopleSearch = useQuery({
    queryKey: ['profile-search', peopleSearchTerm, wallet],
    queryFn: () => searchProfiles(peopleSearchTerm, wallet),
    enabled: peopleSearchTerm.length >= 2,
    staleTime: 15_000,
    retry: 1,
  })

  useEffect(() => {
    const timer = setTimeout(() => setPeopleSearchTerm(normalizedPeopleQuery), 250)
    return () => clearTimeout(timer)
  }, [normalizedPeopleQuery])

  useEffect(() => {
    if (!wallet || !profile.isSuccess || profile.data) return
    const timer = setTimeout(() => setProfileOpen(true), 0)
    return () => clearTimeout(timer)
  }, [profile.data, profile.isSuccess, wallet])

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(feePulse, { duration: 800, toValue: 1, useNativeDriver: true }),
        Animated.timing(feePulse, { duration: 800, toValue: 0.25, useNativeDriver: true }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [feePulse])

  useEffect(() => {
    void hasSeenGuide()
      .then((seen) => {
        if (!seen) setGuideOpen(true)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!wallet) {
      setPendingProof(null)
      return
    }
    void loadPendingProof(wallet)
      .then(setPendingProof)
      .catch(() => undefined)
  }, [wallet])

  const prices = useMemo(
    () => ({ ...(quotes.data?.prices ?? {}), ...(portfolio.data?.prices ?? {}) }),
    [portfolio.data?.prices, quotes.data?.prices],
  )
  const visibleAssets = marketExpanded ? TRADE_ASSETS : TRADE_ASSETS.slice(0, 10)
  const sellValues = useMemo(
    () =>
      Object.fromEntries(
        (portfolio.data?.holdings ?? [])
          .filter((holding) => holding.symbol !== 'USDC')
          .map((holding) => [holding.symbol, holding.valueUsd ?? 0]),
      ),
    [portfolio.data?.holdings],
  )

  async function connectWallet() {
    setWalletBusy(true)
    setBanner('')
    try {
      await connect()
      setBanner('Wallet connected.')
    } catch {
      setBanner('Wallet connection cancelled.')
    } finally {
      setWalletBusy(false)
    }
  }

  async function disconnectWallet() {
    setWalletBusy(true)
    try {
      if (wallet) await clearSession(wallet)
      await disconnect()
      setTrade(emptyTrade)
      setBanner('Wallet disconnected.')
    } catch {
      setBanner('The wallet could not be disconnected.')
    } finally {
      setWalletBusy(false)
    }
  }

  async function withSession<T>(activeWallet: string, action: (token: string) => Promise<T>) {
    let token = await getSession(activeWallet, (message) => signMessages(message))
    try {
      return await action(token)
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error
      await clearSession(activeWallet)
      token = await getSession(activeWallet, (message) => signMessages(message))
      return action(token)
    }
  }

  async function publishCall(call: NewCall) {
    if (!profile.data) {
      setProfileOpen(true)
      setBanner('Create a username before publishing a position call.')
      return
    }
    const activeAccount = account ?? (await connect())
    const activeWallet = activeAccount.address.toString()
    await getSession(activeWallet, (message) => signMessages(message))
    setTrade({
      open: true,
      symbol: call.symbol,
      side: call.side === 'BUY' ? 'buy' : 'sell',
      amount: call.commitmentUsdc,
      call,
    })
    setBanner('Approve the matching trade to publish. Rejecting creates no post.')
  }

  async function verifyProof(proof: PendingProof, allowRetries = true) {
    if (!wallet) return false
    setProofBusy(true)
    try {
      const delays = allowRetries ? [0, 1_500, 2_500] : [0]
      let lastError: unknown
      for (const delay of delays) {
        if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
        try {
          await withSession(wallet, (token) => createPositionCall(token, proof.call, proof.signature))
          await clearPendingProof(wallet)
          setPendingProof(null)
          setBanner('Trade verified. Your position call is public.')
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['position-calls'] }),
            queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
          ])
          return true
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    } catch {
      setBanner('Trade submitted. Proof is still confirming—tap Retry proof shortly.')
      return false
    } finally {
      setProofBusy(false)
    }
  }

  async function tradeExecuted(signature: string) {
    setBanner('Trade submitted.')
    await queryClient.invalidateQueries({ queryKey: ['portfolio'] })
    if (!trade.call || !wallet) return
    const proof = { call: trade.call, signature }
    setPendingProof(proof)
    await savePendingProof(wallet, proof)
    await verifyProof(proof)
  }

  async function socialAction(action: (token: string) => Promise<unknown>) {
    if (!profile.data) {
      setProfileOpen(true)
      throw new Error('Create a username before joining the social feed.')
    }
    const activeAccount = account ?? (await connect())
    const activeWallet = activeAccount.address.toString()
    await withSession(activeWallet, action)
    await queryClient.invalidateQueries({ queryKey: ['position-calls'] })
  }

  async function refresh() {
    await Promise.all([quotes.refetch(), feed.refetch(), wallet ? portfolio.refetch() : Promise.resolve()])
  }

  function closeGuide() {
    setGuideOpen(false)
    void markGuideSeen().catch(() => undefined)
  }

  async function saveUsername(username: string) {
    const activeAccount = account ?? (await connect())
    const activeWallet = activeAccount.address.toString()
    const saved = await withSession(activeWallet, (token) => saveProfile(token, username, referralCode))
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile', activeWallet] }),
      queryClient.invalidateQueries({ queryKey: ['position-calls'] }),
    ])
    setBanner(
      saved.referralStatus === 'applied'
        ? `Welcome @${saved.profile.username}. Referral recorded.`
        : `Welcome @${saved.profile.username}.`,
    )
  }

  async function deleteUserAccount() {
    if (!wallet) return
    await withSession(wallet, (token) => deleteProfile(token))
    await clearSession(wallet)
    await disconnect()
    setProfileOpen(false)
    setTrade(emptyTrade)
    setPendingProof(null)
    setBanner('Your HeyStockers account was deleted.')
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['profile'] }),
      queryClient.invalidateQueries({ queryKey: ['position-calls'] }),
      queryClient.invalidateQueries({ queryKey: ['portfolio'] }),
    ])
  }

  async function followProfile(targetWallet: string) {
    let following = false
    await socialAction(async (token) => {
      const result = await toggleFollow(token, targetWallet)
      following = result.following
    })
    return following
  }

  const calls = feed.data?.calls ?? []
  const stockHoldings = portfolio.data?.holdings.filter((holding) => holding.symbol !== 'USDC') ?? []
  const refreshing = quotes.isRefetching || feed.isRefetching || portfolio.isRefetching

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.topbar}>
        <Text style={styles.brand}>HEYSTOCKERS</Text>
        <View style={styles.topbarActions}>
          <Pressable accessibilityRole="button" onPress={() => setGuideOpen(true)} style={styles.guideButton}>
            <Text style={styles.guideButtonText}>GUIDE</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="People and username"
            accessibilityRole="button"
            onPress={() => setProfileOpen(true)}
            style={styles.peopleTopbarButton}
          >
            <Text style={styles.peopleTopbarText}>PEOPLE</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={walletBusy}
            onPress={wallet ? disconnectWallet : connectWallet}
            style={({ pressed }) => [styles.walletButton, pressed && styles.pressed]}
          >
            {walletBusy ? (
              <ActivityIndicator color={COLORS.accentInk} size="small" />
            ) : (
              <Text style={styles.walletButtonText}>
                {wallet ? `${shortAddress(wallet)} · DISCONNECT` : 'CONNECT WALLET'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <View
        accessibilityLabel="Launch offer: zero percent HeyStockers platform fee. Network and market costs may apply."
        accessible
        style={styles.zeroFeeBanner}
      >
        <Animated.View style={[styles.zeroFeeDot, { opacity: feePulse }]} />
        <Text style={styles.zeroFeeText}>0% HEYSTOCKERS FEE</Text>
        <Text style={styles.zeroFeeNote}>NETWORK + MARKET COSTS MAY APPLY</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl onRefresh={refresh} refreshing={refreshing} tintColor={COLORS.accent} />}
      >
        <View style={styles.peopleSearch}>
          <Text style={styles.peopleSearchIcon}>⌕</Text>
          <TextInput
            accessibilityLabel="Search people"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={(value) => setPeopleQuery(value.toLowerCase())}
            placeholder="Search people"
            placeholderTextColor={COLORS.muted}
            style={styles.peopleSearchInput}
            value={peopleQuery}
          />
          {peopleQuery ? (
            <Pressable
              accessibilityLabel="Clear people search"
              onPress={() => setPeopleQuery('')}
              style={styles.peopleSearchClear}
            >
              <Text style={styles.peopleSearchClearText}>×</Text>
            </Pressable>
          ) : null}
        </View>
        {normalizedPeopleQuery.length >= 2 ? (
          <View style={styles.peopleSearchResults}>
            {peopleSearchPending || peopleSearch.isLoading ? (
              <ActivityIndicator color={COLORS.accent} style={styles.peopleSearchLoader} />
            ) : null}
            {!peopleSearchPending && peopleSearch.isError ? (
              <Text style={styles.peopleSearchEmpty}>Search unavailable.</Text>
            ) : null}
            {!peopleSearchPending && peopleSearch.isSuccess && peopleSearch.data.length === 0 ? (
              <Text style={styles.peopleSearchEmpty}>No users found.</Text>
            ) : null}
            {!peopleSearchPending &&
              peopleSearch.data?.slice(0, 5).map((candidate) => (
                <View key={candidate.wallet} style={styles.personRow}>
                  <View style={styles.personInitial}>
                    <Text style={styles.personInitialText}>{candidate.username.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={styles.personIdentity}>
                    <Text style={styles.personUsername}>@{candidate.username}</Text>
                    <Text style={styles.personMeta}>
                      {candidate.wins}W–{candidate.losses}L · {candidate.followerCount} followers
                    </Text>
                  </View>
                  {profile.data && candidate.wallet !== wallet ? (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        followProfile(candidate.wallet)
                          .then(() => peopleSearch.refetch())
                          .catch((error) => setBanner(error instanceof Error ? error.message : 'Follow failed.'))
                      }
                    >
                      <Text style={styles.personFollow}>{candidate.following ? 'FOLLOWING' : 'FOLLOW'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
          </View>
        ) : null}
        {banner ? (
          <Pressable onPress={() => setBanner('')} style={styles.banner}>
            <Text style={styles.bannerText}>{banner}</Text>
            <Text style={styles.bannerClose}>×</Text>
          </Pressable>
        ) : null}
        {pendingProof ? (
          <Pressable
            accessibilityRole="button"
            disabled={proofBusy}
            onPress={() => verifyProof(pendingProof, false)}
            style={styles.proofButton}
          >
            <Text style={styles.proofText}>{proofBusy ? 'CHECKING PROOF…' : 'RETRY PROOF'}</Text>
          </Pressable>
        ) : null}

        <View style={styles.hero}>
          <View>
            <Text style={styles.kicker}>STOCK ACCOUNT</Text>
            <Text style={styles.heroValue}>{wallet ? formatUsd(portfolio.data?.stockValueUsd) : '—'}</Text>
            <Text style={styles.heroLabel}>Stock value</Text>
          </View>
          <View style={styles.heroRight}>
            <Text style={styles.kicker}>BUYING POWER</Text>
            <Text style={styles.buyingPower}>{wallet ? formatUsd(portfolio.data?.usdcValueUsd ?? 0) : '—'}</Text>
            <Text style={styles.heroLabel}>USDC</Text>
          </View>
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Trade stocks</Text>
          {quotes.isError ? (
            <Text style={styles.muted}>OFFLINE</Text>
          ) : (
            <Text style={styles.muted}>TOP {TRADE_ASSETS.length} · LIVE</Text>
          )}
        </View>
        <View>
          {visibleAssets.map((asset) => (
            <View key={asset.symbol} style={styles.stockRow}>
              <Image
                accessibilityLabel={`${asset.shortName} logo`}
                contentFit="contain"
                source={asset.logo}
                style={styles.stockLogo}
              />
              <View style={styles.stockName}>
                <Text style={styles.stockSymbol}>{asset.symbol}</Text>
                <Text style={styles.muted}>{asset.shortName}</Text>
              </View>
              <View style={styles.marketNumbers}>
                <Text style={styles.stockPrice}>{formatUsd(prices[asset.symbol])}</Text>
                <Text style={styles.muted}>{formatVolume(quotes.data?.volumes[asset.symbol] ?? asset.volume24h)}</Text>
              </View>
              <View style={styles.rowActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTrade({ open: true, symbol: asset.symbol, side: 'buy' })}
                  style={styles.actionPrimary}
                >
                  <Text style={styles.actionPrimaryText}>BUY</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setTrade({ open: true, symbol: asset.symbol, side: 'sell' })}
                  style={styles.actionSecondary}
                >
                  <Text style={styles.actionSecondaryText}>SELL</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {TRADE_ASSETS.length > 10 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setMarketExpanded((expanded) => !expanded)}
              style={styles.marketToggle}
            >
              <Text style={styles.textAction}>
                {marketExpanded ? 'SHOW TOP 10' : `VIEW ALL ${TRADE_ASSETS.length}`}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Portfolio</Text>
          <Text style={styles.muted}>{stockHoldings.length || ''}</Text>
        </View>
        {!wallet ? <Text style={styles.empty}>Connect your wallet to see the stocks it actually owns.</Text> : null}
        {wallet && portfolio.isLoading ? <ActivityIndicator color={COLORS.accent} style={styles.loader} /> : null}
        {wallet && portfolio.isError ? (
          <Text style={styles.empty}>Portfolio unavailable. Pull down to retry.</Text>
        ) : null}
        {wallet && portfolio.isSuccess && stockHoldings.length === 0 ? (
          <Text style={styles.empty}>No supported stocks in this wallet.</Text>
        ) : null}
        {stockHoldings.map((holding) => (
          <Pressable
            accessibilityRole="button"
            key={holding.symbol}
            onPress={() => setTrade({ open: true, symbol: holding.symbol, side: 'sell' })}
            style={styles.holdingRow}
          >
            <Text style={styles.stockSymbol}>{holding.symbol}</Text>
            <Text style={styles.holdingAmount}>
              {holding.amount.toLocaleString('en-US', { maximumFractionDigits: 6 })}
            </Text>
            <Text style={styles.holdingValue}>{formatUsd(holding.valueUsd)}</Text>
          </Pressable>
        ))}

        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionTitle}>Position calls</Text>
            <Text style={styles.muted}>Reputation backed by real trades</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setCallOpen(true)} style={styles.makeCallButton}>
            <Text style={styles.makeCallText}>MAKE A CALL</Text>
          </Pressable>
        </View>
        {feed.isLoading ? <ActivityIndicator color={COLORS.accent} style={styles.loader} /> : null}
        {feed.isError ? <Text style={styles.empty}>Calls unavailable. Pull down to retry.</Text> : null}
        {feed.isSuccess && calls.length === 0 ? (
          <Text style={styles.empty}>No verified calls yet. Make the first one.</Text>
        ) : null}
        {calls.map((call) => {
          const authorIsViewer = call.wallet === wallet
          return (
            <View key={call.id} style={styles.callRow}>
              <View style={styles.callTopline}>
                <Text style={styles.callAuthor}>{call.username ? `@${call.username}` : shortAddress(call.wallet)}</Text>
                <Text style={styles.callMeta}>
                  {call.record.wins}W–{call.record.losses}L · {timeAgo(call.createdAt)}
                </Text>
              </View>
              <View style={styles.callHeadline}>
                <Text style={styles.callAsset}>
                  {call.side} {call.symbol}
                </Text>
                <Text style={styles.callOutcome}>{callStatus(call)}</Text>
              </View>
              <Text style={styles.callNumbers}>
                {formatUsd(call.entryPrice)} → {formatUsd(call.targetPrice)} · ${call.commitmentUsdc.toFixed(2)}{' '}
                committed
              </Text>
              <Text style={styles.thesis}>{call.thesis}</Text>
              <View style={styles.callActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    socialAction((token) => toggleSignal(token, call.id)).catch((error) => setBanner(error.message))
                  }
                >
                  <Text style={styles.textAction}>
                    {call.signaled ? 'SIGNALED' : 'SIGNAL'} {call.signalCount}
                  </Text>
                </Pressable>
                {!authorIsViewer ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      socialAction((token) => toggleFollow(token, call.wallet)).catch((error) =>
                        setBanner(error.message),
                      )
                    }
                  >
                    <Text style={styles.textAction}>{call.following ? 'FOLLOWING' : 'FOLLOW'}</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setTrade({
                      open: true,
                      symbol: call.symbol,
                      side: call.side === 'BUY' ? 'buy' : 'sell',
                      amount: call.commitmentUsdc,
                    })
                  }
                >
                  <Text style={styles.textAction}>COPY TRADE</Text>
                </Pressable>
              </View>
            </View>
          )
        })}
      </ScrollView>

      <CallSheet open={callOpen} onClose={() => setCallOpen(false)} onPublish={publishCall} prices={prices} />
      <ProfileSheet
        key={`${profileOpen}-${profile.data?.username ?? 'new'}`}
        onClose={() => setProfileOpen(false)}
        onFollow={followProfile}
        onDelete={deleteUserAccount}
        onSave={saveUsername}
        open={profileOpen}
        profile={profile.data ?? null}
        referralCode={referralCode}
        wallet={wallet}
      />
      <GuideSheet open={guideOpen} onClose={closeGuide} />
      <TradeSheet
        initialAmount={trade.amount}
        livePrice={prices[trade.symbol] ?? null}
        maxBuyUsd={portfolio.data?.usdcValueUsd ?? 0}
        maxSellUsd={sellValues[trade.symbol] ?? 0}
        locked={Boolean(trade.call)}
        onClose={() => setTrade(emptyTrade)}
        onExecuted={tradeExecuted}
        open={trade.open}
        side={trade.side}
        symbol={trade.symbol}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  actionPrimary: {
    alignItems: 'center',
    backgroundColor: COLORS.buy,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 56,
  },
  actionPrimaryText: { color: COLORS.buyInk, fontSize: 11, fontWeight: '900' },
  actionSecondary: { alignItems: 'center', justifyContent: 'center', minHeight: 34, minWidth: 48 },
  actionSecondaryText: { color: COLORS.sell, fontSize: 11, fontWeight: '800' },
  banner: {
    alignItems: 'center',
    backgroundColor: COLORS.raised,
    borderColor: COLORS.accent,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 12,
  },
  bannerClose: { color: COLORS.text, fontSize: 20 },
  bannerText: { color: COLORS.text, flex: 1, fontSize: 12, fontWeight: '700', paddingRight: 10 },
  brand: { color: COLORS.text, fontSize: 18, fontWeight: '900', letterSpacing: -0.6 },
  buyingPower: { color: COLORS.text, fontSize: 24, fontWeight: '800', letterSpacing: -0.5, marginTop: 4 },
  callActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 22, marginTop: 16 },
  callAsset: { color: COLORS.text, fontSize: 19, fontWeight: '900' },
  callAuthor: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  callHeadline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  callMeta: { color: COLORS.muted, fontSize: 11 },
  callNumbers: { color: COLORS.muted, fontSize: 12, marginTop: 8 },
  callOutcome: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  callRow: { borderBottomColor: COLORS.line, borderBottomWidth: 1, paddingVertical: 20 },
  callTopline: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  content: { paddingBottom: 60, paddingHorizontal: 16 },
  empty: { color: COLORS.muted, fontSize: 13, lineHeight: 19, paddingVertical: 22 },
  hero: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 28, paddingTop: 20 },
  heroLabel: { color: COLORS.muted, fontSize: 11, marginTop: 3 },
  heroRight: { alignItems: 'flex-end' },
  heroValue: { color: COLORS.text, fontSize: 36, fontWeight: '800', letterSpacing: -1.2, marginTop: 3 },
  guideButton: { alignItems: 'center', justifyContent: 'center', minHeight: 34, paddingHorizontal: 6 },
  guideButtonText: { color: COLORS.text, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  holdingAmount: { color: COLORS.muted, flex: 1, fontSize: 12, marginLeft: 12 },
  holdingRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingVertical: 15,
  },
  holdingValue: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  kicker: { color: COLORS.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  loader: { marginVertical: 26 },
  makeCallButton: { backgroundColor: COLORS.accent, paddingHorizontal: 12, paddingVertical: 10 },
  makeCallText: { color: COLORS.accentInk, fontSize: 10, fontWeight: '900', letterSpacing: 0.5 },
  marketNumbers: { alignItems: 'flex-end' },
  marketToggle: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  muted: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  peopleTopbarButton: { alignItems: 'center', justifyContent: 'center', minHeight: 34, paddingHorizontal: 4 },
  peopleTopbarText: { color: COLORS.text, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  peopleSearch: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    height: 44,
    marginTop: 12,
  },
  peopleSearchClear: { alignItems: 'center', height: 44, justifyContent: 'center', width: 44 },
  peopleSearchClearText: { color: COLORS.muted, fontSize: 20 },
  peopleSearchEmpty: { color: COLORS.muted, fontSize: 11, paddingHorizontal: 12, paddingVertical: 16 },
  peopleSearchIcon: { color: COLORS.muted, fontSize: 18, paddingLeft: 13 },
  peopleSearchInput: { color: COLORS.text, flex: 1, fontSize: 13, height: 44, paddingHorizontal: 10 },
  peopleSearchLoader: { marginVertical: 16 },
  peopleSearchResults: { borderBottomColor: COLORS.line, borderBottomWidth: 1 },
  personFollow: { color: COLORS.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  personIdentity: { flex: 1 },
  personInitial: {
    alignItems: 'center',
    backgroundColor: COLORS.accentSoft,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  personInitialText: { color: COLORS.accent, fontSize: 11, fontWeight: '900' },
  personMeta: { color: COLORS.muted, fontSize: 9, marginTop: 3 },
  personRow: { alignItems: 'center', flexDirection: 'row', gap: 11, minHeight: 62, paddingHorizontal: 2 },
  personUsername: { color: COLORS.text, fontSize: 12, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  proofButton: {
    alignItems: 'center',
    borderBottomColor: COLORS.accent,
    borderBottomWidth: 1,
    marginBottom: 12,
    padding: 10,
  },
  proofText: { color: COLORS.accent, fontSize: 11, fontWeight: '900', letterSpacing: 0.7 },
  rowActions: { alignItems: 'center', flexDirection: 'row', gap: 5, marginLeft: 12 },
  safeArea: { backgroundColor: COLORS.background, flex: 1 },
  sectionHeader: {
    alignItems: 'center',
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 12,
    paddingTop: 34,
  },
  sectionTitle: { color: COLORS.text, fontSize: 20, fontWeight: '800', letterSpacing: -0.5 },
  stockLogo: { height: 30, marginRight: 12, width: 30 },
  stockName: { flex: 1 },
  stockPrice: { color: COLORS.text, fontSize: 13, fontWeight: '700' },
  stockRow: {
    alignItems: 'center',
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 70,
  },
  stockSymbol: { color: COLORS.text, fontSize: 13, fontWeight: '800' },
  textAction: { color: COLORS.accent, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  thesis: { color: COLORS.text, fontSize: 14, lineHeight: 20, marginTop: 12 },
  topbar: {
    alignItems: 'center',
    borderBottomColor: COLORS.line,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 58,
    paddingHorizontal: 16,
  },
  topbarActions: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  walletButton: {
    alignItems: 'center',
    backgroundColor: COLORS.accent,
    justifyContent: 'center',
    minHeight: 34,
    minWidth: 110,
    paddingHorizontal: 10,
  },
  walletButtonText: { color: COLORS.accentInk, fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  zeroFeeBanner: {
    alignItems: 'center',
    backgroundColor: COLORS.accentSoft,
    borderBottomColor: '#D2DFFF',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 10,
  },
  zeroFeeDot: { backgroundColor: COLORS.accent, borderRadius: 3, height: 6, width: 6 },
  zeroFeeNote: { color: '#526E9B', fontSize: 6, fontWeight: '800', letterSpacing: 0.4 },
  zeroFeeText: { color: COLORS.accent, fontSize: 9, fontWeight: '900', letterSpacing: 0.7 },
})
