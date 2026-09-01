# Razorpay fixed-pass setup

Payments are intentionally disabled. The prepared products are fixed, non-renewing access fees:

- `day`: ₹29 for 24 hours
- `week`: ₹99 for 168 hours

They grant unlimited continues during the pass period. They never renew and provide no stake, prize, cash-out, transferable credit or redeemable reward.

## Do not enable payments until

1. The security and legal launch gates are closed.
2. Indian gaming counsel confirms the model and any required Online Gaming Authority step is complete.
3. Razorpay gives written approval for the exact non-money-game model.
4. The operator legal name, business address, support email, grievance contact and GST treatment are published.
5. The schema and Edge Function pass isolated Razorpay Test Mode testing.

## Backend setup

1. Apply `supabase/payment-schema.sql` in the dedicated project.
2. Deploy `supabase/functions/racing-payments` with JWT verification disabled. The function performs exact origin checks, opaque entitlement checks and rate limiting.
3. Set server-managed secrets: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RATE_LIMIT_SECRET` (at least 32 random bytes), `MERCHANT_LEGAL_NAME`, and `SUPPORT_EMAIL`.
4. Configure `.../racing-payments/webhook` for payment captured/failed and refund events.
5. Leave `PAYMENTS_ENABLED` unset or `false` until every launch gate passes. Set it to `true` only for the final approved deployment.
6. Set `window.RACING_PAYMENT_API_BASE` in `payment-config.js` to the deployed function base URL.

No Razorpay secret, webhook secret, service-role key or rate-limit secret may appear in GitHub Pages, repository files or browser logs.

## API flow

- `POST /start-run` creates a server run, subject to rate limits.
- `POST /create-order` accepts only `day` or `week`, requires adult confirmation and the current Terms version, and calculates the price on the server.
- `POST /verify-payment` verifies signature, order, amount, currency and captured state. It atomically creates a time-limited entitlement and returns a random bearer token.
- `POST /check-pass` validates an entitlement without extending it.
- `POST /authorize-continue` validates an active pass and records a continue atomically.
- `POST /webhook` validates the raw-body signature and reconciles captured, failed and refunded payments. A refund revokes the pass.

The browser stores only the opaque access token. The database stores only its SHA-256 hash. Never log the token, put it in a URL or share it.

## Required tests

- Payments fail closed while the enable flag or merchant/support details are missing.
- Client-supplied amounts cannot alter ₹29 or ₹99.
- Missing adult confirmation or an old Terms version is rejected.
- Invalid origin/signature/order/amount/currency and uncaptured payments are rejected.
- Repeated order creation reuses the pending order.
- Repeated verification recovers the entitlement without extending expiry.
- Expired, refunded, revoked and forged tokens are rejected.
- Duplicate webhook events are harmless and a refund revokes access.
- Rate limits return 429 without load testing.
- Free restart works while payments are absent or unavailable.
- Secret scanning remains clean.
