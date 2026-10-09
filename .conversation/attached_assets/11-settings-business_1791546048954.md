# Screen 11 — Account and business settings

## Purpose

Keep business setup and account controls easy to find without mixing them into the invoice workflow.

## Sections

- User profile and sign-out.
- Business profile: legal name, addresses, contact info, business timezone.
- GST registrations: one or more GSTINs, state, display name, default seller GSTIN, and verification/source status.
- Saved buyers/receivers, products, transporters, and invoice template preferences.
- Team members and roles (owner/admin/member/viewer) if multi-user businesses are enabled.
- Subscription and usage.
- Help/support, privacy, terms, app version, and data export/delete request.

## Behavior

- Validate GSTIN/address fields and show source/verification timestamp where verification is performed.
- Role changes, removing a member, deleting a GSTIN, and destructive account actions require confirmation and authorization.
- Keep account deletion/data retention aligned with applicable law and provider contracts; communicate any records retained.
- Profile edits must not rewrite previously generated EWB records.

## Security

- Use Firebase Auth UID plus explicit business membership/role checks.
- Client-side route guards are for UX only; Firestore/Storage rules and Cloud Functions enforce authorization.
- Users may belong to more than one business; never infer access from a client-supplied business ID alone.

