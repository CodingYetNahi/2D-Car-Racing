# Secure Razorpay Integration Plan

This repository is a static GitHub Pages game. GitHub Pages can host the game UI, but it **must not** hold Razorpay secrets, create Razorpay orders with a secret key, verify payment signatures, or decide that a purchase is valid.

## Trust boundary

### Browser / GitHub Pages may contain
- Razorpay `key_id` (public identifier only).
- Product/SKU identifiers such as `premium_unlock`.
- Razorpay Checkout UI invocation.
- Payment IDs/order IDs/signature returned by Checkout, only long enough to send them to the backend for verification.

### Backend only
- `RAZORPAY_KEY_SECRET`.
- Webhook secret.
- Order creation using Razorpay Orders API.
- Authoritative price, currency and product mapping.
- Payment signature verification.
- Webhook signature verification.
- Payment status/capture checks.
- Entitlement/unlock state.
- Idempotency records.

Never put `key_secret`, webhook secrets, private keys or service-role credentials in `index.html`, `script.js`, browser localStorage, GitHub Pages variables, query strings or committed files.

## Required server endpoints

Use a server/serverless platform (for example a Supabase Edge Function, Cloudflare Worker, Vercel/Netlify Function, or a small Node service). The exact platform can be chosen later.

### 1. `POST /api/payments/create-order`

Browser request example:

```json
{
  "sku": "premium_unlock"
}
```

The browser must **not** send an authoritative amount.

The backend must:
1. Validate the SKU against a server-side allowlist.
2. Determine amount and currency on the server.
3. Create a Razorpay order using the secret key.
4. Store a server-side record containing the internal purchase ID, Razorpay order ID, expected amount, currency, SKU, user/session identity and status.
5. Return only safe fields such as the Razorpay `order_id`, public `key_id`, amount, currency and purchase reference.
6. Apply rate limiting and an exact Origin/CORS allowlist for the production site.

### 2. `POST /api/payments/verify`

Browser sends:

```json
{
  "razorpay_order_id": "order_...",
  "razorpay_payment_id": "pay_...",
  "razorpay_signature": "..."
}
```

The backend must:
1. Look up the expected order ID from its own database. Do not trust the order ID solely because the browser supplied it.
2. Verify the Razorpay payment signature server-side using HMAC-SHA256 and `RAZORPAY_KEY_SECRET` (or the official Razorpay SDK).
3. Confirm the payment belongs to the expected order.
4. Confirm amount and currency match the server-side order.
5. Confirm the payment is in the required final/captured state before granting value.
6. Mark the purchase as paid atomically and idempotently.
7. Return a minimal result such as `{ "verified": true }`.

A client-side Checkout success callback is **not proof of payment**.

### 3. `POST /api/payments/webhook`

The backend must:
1. Read the **raw request body** before JSON parsing for signature validation.
2. Verify `X-Razorpay-Signature` using a dedicated webhook secret.
3. Reject invalid signatures.
4. Handle duplicate deliveries idempotently (store a unique event/payment/order key).
5. Do not assume events arrive in order.
6. Re-check the expected order, amount, currency and status before changing entitlement state.
7. Return success quickly after safely recording/processing the event.

Webhooks should be the authoritative asynchronous source of payment state. The verify endpoint can provide immediate UX confirmation.

## Frontend rules

When Checkout is added:
- Load Razorpay Checkout only from the official Razorpay Checkout URL.
- Obtain `order_id`, amount, currency and `key_id` from the backend.
- Do not calculate discounts or final payable amount only in JavaScript.
- Do not grant premium access, coins, ad removal, lives, scores or any paid entitlement from the Checkout handler.
- Send Checkout response fields to `/api/payments/verify` and wait for server verification.
- Disable the purchase button while an order/payment attempt is in progress to reduce duplicate submissions.
- Never log payment signatures or sensitive customer data to the browser console.
- Treat all browser data, localStorage and URL parameters as attacker-controlled.

## Anonymous game warning

The current game has no login/account system. If a payment unlocks something valuable, localStorage alone is not a secure entitlement store because users can edit it.

Use one of these approaches:
1. Add authenticated user accounts and store entitlements server-side (preferred), or
2. For anonymous purchases, issue a server-signed opaque entitlement token and validate it server-side whenever value is redeemed. Do not use a plain boolean such as `localStorage.paid = true`.

## Security controls for production

Backend:
- HTTPS only.
- Exact CORS allowlist (for example the production GitHub Pages/custom-domain origin), not `*` for credentialed requests.
- Strict input schema validation and length limits.
- Per-IP/session/user rate limits on order creation and verification.
- Server-generated receipts/idempotency keys.
- Database unique constraints so one payment cannot be redeemed twice.
- Constant-time signature comparison where implementing HMAC manually.
- Secrets stored only in the hosting platform's secret manager/environment.
- Separate Test and Live keys; never mix them.
- Rotate any secret immediately if it is ever committed.
- Minimal logs; do not log secrets/signatures/full customer data.

Browser/site:
- No secrets.
- Avoid inline scripts/eval.
- Use a restrictive Content Security Policy. Expand it only for the exact Razorpay origins required when Checkout is actually wired.
- Use `Referrer-Policy: strict-origin-when-cross-origin` (a meta fallback is acceptable on GitHub Pages).
- Do not render untrusted payment/customer strings with `innerHTML`.

## Suggested payment state machine

`created -> checkout_opened -> verification_pending -> paid`

Possible terminal/error states:

`failed`, `cancelled`, `expired`, `refunded`, `disputed`

Only the backend may transition a purchase to `paid`.

## Before live mode

- Test order creation with Razorpay Test keys.
- Test successful and failed payments.
- Test duplicate verify requests.
- Test duplicate/out-of-order webhooks.
- Test tampered amount/order/payment IDs/signatures.
- Test webhook signature failure.
- Test browser refresh between payment and verification.
- Confirm a paid entitlement cannot be forged via DevTools/localStorage.
- Confirm no secret exists in repository history, built files, Actions logs or browser network responses.
- Switch to Live keys only after the complete server verification/webhook flow passes.
