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

## Still blocks payment launch

- The game simulation runs in the player's browser. A player can alter local JavaScript and bypass the visible continue screen. No browser-only design can make local gameplay authoritative. If preventing unpaid continuation is a firm business requirement, move scoring, crash decisions and continue authorization to an authenticated server session before enabling payment.
- The operator legal identity, address, private support/grievance contact and GST treatment are not known and therefore are not invented in this repository.
- Gaming counsel/Authority classification, Razorpay written approval and CA sign-off remain external gates.
- The migration and Edge Function still require isolated Supabase and Razorpay Test Mode integration tests. No production keys or live charge should be used for this review.

## Verification

Run:

```sh
npm test
```

Then apply the schema to an isolated Supabase project, deploy the function with `PAYMENTS_ENABLED=false`, and run the negative cases listed in `RAZORPAY_LIVE_SETUP.md`. Only after all external and technical gates pass should a controlled Test Mode checkout be attempted.
