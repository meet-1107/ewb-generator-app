# Deploy on Firebase (Blaze) and install the APK

What goes where:

| Piece | Runs on | Why |
|---|---|---|
| Sign-in | **Firebase Authentication**: Continue with Google + email/password (free, no SMS) | `lib/auth-client.native.ts` (React Native Firebase + Google Sign-In), `lib/auth-client.ts` (web SDK) |
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

## Part 1: Firebase Authentication (email OTP + Google)

How sign-in works:

| User | Flow |
|---|---|
| New, email | **Create account** → email + password → **Send verification code** → enter the 6-digit code from the email → account created → back to **Sign in** |
| Returning, email | Email + password → **Sign in** → dashboard |
| Google | **Continue with Google** → dashboard. No code is needed; a Google email is already verified. |
| Already signed in | The session is restored when the app opens; the dashboard appears without the login screen. |
| Unfinished sign-up | Signing in says "Finish creating your account" → **Verify email** sends a new code. |

The server decides who is verified, not the app:
- `/auth/email-otp/verify` returns a single-use registration grant (15 minutes).
- `/auth/register/finalize` checks the user's Firebase ID token, consumes the grant once, and marks the email verified with the Firebase Admin SDK.
- Every data API refuses accounts whose email is not verified.

The rules:
- Codes are random, expire after **5 minutes**, and allow **5 attempts**.
- Resending has a **60-second** cooldown, with at most **5 codes per email per hour**, plus per-IP limits.
- Codes and grants are stored only as hashes and are never logged.
- An email that already has an account gets an "account exists" email instead of a code, and the API answers the same way, so the app never reveals which emails are registered.

### Firebase console

1. **Build → Authentication → Sign-in method:** enable **Email/Password** and **Google** (choose a support email).
2. **Add the SHA fingerprints.** Add the app's SHA-1 and SHA-256 fingerprints (Part 4, step 2), then download a fresh `google-services.json` (Project settings → Your apps → Android).

### Email sending (Resend)

1. Sign up at https://resend.com.
2. Go to **Domains → Add domain**. Add the DNS records it shows, at your domain provider, and wait until the domain shows **Verified**.
3. Go to **API keys → Create** (permission "Sending access").
4. Put these on the server (`artifacts/api-server/.env` for testing; Cloud Run variables when live, Part 2b):
   - `RESEND_API_KEY=re_…`
   - `EMAIL_FROM=E-Way Easy <verify@yourdomain.com>`
   - `OTP_PEPPER=` followed by 64 random characters (`openssl rand -hex 32`)
   - `FIREBASE_PROJECT_ID=ewb---generator`

To test before verifying a domain, use `EMAIL_FROM=E-Way Easy <onboarding@resend.dev>`. It only delivers to the email you signed up to Resend with.

### Firebase Admin permission (server)

The server marks accounts verified with the Firebase Admin SDK.
- **On Cloud Run:** it uses the service's account automatically. Give that account the Firebase Authentication Admin role once:

```bash
gcloud projects add-iam-policy-binding ewb---generator \
  --member=serviceAccount:396238368123-compute@developer.gserviceaccount.com \
  --role=roles/firebaseauth.admin
```

- **On your PC:** go to Firebase console → Project settings → Service accounts → **Generate new private key**. Save the file outside the project folder and set `GOOGLE_APPLICATION_CREDENTIALS` in `.env` to its path. Never commit this file.

### Web version only (Part 3)

Go to **Project settings → General → Your apps → Add app → Web (`</>`)**, then copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`.

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

## Part 2b: gstinapi.in key, credits and payments

### Where the API key goes

The gstinapi.in key is a password, so it lives only on the server, never in the app or in `eas.json`.

| Where the server runs | Put the key here |
|---|---|
| On your PC (testing) | `artifacts/api-server/.env`. Copy `artifacts/api-server/.env.example` to `.env` and fill it in. `pnpm --filter @workspace/api-server run start` loads it automatically. The file is git-ignored. |
| Cloud Run (live) | Environment variables on the `ewb-api` service (command below). The `.env` file is not uploaded. |

All settings:

| Variable | Example | What it does |
|---|---|---|
| `GSTINAPI_KEY` | `gak_…` | Your key from gstinapi.in → API keys. |
| `EWB_PROVIDER` | `gstinapi` | Real e-way bills through gstinapi.in. Leave unset for fake sandbox bills. |
| `GSTINAPI_TEST_MODE` | `true` | Sends `test_mode: true`, so gstinapi.in validates but files nothing and charges nothing. Set it to `false` to go live. |
| `EWB_CREDENTIALS_SECRET` | 64 random characters | Encrypts each GSTIN's portal password. Never change it after users have saved logins. |
| `WALLET_START_CREDITS` | `0` | Free credits for a new account. With 0, nothing can be done without buying credits. |
| `CREDIT_COSTS_JSON` | `{"generate":10,"part_b":5,"consolidate":5,"cancel":5,"extend":5}` | Credits per action. These numbers are the defaults. |
| `CREDIT_PRICE_PAISE` | `100` | Price of 1 credit in paise (100 = ₹1). |
| `CREDIT_PACKS_JSON` | `[100,250,500,1000,2500]` | Pack buttons shown in the Wallet. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | `rzp_live_…` | Razorpay → Account & Settings → API keys. |
| `RAZORPAY_WEBHOOK_SECRET` | any long string | The secret you type when creating the Razorpay webhook (below). |
| `WALLET_ADMIN_TOKEN` | 48 random characters | Lets you add credits by hand, for example for a bank transfer. |

Set them on Cloud Run. Run this as one line; `^@^` makes `@` the separator so the JSON's commas are kept:

```bash
gcloud run services update ewb-api --region asia-south1 --update-env-vars "^@^EWB_PROVIDER=gstinapi@GSTINAPI_KEY=gak_xxx@GSTINAPI_TEST_MODE=true@EWB_CREDENTIALS_SECRET=$(openssl rand -hex 32)@WALLET_ADMIN_TOKEN=$(openssl rand -hex 24)@WALLET_START_CREDITS=0@RAZORPAY_KEY_ID=rzp_live_xxx@RAZORPAY_KEY_SECRET=xxx@RAZORPAY_WEBHOOK_SECRET=xxx@RESEND_API_KEY=re_xxx@EMAIL_FROM=E-Way Easy <verify@yourdomain.com>@OTP_PEPPER=$(openssl rand -hex 32)"
```

### gstinapi.in endpoints the server uses

| App action | Endpoint | gstinapi.in charges you | App charges the user |
|---|---|---|---|
| Verify GSTIN (once per GSTIN, then saved) | `GET /v1/gstin/{gstin}` | 1 credit, first time only | free |
| Check portal login | `POST /v1/ewaybill/credentials/test` | free | free |
| Generate e-way bill | `POST /v1/ewaybill` | 3 | 10 credits = ₹10 |
| Part-B / vehicle | `POST /v1/ewaybill/update-vehicle` | 3 | 5 = ₹5 |
| Consolidated e-way bill | `POST /v1/ewaybill/consolidated` | 3 | 5 = ₹5 |
| Cancel | `POST /v1/ewaybill/cancel` | 3 | 5 = ₹5 |
| Extend validity | `POST /v1/ewaybill/extend-validity` | 3 | 5 = ₹5 |

How credits work:
- Credits are held before each call and charged only if the action succeeds.
- A rejection or outage refunds them automatically. gstinapi.in doesn't charge for rejections either.
- A generate that times out can be retried safely: gstinapi.in returns the original bill (`already_existed`), so a second bill is never created.

### Going live with e-way bills

1. **Ask gstinapi.in which GSP to pick.** Contact gstinapi.in support. They tell you which GSP to choose, and you send them each GSTIN to enable.
2. **Create the API login.** For each GSTIN: on ewaybillgst.gov.in go to Registration → For GSP, choose that GSP, and create an API username and password.
3. **Save the login in the app.** In the app, go to Account → E-way bill portal login. The server checks the login with `/credentials/test` before saving it.
4. **Test.** Generate a test bill with `GSTINAPI_TEST_MODE=true`. Its number starts with `TEST-`.
5. **Go live.** Set `GSTINAPI_TEST_MODE=false`.

### Selling credits with Razorpay (1 credit = ₹1)

1. **Create and activate a Razorpay account.** Sign up at https://razorpay.com. Activation needs business KYC: PAN, bank account and GST.
2. **Get the API keys.** Dashboard → Account & Settings → API keys → generate. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Create the webhook.** Dashboard → Webhooks → Add:
   - URL: `https://ewb-api-xxxxxxxx.asia-south1.run.app/api/payments/razorpay/webhook`
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Event: **payment_link.paid**
4. **Buy credits in the app.** In the app, go to Wallet → Buy credits → choose a pack, then pay on Razorpay with UPI, card or net banking. Credits are added when Razorpay confirms the payment, through the webhook or when the app re-checks. Each payment is credited once.

Test first with Razorpay **test mode** keys (`rzp_test_…`); no real money moves.

Without Razorpay keys, the Wallet shows **Request credits** instead. You can then add credits by hand:

```bash
curl -X POST https://ewb-api-xxxxxxxx.asia-south1.run.app/api/admin/wallet/topup \
  -H "x-admin-token: YOUR_WALLET_ADMIN_TOKEN" -H "content-type: application/json" \
  -d '{"workspaceId":"USER_WALLET_ID","credits":500,"note":"UPI ref 1234"}'
```

The user's Wallet ID is shown on their Wallet screen. It is their Firebase UID.

Before you sell credits:
- **GST:** selling credits is a taxable supply. Decide whether ₹1 per credit includes GST, and issue invoices from Razorpay or your accounting software.
- **Play Store:** credits sold inside an app on Google Play may need Google Play Billing, or Play's user-choice billing in India. A sideloaded APK isn't affected.

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

2. Create the signing key now, so you can register its fingerprints before the first build:

   ```bash
   eas credentials --platform android
   ```

   Choose the **preview** profile → **Keystore** → **Set up a new keystore** (generate). Afterwards it prints **SHA1 Fingerprint** and **SHA256 Fingerprint**. Copy both.

   Firebase console → **Project settings → General → Your apps → Android (com.ewayeasy.app) → Add fingerprint**. Add the SHA-1, then add the SHA-256.

   Expo stores this keystore. Every later APK must be signed with it, or it cannot update the installed app.

3. Enable the Google provider if you haven't yet (Part 1, step 2). Then download the fresh `google-services.json` (Part 1, step 4) into `artifacts/ewb-vendor-app/`, and upload it as a secret file for both build environments:

   ```bash
   eas env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --environment preview --environment production --visibility secret
   ```

   If you download the file again later, replace the stored copy with `eas env:update` (same flags), or delete and recreate the variable.

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
5. Open **E-Way Easy**, tap **Continue with Google**, and pick your account. The user then appears in Firebase console → Authentication → Users with provider Google.
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
| Sign-in screen shows **Open local preview** | Native Firebase is missing: you are in Expo Go (Google sign-in needs a real build), or `GOOGLE_SERVICES_JSON` was not available to the build. |
| "Email verification is not set up on the server yet" | Set `RESEND_API_KEY`, `EMAIL_FROM`, `OTP_PEPPER` and `FIREBASE_PROJECT_ID` on the server. |
| "Could not start verification right now" / "Could not activate your account" | The server cannot reach Firebase Admin. Grant `roles/firebaseauth.admin` (Part 1), or set `GOOGLE_APPLICATION_CREDENTIALS` locally. |
| Code email never arrives | Check Resend → Emails for bounces, that the sender domain is verified, and the spam folder. |
| "Online payment is not set up yet" in the Wallet | Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to the server (Part 2b). |
| Paid, but credits did not arrive | Check the Razorpay webhook URL, its secret, and the event `payment_link.paid`. Re-opening the Wallet also re-checks pending payments. |
| "Google sign-in is not set up yet. Enable Google…" | The `google-services.json` used for the build has no Web client ID. Enable the Google provider, download the file again, update `GOOGLE_SERVICES_JSON`, and rebuild. |
| "Google sign-in is not set up for this app build yet (SHA fingerprints…)" | The keystore's SHA-1/SHA-256 is not in Firebase (Part 4, step 2). Adding it doesn't need a rebuild. |
| "This sign-in method is not enabled" | Enable **Google** (or Email/Password) in Authentication → Sign-in method. |
| Build fails: `google-services.json` not found | Run the `eas env:create … GOOGLE_SERVICES_JSON` command from Part 4, step 3. |
| EAS build fails at `pnpm install` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | Keep `"pnpm": "9.15.9"` in `eas.json`. |
| "App not installed" over an older APK | The new build was signed with a different keystore. Uninstall the old app first. |
| Cloud Run deploy: permission denied on the bucket | Re-run the `add-iam-policy-binding` command with the right `396238368123`. |

## Still sandbox

Hosting does not make e-way bills or GST checks real. `EWB_PROVIDER` / `GST_PROVIDER` default to `sandbox` until a licensed GSP adapter is added. See README → "Before production".

## iOS

iOS builds also need `GoogleService-Info.plist` (Firebase → Add app → iOS, bundle ID `com.ewayeasy.app`), `ios.googleServicesFile` in `app.config.js`, and `expo-build-properties` with `ios.useFrameworks: "static"`. iOS is not set up yet.
