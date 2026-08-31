import { AppIdentity, createSolanaMainnet, SolanaCluster } from '@wallet-ui/react-native-kit'

export class AppConfig {
  static identity: AppIdentity = {
    name: 'HeyStockers',
    uri: 'https://heystockers.trade',
    icon: 'heystockers-mark-512.png',
  }
  static networks: SolanaCluster[] = [
    createSolanaMainnet({
      url: process.env.EXPO_PUBLIC_SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
    }),
  ]
}
