---
name: Firebase Auth on Expo
description: A React Native persistence export can be missing from Firebase's shared TypeScript surface while still existing in the Expo native bundle.
---

In Expo, Firebase React Native Auth may expose `getReactNativePersistence` through Metro's native entry while the shared TypeScript declaration for `firebase/auth` omits it. Use a narrow runtime type cast for that native-only lookup, check that the function exists, and only fall back to `getAuth` for the explicit already-initialized case.

**Why:** A broad catch can hide persistence setup failures and silently change how authentication state is stored.

**How to apply:** When configuring Firebase Auth for an Expo native app, verify the native entrypoint and persistence adapter separately from the web type surface; do not treat unrelated initialization errors as an existing Auth instance.
