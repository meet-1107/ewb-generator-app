# Deploy on Firebase (Blaze) and install the APK

What goes where:

| Piece | Runs on | Why |
|---|---|---|
| Sign-in | **Firebase Authentication** (email/password) | Already wired in `lib/firebase.ts` |
| API server (`artifacts/api-server`) | **Cloud Run** in the same Firebase project | Firebase Hosting serves only static files, so the Express server runs on Cloud Run (billed through your Blaze plan) |
| Server data (`DATA_DIR`) | **Cloud Storage bucket** mounted into Cloud Run | The Cloud Run disk is wiped on every restart |
| Android app | **APK** built by Expo EAS, installed on the phone | Firebase does not build or host APKs |
| Web version (optional) | **Firebase Hosting** (`firebase.json`) | `/api/**` is forwarded to Cloud Run |

Replace these placeholders everywhere below:

- `PROJECT_ID`: your Firebase project ID (Project settings → General)
- `PROJECT_NUMBER`: the project number (same page)
- Region: `asia-south1` (Mumbai). If you pick another region, also change it in `firebase.json`.

## What you need

- Firebase project on the **Blaze** plan
- A Google account with Owner access to that project
- A free **Expo** account: https://expo.dev/signup
- On your PC: Node.js 22 or 24 LTS, Git, and **pnpm 9** (`npm install -g pnpm@9.15.9`).
  Use pnpm 9: the committed `pnpm-lock.yaml` fails `--frozen-lockfile` under pnpm 10.
- An Android phone (Android 7+) and its USB cable or a browser on the phone
- Recommended: a budget alert (Google Cloud console → Billing → Budgets & alerts), for example ₹500/month

## Part 1: Firebase Authentication

1. Firebase console → **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → Enable → Save.
3. **Project settings → General → Your apps → Add app → Web (`</>`)**. Nickname: the app name. Do not tick Hosting here.
4. Copy these values from the `firebaseConfig` it shows: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.

The app uses the Firebase **JS SDK**, so you register a *Web* app. You do **not** need `google-services.json`.

## Part 2: API server on Cloud Run

Easiest: run these in **Google Cloud Shell** (console.cloud.google.com → the `>_` icon, top right). It already has `gcloud` and `firebase`. Upload the project zip (⋮ → Upload) and `unzip` it, or `git clone` the repo. Then `cd` into the project folder.

```bash
gcloud config set project PROJECT_ID

# 1. Turn on the services
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

# 2. Storage bucket for the server's data
gcloud storage buckets create gs://PROJECT_ID-ewb-data --location=asia-south1 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://PROJECT_ID-ewb-data \
  --member=serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectUser

# 3. Build (uses the root Dockerfile) and deploy
gcloud run deploy ewb-api --source . --region asia-south1 \
  --allow-unauthenticated --execution-environment gen2 \
  --max-instances 1 --memory 512Mi \
  --set-env-vars NODE_ENV=production,FIREBASE_PROJECT_ID=PROJECT_ID,DATA_DIR=/data \
  --add-volume name=data,type=cloud-storage,bucket=PROJECT_ID-ewb-data \
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
firebase deploy --only hosting --project PROJECT_ID
```

On Windows PowerShell, set each variable first (`$env:EXPO_PUBLIC_FIREBASE_API_KEY="..."`), then run `npx expo export -p web`.

The site is served at `https://PROJECT_ID.web.app`. Its `/api/**` calls go to the `ewb-api` Cloud Run service through `firebase.json`.

## Part 4: Build the APK

On your PC:

```bash
npm install -g eas-cli
eas login
cd artifacts/ewb-vendor-app
eas init            # links the app to your Expo account; commit the app.json change it makes
```

Open `artifacts/ewb-vendor-app/eas.json` and replace the `preview` → `env` block with your values:

```json
"env": {
  "EXPO_PUBLIC_API_URL": "https://ewb-api-xxxxxxxx.asia-south1.run.app",
  "EXPO_PUBLIC_FIREBASE_API_KEY": "AIza...",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN": "PROJECT_ID.firebaseapp.com",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID": "PROJECT_ID",
  "EXPO_PUBLIC_FIREBASE_APP_ID": "1:...:web:...",
  "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET": "PROJECT_ID.firebasestorage.app",
  "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": "...",
  "EXPO_PUBLIC_SUPPORT_EMAIL": "support@yourdomain.com"
}
```

These values are compiled into the app and readable by anyone who has the APK. That is normal for Firebase web config, so do not put server secrets here.

Build:

```bash
eas build --platform android --profile preview
```

- When asked **"Generate a new Android Keystore?"**, answer **Y**. Expo stores the keystore. Every later APK must be signed with the same keystore, or it cannot update the installed app.
- On the free plan, the build waits in a queue. It usually finishes in 10–30 minutes.
- When it finishes, the terminal shows a link and a QR code. The build is also listed at expo.dev → your project → Builds.

## Part 5: Install on your phone

1. On the phone, scan the QR code or open the build link in **Chrome**, then tap **Install** / **Download**.
2. Open the downloaded `.apk` from the notification or the **Files → Downloads** folder.
3. If Android says the source isn't allowed, tap **Settings**, turn on **Allow from this source** for Chrome (or Files), then press back.
4. Tap **Install**. If **Play Protect** warns that the app is unknown, tap **More details → Install anyway**. The warning appears because the app isn't from the Play Store.
5. Open the app, tap **Create account**, and sign up with an email and password. The user appears in Firebase console → Authentication → Users.
6. Check it works: create a business, save an invoice, pull to refresh. Then confirm a file appears in the `PROJECT_ID-ewb-data` bucket under `workspaces/`.

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
| Sign-in screen shows **Open local preview** | The Firebase env values were missing at build time. |
| EAS build fails at `pnpm install` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | Keep `"pnpm": "9.15.9"` in `eas.json`. |
| "App not installed" over an older APK | The new build was signed with a different keystore. Uninstall the old app first. |
| Cloud Run deploy: permission denied on the bucket | Re-run the `add-iam-policy-binding` command with the right `PROJECT_NUMBER`. |

## Still sandbox

Hosting does not make e-way bills or GST checks real. `EWB_PROVIDER` / `GST_PROVIDER` default to `sandbox` until a licensed GSP adapter is added. See README → "Before production".
