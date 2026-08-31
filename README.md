# HeyStockers

HeyStockers is split into two product clients and one standalone API:

- `web/` — the current Next.js web product and its local database.
- `mobile/` — the Android React Native/Expo app for Solana Mobile devices.
- `backend/` — the deployable Worker API, D1 migrations, RPC isolation, and tests.

## Backend

```bash
cd backend
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm run dev
```

The backend starts on `http://localhost:8787`. The existing web API stays available during the migration and is the rollback path.

## Web

```bash
cd web
npm run dev
```

The web server owns paid RPC calls, live stock routing, wallet portfolio reads, authentication, and Position Call proof verification.

## Mobile

```bash
cd mobile
cp .env.example .env
npm run android
```

Use an Android development build, not Expo Go. The emulator reaches the local web server at `http://10.0.2.2:3000`. A physical device needs `EXPO_PUBLIC_HEYSTOCKERS_API_URL` set to a backend address it can reach.

This machine's default Java is newer than Android Gradle supports. Use its installed JDK 17 for a local APK build:

```bash
cd mobile/android
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew assembleDebug -PreactNativeArchitectures=arm64-v8a
```

## Production

- Web: <https://heystockers.trade>
- API: <https://api.heystockers.trade>
- API health: <https://api.heystockers.trade/health>

Deploy the API first, then the web client:

```bash
cd backend
npm run check
npm run db:migrate:remote
npm run deploy

cd ../web
npm run lint
npm run test
npm run deploy
```

Production RPC values are Cloudflare Worker secrets. Never place them in the web bundle, an `EXPO_PUBLIC_*` mobile variable, source control, or deployment notes.
