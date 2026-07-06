<img src="./assets/images/icon.png" alt="Snoreman Icon" width="128" height="128"/>

# Snoreman

Record and analyze your snoring


## Dev

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

1. Install dependencies

   ```bash
   npm install
   ```

2. Start the app

   ```bash
   npx expo start
   ```

In the output, you'll find options to open the app a limited sandbox for trying out app development with Expo

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go)

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Snore detection algorithm

Detection lives in [`utils/snore-detection.ts`](utils/snore-detection.ts). Each saved
analysis records the `DETECTION_ALGO_VERSION` it was produced with.

When you change the detection logic, bump `DETECTION_ALGO_VERSION`. On the next app
launch, the background pass in [`utils/storage.ts`](utils/storage.ts)
(`migrateRecordingsToAuto`) finds every recording whose analysis is behind the current
version and re-runs it from the stored raw decibel data — so the whole history is always
scored with the latest algorithm. **Forget to bump, and old recordings keep their stale
results.**

Caveat: re-analysis overwrites any manual edits (e.g. deleted false-positive segments),
since those aren't distinguishable from algorithm output in the stored data.

Regression check for the algorithm (synthetic snore / speech / washing scenarios):

```bash
npx tsx scripts/test-snore-detection/run.ts
```

## Release app

Via GitHub Actions (recommended):

1. Bump `version` in `app.json` and push. That's it — [`eas-release.yml`](.github/workflows/eas-release.yml)
   detects the new version, tags it `v<version>`, builds on EAS, and auto-submits
   to App Store Connect (build number auto-increments on EAS).

   ```bash
   # edit app.json version, then:
   git commit -am "Release v1.x.x" && git push
   ```

   (or trigger manually: repo → Actions → "EAS Release (iOS)" → Run workflow)

2. Watch build/submit progress on [expo.dev](https://expo.dev) → Builds
3. Test with TestFlight, then release to App Store

`--auto-submit` only uploads to App Store Connect / TestFlight — it never submits
for review or publishes to the public App Store; that stays manual in ASC.

One-time setup for CI:
- GitHub repo secret `EXPO_TOKEN` (expo.dev → Account settings → Access tokens)
- App Store Connect API Key stored in EAS credentials (`eas credentials --platform ios`)

Or manually from local:

1. `eas build --platform ios` — build a release binary on EAS
2. `eas submit --platform ios` — upload the build to App Store Connect
3. try with testflight and then release to app store

ref: 
- https://docs.expo.dev/deploy/build-project/ 
- https://docs.expo.dev/deploy/submit-to-app-stores/

## License
[![License: CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc-sa/4.0/)
