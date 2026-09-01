# Security and legal remediation status

This branch implements the code changes that can be made safely before live merchant, counsel and tax details exist. It does not enable payments.

## Addressed in code

- Replaced escalating per-crash prices with fixed, non-renewing ₹29/24-hour and ₹99/7-day products.
- Server allowlist controls product, price, currency and duration.
- Added adult-payer confirmation and linked Terms, Privacy, Refund, Parent and Contact pages.
- Added explicit fail-closed launch settings: `PAYMENTS_ENABLED`, merchant legal name and support contact.
- Added exact production origins, request-size limits and per-client/action rate limits.
- Added server-side signature, order, amount, currency and captured-state checks.
- Added opaque 256-bit entitlement tokens; only hashes are stored server-side.
- Added atomic order, fulfillment, token rotation and pass-consumption database functions.
- Added signed webhook handling for captured, failed and refunded payments; refunds revoke passes.
- Kept all payment tables behind RLS and revoked browser-role access.
- Pinned GitHub Actions to immutable commit SHAs and added least-privilege security tests.
- Added recovery for repeated verification without extending the original expiry.
- Added deterministic, fixed-tick gameplay shared by the browser and server verifier.
- Added signed, expiring, single-use official runs and server-side replay validation.
- Added pseudonymous player tokens stored only as SHA-256 hashes, RLS-denied verification tables, and a server-read leaderboard.

## Still blocks payment launch

- A player can still alter local JavaScript, bypass the visible continue screen and play a modified local copy. Official scores are now server-replayed and cannot be directly written from the browser. Enforcing paid access to all gameplay would additionally require authenticated server sessions and recurring server decisions; it is not implemented and payments remain disabled.
- The operator legal identity, address, private support/grievance contact and GST treatment are not known and therefore are not invented in this repository.
- Gaming counsel/Authority classification, Razorpay written approval and CA sign-off remain external gates.
- The migration and Edge Function still require isolated Supabase and Razorpay Test Mode integration tests. No production keys or live charge should be used for this review.

## Verification

Run:

```sh
npm test
```

Then apply the schema to an isolated Supabase project, deploy the function with `PAYMENTS_ENABLED=false`, and run the negative cases listed in `RAZORPAY_LIVE_SETUP.md`. Only after all external and technical gates pass should a controlled Test Mode checkout be attempted.
