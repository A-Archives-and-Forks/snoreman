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

## Release app

Via GitHub Actions (recommended):

1. Bump `version` in `app.json` and commit (build number auto-increments on EAS)
2. Tag and push — this triggers [`eas-release.yml`](.github/workflows/eas-release.yml), which builds on EAS and auto-submits to App Store Connect:

   ```bash
   git tag v1.x.x
   git push && git push --tags
   ```

   (or trigger manually: repo → Actions → "EAS Release (iOS)" → Run workflow)

3. Watch build/submit progress on [expo.dev](https://expo.dev) → Builds
4. Test with TestFlight, then release to App Store

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
