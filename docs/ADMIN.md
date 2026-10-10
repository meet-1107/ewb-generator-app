# Admin panel

The admin panel is a web page on Firebase Hosting at `https://<project>.web.app/admin/` (for this project, https://ewb---generator.web.app/admin/). It reads and changes data only through the API (`/api/admin/*`, `artifacts/api-server/src/routes/admin.ts`). The API checks the signed-in admin's role on every call. There is no second backend and no database access from the browser; Firestore rules still deny all client access.

## First-time setup

1. In `functions/.env`, set your own email (an E-Way Easy account with a verified email, e.g. the Google account you sign in with):
   ```
   SUPER_ADMIN_EMAILS=you@example.com
   ```
2. Firebase console → Project settings → Your apps: if there is no **Web** app, add one (any nickname, no Hosting setup). The panel loads its Firebase config from Hosting's `/__/firebase/init.json`, which exists only when a web app is registered.
3. Deploy the API and the website: `npx -y firebase-tools@15.33.0 deploy --only functions,hosting`
4. Open `/admin/`, sign in with Google or email + password. Other admins: **Admins & roles → Add or change admin** (they need an account with a verified email; they sign in again afterwards).

Removing an email from `SUPER_ADMIN_EMAILS` (and deploying) removes that super admin. A role given in the panel is stored as the `admin_role` custom claim on the Firebase account and is read live (cached 60 s) on every call, so removing it takes effect within a minute.

## Roles

| Permission | Super | Finance | Support | Technical |
| --- | --- | --- | --- | --- |
| Overview, users, e-way bills | ✓ | ✓ | ✓ | ✓ |
| Names, emails, full GSTINs | ✓ | ✓ | ✓ | masked |
| Payments, credit ledger | ✓ | ✓ | ✓ | – |
| Adjust credits, re-check payments | ✓ | ✓ | – | – |
| API usage and provider quota | ✓ | – | – | ✓ |
| Reconciliation, settings and health | ✓ | ✓ | – | ✓ |
| Audit log, CSV exports | ✓ | ✓ | – | – |
| Suspend accounts, manage admins | ✓ | – | – | – |

High-risk changes (credit adjustments, suspensions, role changes) also need a sign-in within the last 15 minutes. The panel asks the admin to sign in again when it is older. Admin sessions end when the browser closes, or after 30 minutes without activity.

## Where each number comes from

| Metric | Source and rule |
| --- | --- |
| Users, verified, suspended, last sign-in | Firebase Authentication account list |
| New users | Account creation time, in India time |
| E-way bills generated | Provider-confirmed bill records (`workspaces/{uid}/ewbs`), by generation time. Status is the current one (expired = past valid-until). |
| Generation attempts, success rate | `ewb_generate` provider calls in the period (one per HTTP attempt) |
| API requests, failures, timeouts, response times | `api_calls` log: one record per outbound request to gstinapi.in or Google Routes (each retry is its own record). Logging started with this release; earlier traffic is not counted. |
| Provider credits left | `credits_remaining` as gstinapi.in last reported it on a response (`provider_status/gstinapi`). Shown with its report time; "Not reported" until then. Nothing is estimated. |
| Credits bought / welcome / adjusted / consumed | Wallet ledger entries in the period: `topup`, `grant`, `adjust`, and `charged` charges. Holds returned after a failed or unknown call count as "returned on failures", never as consumed. |
| Outstanding credits | Sum of current wallet balances |
| Payments, gross collected | Razorpay purchases with status `paid`, by paid time. Amounts are gross, as charged. Gateway fees and GST are not recorded by the app, so this is not revenue or profit. Sandbox test purchases are excluded. |
| Webhook deliveries | `payment_events` log: every verified Razorpay delivery, plus refused signatures |

Totals are built from all records at most once a minute and shared by all admin screens ("data as of" on each page).

## Reconciliation checks

Each check is run per account; nothing is fixed automatically.
- **Payments and credits:**
  - a paid purchase with no credit entry;
  - a purchase credited twice;
  - credits added without a payment;
  - a top-up that points to an unknown purchase;
  - an unpaid payment link more than an hour old;
  - a webhook that credited an unknown purchase.
- **Charges and bills:**
  - a charge with no bill;
  - a bill charged twice;
  - a bill with no charge;
  - a bill number recorded twice.
- **Balances:**
  - a balance that does not equal its ledger;
  - a negative balance;
  - credits held for more than 15 minutes.

## Actions

| Action | Who | What it does |
| --- | --- | --- |
| Adjust credits | Super, Finance | Adds or removes credits through the wallet ledger, in one transaction. It is applied once per request reference, never goes below zero, needs a reason, and is recorded in the customer's ledger, the account history and the admin audit log. |
| Re-check payment | Super, Finance | Asks Razorpay for the link's real status. If it is paid, it credits once, the same way the webhook does. A payment can never be marked paid by hand. |
| Suspend / reactivate | Super | Disables Firebase sign-in and revokes sessions. The API refuses the account within a minute. Data is kept. |
| Admins & roles | Super | Sets or removes the `admin_role` claim |

E-way bills are read-only in the panel: they are created, cancelled and changed only from the app, by the business that owns them.

## Audit log

The `admin_audit` collection is append-only. Nothing in the app updates or deletes it, and clients cannot reach Firestore. It records:
- admin sign-ins (`admin.session`);
- denied access and denied actions;
- account views (`admin.user.view`);
- credit adjustments, with the balance before and after;
- suspensions, payment re-checks and role changes;
- reconciliation runs and exports.

Each record has the admin, role, target, outcome, reason, correlation ID and IP address.

## Not available yet

| Asked for | Status | What is needed |
| --- | --- | --- |
| Refunds, chargebacks | Not tracked | A refund flow and Razorpay `refund.*` webhooks |
| Receipts / GST invoices for credit purchases | Not issued | Receipt generation |
| Paid subscriptions | Display only, not sold | A billing integration |
| Editable credit packages and prices | Server settings (`CREDIT_PRICE_PAISE`, `CREDIT_PACKS_JSON`, `CREDIT_COSTS_JSON`) | Versioned price records, if prices should change from the panel |
| Alerts (email on failure spikes, low quota) | Not built | A scheduled function and an email channel (Resend is already configured) |
| Admin multi-factor sign-in | Not enforced | Firebase Identity Platform (MFA); then require it in `requireAdmin` |
| Gateway fees, GST split of payments | Not recorded | Razorpay settlement data |
| API calls before this release | Not logged | Counting starts at deploy |

## Scale

Each refresh reads every workspace document and its e-way bills (about 1 read per account plus 1 per bill), at most once a minute per server instance while an admin has the panel open. API usage reads up to 20,000 log records per query; the panel says when a period hits that cap.

Past a few thousand accounts, keep per-day counters at write time instead (bills, credits, payments per day), and query those.
