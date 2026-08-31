# Solana Mobile dApp Store readiness

The app is Android-first and uses Mobile Wallet Adapter. Wallet actions require a native development or release build; Expo Go cannot provide the wallet adapter.

## Implemented in the project

- Android package: `com.heystockers.mobile`
- Mainnet wallet adapter with the HeyStockers website and icon identity
- Production API default and explicit production EAS environment
- Dedicated `dapp-store` EAS profile that outputs an APK
- White launch/adaptive-icon background matching the current product
- Unneeded storage and overlay Android permissions blocked
- Wallet connect, disconnect, message authentication, and transaction approval
- The same 42-stock catalog and the same production APIs as the web app
- Privacy and terms pages linked inside the app
- Authenticated in-app account deletion
- Store copy and screenshot checklist in `STORE_LISTING.md`

## Owner steps before submission

1. Configure working mailboxes for `support@heystockers.trade` and `privacy@heystockers.trade`.
2. Have qualified counsel confirm that the tokenized-stock flow, supported jurisdictions, disclosures, and any required financial-services documentation comply with applicable law and the Solana Mobile Publisher Policy.
3. Link this folder to an Expo/EAS project (`eas init`) under the intended long-term owner account, then run `npm run build:dapp-store`. On the first build, create and securely retain a signing key dedicated to this store. Never commit or share that key. The local audit found EAS login is active, but no EAS project is linked yet.
4. Install the signed APK on a physical Android device with a compatible wallet. Test connect, disconnect, buy, sell, rejected trade, verified position call, retry proof, referral link, username search, and account deletion on mainnet with small amounts.
5. Record the release certificate SHA-256 fingerprint and publish `/.well-known/assetlinks.json` if verified `https://heystockers.trade` app links are kept enabled.
6. Capture clean store screenshots from the signed build and upload the metadata in `STORE_LISTING.md` to the Publisher Portal.
7. Complete publisher KYC/KYB, use the long-term publisher wallet, upload the signed APK, approve every publishing signature, and submit for review.

For later releases, increment both `expo.version` and `expo.android.versionCode`, and sign every APK with the same dApp Store key.

Keep paid RPC and execution API keys in the backend. Anything prefixed `EXPO_PUBLIC_` is bundled into the APK and must be treated as public.
