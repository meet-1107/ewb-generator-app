# Deploy on Firebase (Blaze) and install the APK

What goes where:

| Piece | Runs on | Why |
|---|---|---|
| Sign-in | **Firebase Authentication**: mobile number + SMS OTP (Android), email/password (Android + web) | `lib/auth-client.native.ts` (React Native Firebase), `lib/auth-client.ts` (web SDK) |
| API server (`artifacts/api-server`) | **Cloud Run** in the same Firebase project | Firebase Hosting serves only static files, so the Express server runs on Cloud Run (billed through your Blaze plan) |
| Server data (`DATA_DIR`) | **Cloud Storage bucket** mounted into Cloud Run | The Cloud Run disk is wiped on every restart |
| Android app | **APK** built by Expo EAS, installed on the phone | Firebase does not build or host APKs |
| Web version (optional) | **Firebase Hosting** (`firebase.json`) | `/api/**` is forwarded to Cloud Run |

This project's values (from `google-services.json`):

- Firebase project ID: `ewb---generator`
- Project number: `396238368123`
- Android package: `com.ewayeasy.app`, app name **E-Way Easy**
- Region: `asia-south1` (Mumbai). If you pick another region, also change it in `firebase.json`.

## What you need

- Firebase project on the **Blaze** plan
- A Google account with Owner access to that project
- A free **Expo** account: https://expo.dev/signup
- On your PC: Node.js 22 or 24 LTS, Git, and **pnpm 9** (`npm install -g pnpm@9.15.9`).
  Use pnpm 9: the committed `pnpm-lock.yaml` fails `--frozen-lockfile` under pnpm 10.
- An Android phone (Android 7+) and its USB cable or a browser on the phone
- Recommended: a budget alert (Google Cloud console → Billing → Budgets & alerts), for example ₹500/month

## Part 1: Firebase Authentication (mobile OTP + email)

How sign-in works in the app:

- **Log in or sign up** screen: enter a mobile number → **Send OTP** → type the 6-digit SMS code → signed in. A number that has never signed in before gets a new account automatically, so there is no separate sign-up form. On many Android phones the SMS is read automatically and the code step is skipped.
- **Use email instead**: email/password sign-in, account creation (with an email verification link) and password reset are still available.
- Every signed-in user has a verified mobile number or a verified email. The server accepts their Firebase ID token.

Firebase console steps:

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab:
   - **Phone** → Enable → Save.
   - **Email/Password** → Enable → Save.
3. **Settings → SMS region policy** → **Allow** → select **India** (plus any other countries you serve) → Save. This blocks SMS fraud from other countries, which you would otherwise pay for.
4. Optional, for free testing: **Sign-in method → Phone → Phone numbers for testing**. Add `+91 99999 99999` with code `123456`. No real SMS is sent for that number.
5. Google Cloud console (same project) → **APIs & Services → Library** → enable **Play Integrity API**. Android uses it to confirm the OTP request comes from your real app.
6. You add the app's SHA fingerprints in Part 4, step 3. **Phone OTP fails until you do.**

`google-services.json` (Android app `com.ewayeasy.app`) configures the Android build. Keep it at `artifacts/ewb-vendor-app/google-services.json` on your PC. It is git-ignored because this repository is public. EAS builds receive it as a secret file (Part 4).

Each OTP SMS is billed to your Blaze plan: **India $0.07 per SMS sent (about ₹6)**. The first 10 SMS per day per project are free. Every **Resend code** is another SMS. Test numbers are free. Rates: https://cloud.google.com/identity-platform/pricing (checked October 2026). Keep the budget alert on.

Web version only (Part 3): **Project settings → General → Your apps → Add app → Web (`</>`)**, then copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`. The web version offers email sign-in only.

## Part 2: API server on Cloud Run

Easiest: run these in **Google Cloud Shell** (console.cloud.google.com → the `>_` icon, top right). It already has `gcloud` and `firebase`. Upload the project zip (⋮ → Upload) and `unzip` it, or `git clone` the repo. Then `cd` into the project folder.

```bash
gcloud config set project ewb---generator

# 1. Turn on the services
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# 2. Storage bucket for the server's data
gcloud storage buckets create gs://ewb---generator-ewb-data --location=asia-south1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://ewb---generator-ewb-data \
  --member=serviceAccount:396238368123-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectUser

# 3. Build (uses the root Dockerfile) and deploy
gcloud run deploy ewb-api --source . --region asia-south1 \
  --allow-unauthenticated --execution-environment gen2 \
  --max-instances 1 --memory 512Mi \
  --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=ewb---generator,DATA_DIR=/data \
  --add-volume name=data,type=cloud-storage,bucket=ewb---generator-ewb-data \
  --add-volume-mount volume=data,mount-path=/data
```

If it asks to create an Artifact Registry repository, answer **Y**.

At the end it prints a **Service URL** like `https://ewb-api-xxxxxxxx.asia-south1.run.app`. Check it:

```bash
curl https://ewb-api-xxxxxxxx.asia-south1.run.app/api/healthz    # {"status":"ok"}
```

Notes:

- `--allow-unauthenticated` only makes the URL reachable. Because `FIREBASE_PROJECT_ID` is set, every data endpoint still requires a valid Firebase sign-in token.
- Keep `--max-instances 1`. The server keeps workspaces in memory and in JSON files, so two instances would overwrite each other. Moving to Postgres (README "Before production") removes this limit.
- To redeploy after code changes, run the same `gcloud run deploy` command again.

## Part 3 (optional): Web version on Firebase Hosting

On your PC, from the repo root:

```bash
pnpm install
cd artifacts/ewb-vendor-app
EXPO_PUBLIC_FIREBASE_API_KEY=... EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=... \
EXPO_PUBLIC_FIREBASE_PROJECT_ID=... EXPO_PUBLIC_FIREBASE_APP_ID=... \
npx expo export -p web           # writes artifacts/ewb-vendor-app/dist
cd ../..
npm install -g firebase-tools
firebase login
firebase deploy --only hosting --project ewb---generator
```

On Windows PowerShell, set each variable first (`$env:EXPO_PUBLIC_FIREBASE_API_KEY="..."`), then run `npx expo export -p web`.

The site is served at `https://ewb---generator.web.app`. Its `/api/**` calls go to the `ewb-api` Cloud Run service through `firebase.json`.

## Part 4: Build the APK

On your PC:

1. Install the CLI, log in, and link the project:

   ```bash
   npm install -g eas-cli
   eas login
   cd artifacts/ewb-vendor-app
   eas init            # links the app to your Expo account; commit the app.json change it makes
   ```

2. Upload `google-services.json` as a secret file for both build environments:

   ```bash
   eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --environment production --visibility secret
   ```

3. Create the signing key now, so you can register its fingerprints before the first build:

   ```bash
   eas credentials --platform android
   ```

   Choose the **preview** profile → **Keystore** → **Set up a new keystore** (generate). Afterwards it prints **SHA1 Fingerprint** and **SHA256 Fingerprint**. Copy both.

   Firebase console → **Project settings → General → Your apps → Android (com.ewayeasy.app) → Add fingerprint**. Add the SHA-1, then add the SHA-256. You don't need to download `google-services.json` again for phone OTP.

   Expo stores this keystore. Every later APK must be signed with it, or it cannot update the installed app.

4. Open `artifacts/ewb-vendor-app/eas.json` and set the `preview` → `env` block:

   ```json
   "env": {
     "EXPO_PUBLIC_API_URL": "https://ewb-api-xxxxxxxx.asia-south1.run.app",
     "EXPO_PUBLIC_SUPPORT_EMAIL": "support@yourdomain.com"
   }
   ```

   The Android app reads its Firebase settings from `google-services.json`. You don't need the `EXPO_PUBLIC_FIREBASE_*` values here; they are only for the web version.

5. Build:

```bash
eas build --platform android --profile preview
```

- On the free plan, the build waits in a queue. It usually finishes in 10–30 minutes.
- When it finishes, the terminal shows a link and a QR code. The build is also listed at expo.dev → your project → Builds.

## Part 5: Install on your phone

1. On the phone, scan the QR code or open the build link in **Chrome**, then tap **Install** / **Download**.
2. Open the downloaded `.apk` from the notification or the **Files → Downloads** folder.
3. If Android says the source isn't allowed, tap **Settings**, turn on **Allow from this source** for Chrome (or Files), then press back.
4. Tap **Install**. If **Play Protect** warns that the app is unknown, tap **More details → Install anyway**. The warning appears because the app isn't from the Play Store.
5. Open **E-Way Easy**, enter your mobile number, tap **Send OTP**, and type the SMS code (or wait for it to fill in automatically). You may briefly see a browser "verifying you're not a robot" page. That is Firebase's reCAPTCHA check, used when the app isn't installed from the Play Store. The user then appears in Firebase console → Authentication → Users with your phone number.
6. Check it works: create a business, save an invoice, pull to refresh. Then confirm a file appears in the `ewb---generator-ewb-data` bucket under `workspaces/`.

Alternative (USB): download the `.apk` to your PC, enable **Developer options → USB debugging** on the phone, then run `adb install path/to/app.apk`.

### Installing a newer version

1. In `app.json`, increase `android.versionCode` by 1 (and `version` if you like).
2. Run `eas build --platform android --profile preview` again.
3. Install the new APK over the old one. Your data is kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "offline / service unreachable" | `EXPO_PUBLIC_API_URL` is wrong or not `https://`. Rebuild after fixing `eas.json`. |
| "Sign in again to continue" on every screen | `FIREBASE_PROJECT_ID` on Cloud Run doesn't match the app's project ID. |
| Sign-in screen shows **Open local preview** | Native Firebase is missing: you are in Expo Go (OTP needs a real build), or `GOOGLE_SERVICES_JSON` was not available to the build. |
| "This app build is not registered in Firebase" when sending OTP | Add the keystore SHA-1 and SHA-256 (Part 4, step 3) and enable Play Integrity API. |
| "This sign-in method is not enabled" | Enable **Phone** (or Email/Password) in Authentication → Sign-in method. |
| OTP never arrives | Check the SMS region policy allows India, and try a test number first. Some DND numbers get SMS late, so wait 30 s, then tap **Resend code**. |
| Build fails: `google-services.json` not found | Run the `eas env:create … GOOGLE_SERVICES_JSON` command from Part 4, step 2. |
| EAS build fails at `pnpm install` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | Keep `"pnpm": "9.15.9"` in `eas.json`. |
| "App not installed" over an older APK | The new build was signed with a different keystore. Uninstall the old app first. |
| Cloud Run deploy: permission denied on the bucket | Re-run the `add-iam-policy-binding` command with the right `396238368123`. |

## Still sandbox

Hosting does not make e-way bills or GST checks real. `EWB_PROVIDER` / `GST_PROVIDER` default to `sandbox` until a licensed GSP adapter is added. See README → "Before production".

## iOS

iOS builds also need `GoogleService-Info.plist` (Firebase → Add app → iOS, bundle ID `com.ewayeasy.app`), `ios.googleServicesFile` in `app.config.js`, and `expo-build-properties` with `ios.useFrameworks: "static"`. iOS is not set up yet.
