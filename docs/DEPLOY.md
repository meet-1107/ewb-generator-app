# Deploy on Firebase (Blaze) and install the APK

Everything runs in one Firebase project and is deployed with one command, `firebase deploy`:

| Piece | Runs on | Notes |
|---|---|---|
| Sign-in | **Firebase Authentication**: Continue with Google + email/password (free, no SMS) | `lib/auth-client.native.ts` (React Native Firebase + Google Sign-In), `lib/auth-client.ts` (web SDK) |
| API server (`artifacts/api-server`) | **Cloud Functions for Firebase**: one HTTPS function `api` in `asia-south1` | Built into `functions/` by `firebase deploy`. Keys and settings come from `functions/.env`. |
| Server data | **Cloud Firestore** | Wallets, e-way bills, saved invoices, verified GSTINs, OTP codes. Only the function can read it (`firestore.rules`). |
| Web version | **Firebase Hosting**: https://ewb---generator.web.app | `/api/**` is forwarded to the `api` function (`firebase.json`), so the app and the website use the same address. |
| Android app | **APK** built by Expo EAS, installed on the phone | Firebase does not build APKs. |

This project's values (from `google-services.json`):

- Firebase project ID: `ewb---generator` (already selected in `.firebaserc`)
- Project number: `396238368123`
- Android package: `com.ewayeasy.app`, app name **E-Way Easy**
- Region: `asia-south1` (Mumbai). To change it, edit `artifacts/api-server/src/functions.ts` and `firebase.json`.
- Server address used by the app: `https://ewb---generator.web.app` (already in `eas.json`)

## What you need

- Firebase project on the **Blaze** plan
- A Google account with Owner access to that project
- A free **Expo** account: https://expo.dev/signup
- On your PC: Node.js 22 or 24 LTS, Git, and the Firebase CLI (`npm install -g firebase-tools`).
  Install the project's packages with `npx pnpm@9.15.9 install` (pnpm 9: the committed `pnpm-lock.yaml` fails under pnpm 10).
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
4. Put these in `functions/.env` (Part 2):
   - `RESEND_API_KEY=re_…`
   - `EMAIL_FROM=E-Way Easy <verify@yourdomain.com>`

   `OTP_PEPPER` is generated for you on the first deploy, and the project ID is set by Firebase.

To test before verifying a domain, use `EMAIL_FROM=E-Way Easy <onboarding@resend.dev>`. It only delivers to the email you signed up to Resend with.

### Firebase Admin permission (server)

The server marks accounts verified with the Firebase Admin SDK.
- **On Cloud Functions:** nothing to do. The function's default service account can already manage Firebase Authentication users and Firestore.
- **On your PC (testing only):** go to Firebase console → Project settings → Service accounts → **Generate new private key**. Save the file outside the project folder and set `GOOGLE_APPLICATION_CREDENTIALS` in `artifacts/api-server/.env` to its path. Never commit this file.

## Part 2: Deploy the server, database and website

Do steps 1–2 once, in the Firebase console (https://console.firebase.google.com/project/ewb---generator):

1. **Create the database.** Go to **Build → Firestore Database → Create database**. Choose location **asia-south1 (Mumbai)** and **Start in production mode**, then click **Create**. The location cannot be changed later.
2. **Turn on Hosting.** Go to **Build → Hosting → Get started**, then click **Next** through the steps until **Continue to console**. You don't need to run the commands it shows.

Then, on your PC, in the project folder (PowerShell or the VS Code terminal):

3. Get the latest code and packages:

   ```powershell
   git pull origin claude/vibrant-ptolemy-yxewea
   npx pnpm@9.15.9 install
   ```

4. Log in to Firebase (a browser window opens; pick the Google account that owns the project):

   ```powershell
   npm install -g firebase-tools
   firebase login
   ```

5. Run the first deploy:

   ```powershell
   firebase deploy
   ```

   The first time, it stops with **Created functions/.env**.

6. Open `functions/.env` in VS Code (`code functions/.env`) and fill in:
   - `GSTINAPI_KEY=gak_…` (your gstinapi.in key)
   - `RESEND_API_KEY=re_…` (your Resend key)
   - optional: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

   Save the file.

7. Deploy again:

   ```powershell
   firebase deploy
   ```

   - It adds `OTP_PEPPER`, `EWB_CREDENTIALS_SECRET` and `WALLET_ADMIN_TOKEN` to `functions/.env`, builds the server, deploys it, deploys the Firestore rules, builds the web version and publishes it.
   - The web build creates the Firebase web app **E-Way Easy Web** the first time and downloads its config, so you don't copy any web config by hand.
   - If it asks how many days to keep container images, press **Enter**.
   - The first deploy takes about 5–10 minutes.

8. Check it: open https://ewb---generator.web.app/api/healthz. It should show `{"status":"ok"}`. The website is https://ewb---generator.web.app.

Keep a copy of `functions/.env` somewhere safe (not in Git). If it is lost, saved e-way bill portal logins can no longer be decrypted.

**To change a setting or key later:** edit `functions/.env`, then run `firebase deploy --only functions`.
**After code changes:** run `firebase deploy` (or `--only functions` / `--only hosting`).

## Part 2b: gstinapi.in key, credits and payments

### Where the API key goes

The gstinapi.in key is a password, so it lives only on the server, never in the app or in `eas.json`.

| Where the server runs | Put the key here |
|---|---|
| Live (Cloud Functions) | `functions/.env`, then `firebase deploy --only functions`. The file is git-ignored. |
| On your PC (testing) | `artifacts/api-server/.env`. Copy `artifacts/api-server/.env.example` to `.env` and fill it in. `pnpm --filter @workspace/api-server run start` loads it automatically. The file is git-ignored. |

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

`OTP_PEPPER`, `EWB_CREDENTIALS_SECRET` and `WALLET_ADMIN_TOKEN` are generated on the first deploy. Don't add `FIREBASE_…` names to `functions/.env`: Firebase reserves them and sets the project ID itself.

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
   - URL: `https://ewb---generator.web.app/api/payments/razorpay/webhook`
   - Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
   - Event: **payment_link.paid**
4. **Buy credits in the app.** In the app, go to Wallet → Buy credits → choose a pack, then pay on Razorpay with UPI, card or net banking. Credits are added when Razorpay confirms the payment, through the webhook or when the app re-checks. Each payment is credited once.

Test first with Razorpay **test mode** keys (`rzp_test_…`); no real money moves.

Without Razorpay keys, the Wallet shows **Request credits** instead. You can then add credits by hand:

```bash
curl -X POST https://ewb---generator.web.app/api/admin/wallet/topup \
  -H "x-admin-token: WALLET_ADMIN_TOKEN_FROM_functions/.env" -H "content-type: application/json" \
  -d '{"workspaceId":"USER_WALLET_ID","credits":500,"note":"UPI ref 1234"}'
```

The user's Wallet ID is shown on their Wallet screen. It is their Firebase UID.

Before you sell credits:
- **GST:** selling credits is a taxable supply. Decide whether ₹1 per credit includes GST, and issue invoices from Razorpay or your accounting software.
- **Play Store:** credits sold inside an app on Google Play may need Google Play Billing, or Play's user-choice billing in India. A sideloaded APK isn't affected.

## Part 3: Web version

`firebase deploy` builds and publishes the website (Part 2). It reads the web sign-in config from the Firebase web app **E-Way Easy Web**, creating it the first time. To use a different web app, put its `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID` and `EXPO_PUBLIC_FIREBASE_APP_ID` in `artifacts/ewb-vendor-app/.env`.

The site is served at `https://ewb---generator.web.app`. Its `/api/**` calls go to the `api` function.

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

4. `artifacts/ewb-vendor-app/eas.json` already points the app at the server:

   ```json
   "env": {
     "EXPO_PUBLIC_API_URL": "https://ewb---generator.web.app"
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
6. Check it works: create a business, save an invoice, pull to refresh. Then confirm a document appears in Firebase console → Firestore Database → `workspaces`.

Alternative (USB): download the `.apk` to your PC, enable **Developer options → USB debugging** on the phone, then run `adb install path/to/app.apk`.

### Installing a newer version

1. In `app.json`, increase `android.versionCode` by 1 (and `version` if you like).
2. Run `eas build --platform android --profile preview` again.
3. Install the new APK over the old one. Your data is kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| App says "offline / service unreachable" | `EXPO_PUBLIC_API_URL` is wrong or not `https://`. Rebuild after fixing `eas.json`. |
| "Sign in again to continue" on every screen | The app was built for another Firebase project: `google-services.json` must be from `ewb---generator`. |
| Sign-in screen shows **Open local preview** | Native Firebase is missing: you are in Expo Go (Google sign-in needs a real build), or `GOOGLE_SERVICES_JSON` was not available to the build. |
| "Email verification is not set up on the server yet" | Set `RESEND_API_KEY` and `EMAIL_FROM` in `functions/.env`, then `firebase deploy --only functions`. |
| "Could not start verification right now" / "Could not activate your account" | The server cannot reach Firebase Authentication. Check the function's logs: Firebase console → Functions → `api` → Logs. |
| Code email never arrives | Check Resend → Emails for bounces, that the sender domain is verified, and the spam folder. |
| "Online payment is not set up yet" in the Wallet | Add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` to `functions/.env` and redeploy (Part 2b). |
| Paid, but credits did not arrive | Check the Razorpay webhook URL, its secret, and the event `payment_link.paid`. Re-opening the Wallet also re-checks pending payments. |
| "Google sign-in is not set up yet. Enable Google…" | The `google-services.json` used for the build has no Web client ID. Enable the Google provider, download the file again, update `GOOGLE_SERVICES_JSON`, and rebuild. |
| "Google sign-in is not set up for this app build yet (SHA fingerprints…)" | The keystore's SHA-1/SHA-256 is not in Firebase (Part 4, step 2). Adding it doesn't need a rebuild. |
| "This sign-in method is not enabled" | Enable **Google** (or Email/Password) in Authentication → Sign-in method. |
| Build fails: `google-services.json` not found | Run the `eas env:create … GOOGLE_SERVICES_JSON` command from Part 4, step 3. |
| EAS build fails at `pnpm install` with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | Keep `"pnpm": "9.15.9"` in `eas.json`. |
| "App not installed" over an older APK | The new build was signed with a different keystore. Uninstall the old app first. |
| `firebase deploy`: "Created functions/.env" or "still say your_key" | Fill in `functions/.env` (Part 2, step 6) and run `firebase deploy` again. |
| `firebase deploy`: Firestore database does not exist | Create it first (Part 2, step 1). |
| `firebase deploy`: no Hosting site | Click **Hosting → Get started** in the console (Part 2, step 2). |
| `firebase deploy`: a build or permission error mentioning `396238368123-compute@developer.gserviceaccount.com` | Enable the Compute Engine API once (https://console.cloud.google.com/apis/library/compute.googleapis.com?project=ewb---generator), wait two minutes, and deploy again. |
| `firebase deploy`: "Remove FIREBASE_… from functions/.env" | Delete that line. Firebase sets the project ID itself. |

## Still sandbox

E-way bills are real only with `EWB_PROVIDER=gstinapi` and `GSTINAPI_TEST_MODE=false` in `functions/.env` (Part 2b). GST return status (`GST_PROVIDER`) is still `sandbox` until a provider adapter is added. See README → "Before production".

## iOS

iOS builds also need `GoogleService-Info.plist` (Firebase → Add app → iOS, bundle ID `com.ewayeasy.app`), `ios.googleServicesFile` in `app.config.js`, and `expo-build-properties` with `ios.useFrameworks: "static"`. iOS is not set up yet.
