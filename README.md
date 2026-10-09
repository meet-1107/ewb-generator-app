# EWB Vendor App

Android / iOS app (Expo + React Native) that helps Indian vendors create GST sales invoices, generate and manage e-way bills, and check GSTR-1 / 2B / 3B status. A trusted Express backend sits between the app and every provider.

The product spec is in git history under `.conversation/attached_assets/` (README + screens 01–12).

## Run locally

```bash
pnpm install
pnpm --filter @workspace/api-server run build
node artifacts/api-server/dist/index.mjs          # API on http://localhost:5000
cd artifacts/ewb-vendor-app && npx expo start      # press w (web), a (Android), i (iOS)
```

The web build talks to `http://localhost:5000` automatically. On a phone, set `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:5000`. Without Firebase env vars, the sign-in screen offers **Open local preview** (test data, sandbox providers).

## Deploy

Firebase Auth + Cloud Run + optional Firebase Hosting, and building/installing the Android APK: see [docs/DEPLOY.md](docs/DEPLOY.md).

## What's in the app

| Area | Screens |
|---|---|
| Access | Mobile number + SMS OTP log in / sign up (Android), email sign in / create account / reset (Firebase), preview mode, business setup with GSTIN check-digit validation |
| Dashboard | Month sales, 4 tappable stats (invoices, generated, active, expired), GST strip, expiring-soon alert, recent activity, pull to refresh, offline banner |
| Invoices | Search, status chips, date filters, 6 layout templates, long-press duplicate/delete, pagination |
| Invoice editor | Collapsible sections, saved buyer/product/transporter pickers, auto CGST+SGST vs IGST, qty × rate, inline errors, autosave, sticky total, locked after EWB |
| PDF import | Pick PDF → server extracts fields with confidence tags → review in editor |
| E-way bill | Server re-validation, acknowledgement, idempotent generate, timeout reconciliation, success screen, detail with validity bar, update vehicle / extend / cancel (legal time windows), print / PDF / share |
| GST status | Per GSTIN + period, refresh (rate-limited), return details with ARN |
| Account | Profile, multiple GST registrations, saved details, plan & usage, appearance (system/light/dark), cloud sync, data export, deletion request, sign out |

## Architecture

- **Mobile** (`artifacts/ewb-vendor-app`): local-first store (`state/app-store.tsx`) persists to device and syncs to the backend (last write wins per record). Domain rules: `lib/domain.ts`. API client: `lib/api.ts`. UI kit: `components/AppUI.tsx`. Dialogs/toasts: `components/Dialog.tsx`.
- **Backend** (`artifacts/api-server`): `providers/ewb-provider.ts` and `providers/gst-provider.ts` are adapter interfaces with **sandbox** implementations; `lib/validation.ts` holds the authoritative rules; `routes/` holds e-way bills, GST, PDF, sync, subscription.
- E-way bill generation is never queued offline. Retries reuse an idempotency key, so a duplicate submission returns the existing bill instead of creating a second one.

## Environment

| Variable | Where | Purpose |
|---|---|---|
| `google-services.json` (git-ignored; EAS file variable `GOOGLE_SERVICES_JSON`) | Android app | Enables mobile OTP + email sign-in via React Native Firebase |
| `EXPO_PUBLIC_FIREBASE_API_KEY`, `_PROJECT_ID`, `_APP_ID`, `_AUTH_DOMAIN` | web app | Enables email sign-in on web (preview mode is hidden) |
| `EXPO_PUBLIC_API_URL` | app | Backend URL |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | app | Support / deletion requests |
| `FIREBASE_PROJECT_ID` | server | Requires and verifies Firebase ID tokens (otherwise sandbox workspace IDs are accepted) |
| `EWB_PROVIDER`, `GST_PROVIDER` | server | Provider adapter (default `sandbox`) |
| `PLANS_JSON`, `BILLING_PROVIDER` | server | Real plans / billing (defaults are labelled samples) |
| `DATA_DIR`, `PORT` | server | Storage directory, port (dev default 5000) |

## Before production (launch blockers)

1. Contract a licensed GSP and implement its adapter behind the `EwbProvider` / `GstProvider` interfaces.
2. Set `FIREBASE_PROJECT_ID` so the server rejects unauthenticated calls.
3. Replace the JSON-file `WorkspaceStore` with Postgres (`lib/db`), and the in-memory rate limiter with Redis, before running more than one instance.
4. Wire App Store / Play billing and approve real plans (no prices are final).
5. Approve PDF retention policy (currently processed in memory, not stored) and set the support email.
