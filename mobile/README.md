# Navigator CRM — mobile app

React Native (Expo, TypeScript) app for the Navigator CRM in the parent folder. Staff sign in with their
existing CRM account and get role-based dashboards, leads, approvals, HR self-service and push
notifications.

Full architecture, the backend contract and the push pipeline are in [`../docs/MOBILE_APP.md`](../docs/MOBILE_APP.md).

| | |
|---|---|
| Runtime | Expo SDK 57 · React Native 0.86 (New Architecture) · Hermes |
| Navigation | React Navigation 7 (native stack + bottom tabs) |
| State | Zustand (session, settings, UI) · TanStack Query v5 (server state) |
| Storage | Keychain/Keystore (tokens) · encrypted MMKV (preferences, query cache) · SQLCipher SQLite (offline cache) |
| Push | Direct FCM (Android) and APNs (iOS) → `expo-notifications` |
| Styling | Typed design tokens + `StyleSheet`, light / dark / system |

> **There is no Expo Go support.** MMKV, SQLCipher and push need native code, so the app runs in a
> *development build* (`eas build --profile development`).

---

## 1. Setup (fresh machine)

```bash
# from the repo root
git checkout feature/enterprise-crm-mobile-app

cd mobile
npm ci                                   # exact versions from package-lock.json
cp .env.example .env                     # then edit EXPO_PUBLIC_API_URL
```

How this project was created, if you need to reproduce it:

```bash
git checkout -b feature/enterprise-crm-mobile-app
npx create-expo-app@latest mobile --template blank-typescript --no-install
cd mobile
npm install

# Expo modules - always via `expo install` so versions match the SDK
npx expo install expo-dev-client expo-notifications expo-device expo-constants expo-secure-store \
  expo-sqlite expo-local-authentication expo-build-properties expo-linking expo-crypto \
  expo-application expo-splash-screen expo-system-ui expo-font @expo/vector-icons \
  react-native-screens react-native-safe-area-context \
  @react-native-community/netinfo @react-native-community/datetimepicker

# Everything else
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs \
  @tanstack/react-query @tanstack/react-query-persist-client @tanstack/query-sync-storage-persister \
  zustand react-native-mmkv react-native-nitro-modules

# Tooling
npx expo install jest-expo jest @types/jest typescript -- --save-dev
npm install --save-dev --save-exact @react-native/jest-preset@0.86.3 @types/node@22   # preset must match the RN version
```

Feature-based source layout (`src/`):

```
app/            App.tsx (providers, gate, lock), queryClient, ErrorBoundary
navigation/     RootNavigator, AuthStack, AppTabs, AppStack, routeAccess (RBAC), linking, push bridge
features/       auth · dashboard · leads · approvals · discounts · accounts · compliances
                notifications · hr · it-support · profile
components/     design-system atoms and molecules
services/       api · push · storage · db · security
store/          session, settings, ui, push (Zustand)
theme/          tokens, ThemeProvider, status colours
utils/  constants/
```

## 2. Point the app at a backend

`EXPO_PUBLIC_API_URL` is inlined at build time.

- **Local backend on a real phone:** run the web app on your LAN address and use that IP (not `localhost`):
  ```bash
  # in the repo root
  npm run dev -- -H 0.0.0.0
  # mobile/.env
  EXPO_PUBLIC_API_URL=http://192.168.0.10:3000
  ```
- **Builds:** set it per profile in [`eas.json`](eas.json). Production builds refuse a non-`https` URL.
- **Without rebuilding:** internal builds (`development`, `preview`) show a **Server** button on the login screen.
  Enter `http://<your-pc-ip>:3000`, a preview URL or the production URL and the same APK talks to it. It is only
  reachable while signed out, so a session can never straddle two servers. **Production builds have no such setting and
  ignore any stored value.**

The first mobile login creates two tables (`crm_mobile_sessions`, `crm_mobile_devices`) in the backend's
database. See the backend section of the docs before pointing at a shared database.

## 3. Run

```bash
eas login
eas build --profile development --platform android     # installable APK, no Android SDK needed locally
# install the APK on the phone, then:
npm start                                              # expo start --dev-client
```

iOS needs an Apple Developer account and a registered device (`eas device:create`), then
`eas build --profile development --platform ios`.

## 4. Push notifications (needs your credentials)

Push cannot work until these exist. None of them are in the repo.

**Android — Firebase (FCM)**
1. Firebase console → create a project → add an Android app with package `com.globalnavigator.crm`.
2. Download `google-services.json` into `mobile/` (git-ignored), or set the `GOOGLE_SERVICES_FILE` file secret on EAS.
3. Project settings → Service accounts → *Generate new private key*. Put the JSON (raw or base64) in the
   **backend's** `FCM_SERVICE_ACCOUNT_JSON`.

**iOS — APNs**
1. Apple Developer → Keys → create a key with *Apple Push Notifications service* enabled. Download the `.p8`.
2. Set on the **backend**: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (the `.p8` contents, raw or base64),
   `APNS_BUNDLE_ID=com.globalnavigator.crm`, and `APNS_ENVIRONMENT`.
   Development builds use the APNs *sandbox*; the app reports which one each device belongs to.
3. `eas credentials` to enable the Push Notifications capability on the App ID.

Then, to test end to end, sign in as the CEO (and, on a second phone, a counselor) and trigger the events:

| Event | How to trigger in the web CRM | Who is pushed | Buttons |
|---|---|---|---|
| Discount request | Request a discount above the auto-approve threshold on a lead | CEO | Approve · Reject |
| Payment awaiting Accounts | Record a payment / receipt for a lead | CEO | Approve · Reject |
| Compliance approval | Submit a signed agreement for compliance review | CEO | Sign-off |
| Lead assigned | Assign or reassign a lead to a counselor | The counselor | Call · View Profile |

Approve / Reject / Sign-off open an in-app confirm screen and require Face ID / fingerprint / passcode
before anything is sent. Nothing is ever approved from the lock screen.

## 5. Quality gates

```bash
npm run typecheck        # tsc --noEmit
npm test                 # Jest: push router + policy, RBAC, API client (refresh, RBAC), session store, utils
npm run doctor           # expo-doctor
npm run export:android   # full Metro/Hermes bundle - proves every import resolves
npm run prebuild:android # validates the config plugins (Firebase, SQLCipher, notifications, permissions)
```

`prebuild:android` writes a generated `android/` folder (git-ignored); delete it afterwards.

## 6. Configuration reference

| Where | Setting | Purpose |
|---|---|---|
| `.env` / `eas.json` | `EXPO_PUBLIC_API_URL` | Backend base URL |
| `.env` / `eas.json` | `EXPO_PUBLIC_APP_ENV` | `development` \| `preview` \| `production` (APNs environment, logging) |
| `.env` / `eas.json` | `EXPO_PUBLIC_SSL_PINS` | Optional TLS pinning, see below |
| build env | `APP_ENV` | Read by `app.config.ts` (cleartext traffic, APNs entitlement, permissions) |
| build env | `GOOGLE_SERVICES_FILE`, `EAS_PROJECT_ID` | Firebase config, EAS project |

**Placeholders to replace before shipping:** bundle id `com.globalnavigator.crm`, the EAS project id, and the app
icon / splash artwork. Every profile in `eas.json` points at `https://navigatorcrm-one.vercel.app`; change it there if
staging and production ever get separate hosts. The images in `assets/` are
generated from the web app's 507 px `public/logo.png`, so they are a little soft at icon sizes: supply the
vector/high-resolution brand artwork before a store release.

**TLS pinning** is off by default. To enable it: `npx expo install react-native-ssl-public-key-pinning`,
rebuild the dev client, and set `EXPO_PUBLIC_SSL_PINS` to at least two SPKI SHA-256 pins (current + backup;
the steps to compute them are in `src/services/security/sslPinning.ts`). One pin is a lock-out risk on
certificate rotation.

## 7. Known limitations

- Recording a payment is not in the app: the web flow requires a proof-of-payment upload through Vercel
  Blob's browser-only client. Outstanding balances are read-only.
- No client tier, risk score or audit-log score in push payloads: those fields do not exist in the CRM.
- Offline mode is read-only and covers leads, approvals, notifications, dashboard, follow-ups, meetings and
  profile. Payslips are never cached.
- The Android notification small-icon falls back to the app icon (a white-on-transparent glyph is needed for a
  crisp tray icon: `expo-notifications` plugin `icon` option).
- Push delivery, action buttons and the biometric flows have been verified by unit tests and build checks
  only. They need a real device build with Firebase/APNs credentials to exercise end to end.

## 8. Building an APK locally on Windows

For when you would rather not use EAS cloud builds. Nothing is uploaded anywhere. Budget about 10 GB of disk (put
everything on a drive with room) and 30-60 minutes for the first build.

**One-off tooling** (Android Studio is not required):

1. JDK 17 (Temurin), e.g. `D:\android-build\jdk-17`.
2. Android command-line tools unpacked to `D:\android-build\sdk\cmdline-tools\latest`.
3. Accept the SDK licenses, then install exactly what React Native 0.86 asks for (see
   `node_modules/react-native/gradle/libs.versions.toml`):
   ```bash
   sdkmanager --sdk_root=D:\android-build\sdk --licenses
   sdkmanager --sdk_root=D:\android-build\sdk platform-tools "platforms;android-36" "build-tools;36.0.0" "cmake;3.22.1" "ndk;27.1.12297006"
   ```
   In PowerShell/cmd `--licenses` may not receive its `y` answers; run it from Git Bash as `yes | sdkmanager.bat ...`.
   The NDK is ~750 MB and `sdkmanager` restarts it from zero on every dropped connection. On a flaky network download
   `android-ndk-r27b-windows.zip` with a resumable `curl -C -` and unzip it to `sdk\ndk\27.1.12297006`. Check that
   `source.properties`, `toolchains\llvm\prebuilt\windows-x86_64\bin\clang.exe` and
   `build\cmake\android.toolchain.cmake` exist: an empty folder means the download failed.

**Short paths.** Windows' 260-character limit breaks native builds inside deep `node_modules` paths, so build from a
copy at a short *real* path such as `D:\m`:

```bat
robocopy D:\path\to\navigator-next\mobile D:\m /MIR /XD D:\path\to\navigator-next\mobile\android D:\path\to\navigator-next\mobile\.expo /MT:8
```

Give `/XD` **full paths**: a bare `android` would also skip every `node_modules\*\android` folder and break the build.
Do not use `subst` or a junction instead: Node's autolinking reports the real path while Gradle sees the substituted
one, and the React Native Gradle plugin fails codegen with "this and base files have different roots". A drive root
(`subst R: mobile`) also breaks autolinking outright.

**Build** (from the copy):

```bat
set JAVA_HOME=D:\android-build\jdk-17
set ANDROID_HOME=D:\android-build\sdk
set GRADLE_USER_HOME=D:\android-build\gradle-home
set NODE_ENV=production
set APP_ENV=preview
set EXPO_PUBLIC_APP_ENV=preview
set EXPO_PUBLIC_API_URL=https://navigatorcrm-one.vercel.app

cd D:\m
npx expo prebuild --platform android --no-install --clean
cd android
gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon --max-workers=2
```

The APK is `android\app\build\outputs\apk\release\app-release.apk`. Install it with `adb install -r app-release.apk`, or
copy it to the phone and open it (allow installs from that source). It already talks to
`https://navigatorcrm-one.vercel.app`; use the **Server** button on the login screen only to point it somewhere else.

- `arm64-v8a` covers virtually every phone since 2017 and keeps the build short and small. Use `x86_64` for an emulator.
- `--no-daemon --max-workers=2` keep memory use low on an 8 GB machine.
- The first build downloads Gradle and every dependency. A dropped connection can fail it with "Plugin ... was not
  found": just re-run.
- It is signed with the generated **debug keystore**: fine for internal testing, **not** for the Play Store.
- `android/` is generated and git-ignored; delete the `D:\m` copy when done.
- Push will not work in this APK unless `google-services.json` was present at prebuild time (section 4).
