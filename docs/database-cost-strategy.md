# Keeping the database cheap at millions of users

E-Way Easy uses Cloud Firestore (asia-south1). Firestore bills **per document read,
write and delete** (plus storage), not per query or per byte. So the cost is decided
by how many documents each screen and each server request touches. This plan lists
where the app spends reads and writes today, what was already changed, and what to
build next, in order of how much it saves.

Prices below are rough (check the Firebase pricing page for asia-south1). Use them to
compare options, not as a bill.

## Where the reads and writes go today

Per active user per day (about 3 app opens):

| What | Reads | Writes | Notes |
|---|---|---|---|
| App open: config, consent, wallet, notifications, e-way bill list, sync | ~6 per open | 1 (`app_opens` log) | config and suspensions are cached in memory, so they cost nothing |
| Creating / editing invoices (sync) | 1 + changed docs | 1 per changed doc | already incremental (`since`), good |
| Generating an e-way bill | ~4 | ~4 + 1 (`api_calls` log) | includes the notification and push transaction |
| Support chat open | 1 per load | – | polling cut from 30 s to 2 min (see below) |

At 1 million daily users that is roughly **20 million reads and 4 million writes a day**.
That is affordable (tens of dollars a day). **The real danger is the admin panel**,
covered next.

### The one thing that does not scale: the admin snapshot

`lib/admin-data.ts` builds the dashboard by reading **every workspace, every e-way bill
and every invoice** (once a minute while an admin has the panel open). With 1 million
accounts, that is many millions of reads **per admin page load**, slow and costly. It
also needs more memory than a Cloud Function has. Fixing this is step 1 below.

## Already done (this release)

1. **Logs expire by themselves.** Every log row (`api_calls`, `app_opens`, `payment_steps`,
   `payment_events`, `admin_audit`) now carries an `expireAt` date (120 days to 2 years).
   Once a TTL policy is switched on (steps below), Firestore deletes old rows by itself,
   so storage stops growing and no code has to read them to clean up.
2. **Support chat is not polled every 30 s.** A team reply arrives as a push notification
   and refreshes the open chat right away. The fallback poll is every 2 minutes.
3. **Screens wait for sign-in before loading.** This avoids failed requests and retries at
   app start.
4. **Settings that rarely change are cached on the server** (suspended accounts, app version).

### Switch on the TTL policies (one time, about 2 minutes)

Firebase console → Firestore Database → **TTL** → *Create policy*, once for each:

| Collection group | Timestamp field |
|---|---|
| `api_calls` | `expireAt` |
| `app_opens` | `expireAt` |
| `payment_steps` | `expireAt` |
| `payment_events` | `expireAt` |
| `admin_audit` | `expireAt` |

Rows written before this release have no `expireAt` and stay. They are small, and can
be removed once by a script if needed.

## Next steps, biggest saving first

### 1. Admin panel from counters, not from all data (most important) — built

Built in `lib/metrics.ts`, `lib/admin-counters.ts` and `lib/metrics-rebuild.ts`. Daily
counters are split over 10 shards and bumped in the event's own transaction; the
`user_index/{uid}` document is written by the store when an account's summary changes.
Turn it on once: Admin panel → Settings & health → **Build counters**. After that the
Overview and Users pages read counters and 50-row pages. Pages that still read every
account (e-way bill list, payments, ledger, reconciliation, exports) are refused above
5,000 accounts (`ADMIN_SNAPSHOT_LIMIT`) with a clear message. They are the next to move,
to BigQuery (step 2).

The original plan:

- Keep **daily counter documents** (`stats/2026-11-18`): sign-ups, e-way bills
  generated, payments, invoices made, credits sold. Increment them with
  `FieldValue.increment()` in the same transaction that records the event. Then the
  overview reads ~30 documents for a month, whatever the number of users.
- Keep a small **user index document per account** (`user_index/{uid}`): name, email,
  business, GSTIN, counts, balance, last activity. Update it when those change. Then the
  Users page uses a Firestore query with `orderBy` and `limit(50)` and pages through it,
  so it reads 50 documents per page instead of all of them.
- Search by email, GSTIN or business uses the same index (exact-match fields), or
  Algolia or Typesense later if free-text search is needed.
- Result: admin cost falls from *millions of reads per view* to *about 50*.

### 2. Logs and analytics out of Firestore

`api_calls` and `app_opens` are analytics, not app data. Write them as structured log
lines (Cloud Logging) with a **log sink to BigQuery**. Admin charts then query BigQuery,
which is cheap for aggregates, and Firestore writes for logs drop to zero. Keep in
Firestore only what the app itself needs (payment events for reconciliation).

### 3. One request when the app opens

Combine wallet, notifications (unread count), consent, the e-way bill changes and the
sync check into a single `/bootstrap` call that reads the account document **once**.
That is about 6 reads per open down to 2–3, and the app also opens faster on slow
networks.

### 4. Keep the account document small

The account (workspace) document is read on almost every request. It now holds up to
1,000 wallet entries and 500 audit events. Move both into **sub-collections** (one
document per entry, read a page at a time only on the Wallet / Audit screens). Every
request then reads a small document: faster, and far from Firestore's 1 MB limit.

### 5. Fewer transactions per event

When an e-way bill is generated or credits are added, the notification is saved in the
event's transaction. A second transaction then reads it back to push it. Return the
phone tokens from the first transaction and push directly. That saves 1 read and
1 write per event.

### 6. Let the phone skip unchanged data

The app is already local-first. Keep a `changedAt` stamp on the account document. The
app sends the one it last saw, and the server answers "nothing changed" after reading
only that document, without opening e-way bills, invoices or the wallet.

## Rules for new features

- **Never read a whole collection in a request.** Use a query with a `limit`, or a
  counter or summary document.
- **No timers that call the server** while the app is open. Use push notifications, app
  resume, or pull-to-refresh.
- **Analytics go to logs or BigQuery**, not into Firestore documents.
- **Anything that grows forever** gets a TTL (`expireAt`) or a size cap (like the support
  chat, which is trimmed to stay well under 1 MB).
- **Cache settings that rarely change** in server memory for a minute.

## Rough effect at 1 million daily users

| | Today | After steps 1–4 |
|---|---|---|
| App reads per day | ~20 M | ~8 M |
| Log writes per day | ~4 M | ~0 (to BigQuery) |
| Admin panel | millions of reads per view | ~50 per view |
| Account document | grows to hundreds of KB | a few KB |
