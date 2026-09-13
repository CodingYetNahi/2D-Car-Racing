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
- Added atomic order, one-time entitlement issuance, monotonic webhook/refund reconciliation and pass-consumption database functions.
- Added signed webhook handling for captured, failed and refunded payments; refunds revoke passes.
- Kept all payment tables behind RLS and revoked browser-role access.
- Pinned GitHub Actions to immutable commit SHAs and added least-privilege security tests.
- Removed anonymous recovery by replay: repeated verification cannot retrieve or rotate the one-time bearer credential. Lost anonymous tokens require support/refund handling or a future identity-backed recovery design.
- Added deterministic, fixed-tick gameplay shared by the browser and server verifier.
- Added signed, expiring, single-use official runs and server-side replay validation.
- Added pseudonymous player tokens stored only as SHA-256 hashes, RLS-denied verification tables, and a server-read leaderboard.

## Still blocks payment launch

- A player can still alter local JavaScript, bypass the visible continue screen and play a modified local copy. Official scores are now server-replayed and cannot be directly written from the browser. Enforcing paid access to all gameplay would additionally require authenticated server sessions and recurring server decisions; it is not implemented and payments remain disabled.
- The operator legal identity, address, private support/grievance contact and GST treatment are not known and therefore are not invented in this repository.
- Gaming counsel/Authority classification, Razorpay written approval and CA sign-off remain external gates.
- The verified-run schema and Edge Function passed isolated live integration tests. The separate payment migration and Razorpay flow still require Test Mode integration tests. No production payment key or live charge should be used for this review.

## Verification

Run:

```sh
npm test
```

Then apply the schema to an isolated Supabase project, deploy the function with `PAYMENTS_ENABLED=false`, and run the negative cases listed in `RAZORPAY_LIVE_SETUP.md`. Only after all external and technical gates pass should a controlled Test Mode checkout be attempted.

## 2026-09 production audit findings

| Severity | Component | Finding | Exploit scenario | Fix | Regression evidence |
|---|---|---|---|---|---|
| Critical | Payment entitlement | Replayed Checkout proof rotated the current anonymous bearer token. | Anyone holding old checkout fields could invalidate the buyer's pass and take it over. | One atomic issuer now returns a token only to the winning first request; duplicate/replayed requests preserve the original hash and return conflict. Legacy rotation RPCs are dropped. | `payment replay cannot rotate...` and state-machine tests. |
| High | Payment webhooks | Refund and entitlement revocation used separate writes; captured events did not validate stored amount/currency. | A partial failure left refunded access active, or malformed/out-of-order events corrupted state. | Transactional, row-locked, monotonic webhook RPC validates facts and revokes atomically. | Payment state-machine assertions. |
| High | Pages deployment | The workflow published the whole repository. | SQL, backend code, tests, and future internal files became public artifacts. | Build produces an explicit frontend allowlist and relocates only the shared browser engine. | Artifact allowlist test. |
| High | HTTP availability | `Content-Length` alone did not bound streamed bodies and JSON media type was not required. | Chunked oversized requests consumed memory/CPU before rejection. | Both functions incrementally cap request bodies and reject unsupported media types before JSON parsing. | HTTP-handler regression test. |
| Medium | Verified-run secrets | Signing/rate secrets silently derived from the service-role key. | Key reuse coupled unrelated trust domains and rotation behavior. | Both independent secrets are mandatory and minimum-length checked. | Source regression assertion. |
| Medium | Replay canonicalization | Multiple direction events at one tick were ambiguous. | Crafted inputs exploited ordering differences or created non-canonical replays. | Server requires strictly increasing ticks; browser coalesces same-tick changes. | Adversarial replay test. |
| Medium | Operational storage | Rate buckets and abandoned runs lacked a cleanup mechanism. | Sustained valid requests caused indefinite table growth. | Backend-only cleanup RPCs are provided for scheduled execution. | Schema cleanup privilege test. |
| Low | GitHub Pages headers | Hosting cannot configure a complete set of HTTP security headers. | Meta policies cannot express every response-level defense. | Limitation and controlled-CDN alternative are documented. | Checklist review. |

See `PRODUCTION_SECURITY_CHECKLIST.md` for controls that cannot be enforced in source. Residual risks include bot-assisted but simulation-valid play, seed shopping, bearer-token theft through a compromised origin/device, lack of identity-backed entitlement recovery, application rate limiting that cannot stop volumetric attacks, and required live Razorpay/Supabase integration validation.
