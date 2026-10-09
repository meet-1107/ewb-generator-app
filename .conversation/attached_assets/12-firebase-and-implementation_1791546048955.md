# Firebase data model and implementation plan

## Proposed stack

- Expo / React Native + TypeScript; React Navigation; accessible native form controls.
- Firebase Authentication for sign-in.
- Cloud Firestore for business, invoice, EWB, and status metadata.
- Firebase Storage for private source PDFs and generated documents.
- Cloud Functions (or an equivalent trusted server) for authorization-sensitive writes, PDF processing orchestration, provider calls, webhook handling, and subscription entitlements.
- Firebase App Check, crash reporting, and privacy-reviewed analytics.

## Firestore shape

```text
users/{uid}
  displayName, email, phone, createdAt, updatedAt

businesses/{businessId}
  legalName, defaultGstin, ownerUid, createdAt, updatedAt, schemaVersion

businesses/{businessId}/members/{uid}
  role: owner | admin | member | viewer
  joinedAt, active

businesses/{businessId}/gstRegistrations/{gstinId}
  gstin, legalName, stateCode, address, isDefault, verificationState, checkedAt

businesses/{businessId}/invoices/{invoiceId}
  invoiceNumber, invoiceDate, documentType, seller, receiver, lineItems[]
  totals, transport, templateId, templateVersion
  status: draft | ready | ewb_generated
  sourceUploadId?, createdBy, updatedBy, createdAt, updatedAt, schemaVersion

businesses/{businessId}/invoiceUploads/{uploadId}
  storagePath, contentType, sizeBytes, parseStatus, parserVersion
  extractedFields, linkedInvoiceId?, uploadedBy, uploadedAt, expiresAt?

businesses/{businessId}/ewbs/{ewbId}
  invoiceId, provider, providerBillId?, ewbNumber, status
  generatedAt, validUntil, lastVerifiedAt, verificationSource
  transportSnapshot, documentStoragePath?, createdAt, updatedAt

businesses/{businessId}/ewbRequests/{requestId}
  invoiceId, idempotencyKey, state, providerReference?, safeErrorCode?
  createdBy, createdAt, completedAt?

businesses/{businessId}/gstStatus/{statusId}
  gstin, returnType, period, providerStatus, checkedAt, source, referenceId?

businesses/{businessId}/subscriptions/current
  planId, entitlementState, usagePeriod, usageCount, renewalAt, updatedAt

businesses/{businessId}/auditEvents/{eventId}
  actorUid, action, targetType, targetId, occurredAt, outcome, safeReference?
```

Use typed subobjects for monetary values (integer paise or decimal-safe representation), quantities, addresses, and GST rates. Define date/time encoding consistently (Firestore Timestamp in UTC; render with business timezone). Do not put secrets or full payment details in Firestore.

## Access control

- Firestore rules deny by default. Require active membership for every business-scoped read.
- Enforce role permissions for invoice writes, member management, subscription management, and externally consequential EWB actions.
- Never rely on a client-written `ownerUid`, business ID, EWB status, entitlement, provider result, or role claim without server validation.
- Storage rules mirror membership checks and restrict paths to the owning business; PDFs are not public.
- Cloud Functions verify Firebase Auth, App Check where practical, membership/role, schema, quotas, and idempotency before processing.
- Add automated rules tests for cross-business reads/writes, removed members, viewer permissions, and forged status/entitlement fields.

## EWB/API integration boundary

1. Select an authorized EWB API provider/GSP and confirm account onboarding, sandbox, API contract, permitted actions, rate limits, error semantics, and production approval.
2. Store provider credentials in Replit/Firebase server-side secrets—not app config, Firestore, or source code.
3. Define a provider adapter interface (`validate`, `generate`, `getStatus`, supported `updateVehicle` / `extend` / `cancel`, `fetchDocument`) so provider-specific fields do not leak into screen code.
4. Normalize only statuses that have an exact provider meaning; persist source and check time.
5. Handle idempotency, timeout reconciliation, provider throttling, retries, and duplicate prevention.
6. Use a sandbox and test GSTINs only until the provider confirms production readiness.

PDF parsing needs a separately approved parser/service and retention policy. GSTR status needs separate provider access if not included in the EWB contract.

## Mobile implementation conventions

- Organize code by feature: `auth/`, `dashboard/`, `invoices/`, `ewb/`, `gst/`, `subscription/`, `settings/`, and shared `components/`, `data/`, `validation/`.
- Use typed form schemas and one shared invoice/EWB domain model; keep presentation components separate from provider integration.
- Use React Hook Form plus schema validation (for example Zod); use server validation as the final authority.
- Autosave drafts with debouncing and visible save state. Use Firestore offline persistence only for draft/read data; do not queue provider submission offline.
- Use emulator suite for Auth/Firestore/Storage/Functions; test validation, PDF parse failures, provider timeouts, duplicate retries, permission boundaries, and subscription transitions.
- Add accessibility labels, dynamic text sizing, keyboard-safe forms, and screen-reader announcements for asynchronous states.

## Delivery sequence

1. Confirm business rules: invoice templates/numbering, EWB provider, GST-status provider, subscription model, PDF parser and retention, roles, and languages.
2. Build login, business onboarding, dashboard shell, Firebase rules, and emulator tests.
3. Build invoice templates, editor, draft persistence, and PDF import/review.
4. Integrate EWB provider in sandbox; build review/generation, detail, archive, and lifecycle actions supported by contract.
5. Add GST status provider and subscription entitlement/webhook flow.
6. Run device testing, accessibility review, security/rules tests, provider sandbox certification, and production-readiness checks before release.

## Launch blockers to resolve

- Which EWB provider/GSP is contracted and approved for production?
- Which provider supplies GST return status, and does it specifically support the requested GSTR statuses?
- Which six starter invoice layouts and languages should ship?
- Which subscription billing provider, plans, usage limits, and cancellation/read-only policy apply?
- Which PDF parsing service is approved, and what are file retention/deletion requirements?
