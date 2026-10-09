# Screen 06 — EWB review and generation

## Purpose

Present a final, readable confirmation of invoice and transport data before a bill is sent to the authorized EWB provider.

## Layout

- Banner clarifying that submission is to an external EWB provider and may create a government record.
- Seller/receiver summary and invoice reference.
- Product/taxable value/tax/total summary.
- Transporter, vehicle, distance, mode, and other provider-required details.
- Missing/invalid field checklist with **Edit** links back to the relevant section.
- Acknowledgement checkbox: “I reviewed these invoice and transport details.”
- Primary **Generate e-way bill** action; secondary **Save draft**.

## Behavior

- Revalidate on the backend and show current provider validation errors field-by-field.
- On tap, create an idempotent generation request with a stable request key. Disable repeat taps while pending.
- Call the provider only through a trusted Cloud Function/service. Keep credentials in server-side secrets.
- Show clear states: Checking → Submitting → Generated, Rejected, Pending provider confirmation, or Retry needed.
- If provider times out, check request/provider status before resubmitting; do not create duplicate bills.
- On confirmed success, save provider EWB number, validity, status, response metadata (redacted/minimized), and link invoice to EWB.
- Require explicit confirmation if a retry could create a duplicate or if a bill needs cancellation/replacement.

## Error handling

- Map provider errors into actionable language while retaining a safe reference code for support.
- Do not expose secrets, full provider payloads, or raw stack traces.
- If provider integration is not configured, disable generation and show “EWB provider setup required”; continue to allow draft preparation.

## Acceptance checks

- No EWB call occurs until the user confirms the reviewed details.
- The app reports Generated only after verified provider success and a returned EWB number.
- Duplicate taps/network retries do not create duplicate external submissions.

