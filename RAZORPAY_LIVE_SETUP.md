# Razorpay pay-to-continue setup

The game uses a linear crash price: crash 1 = ₹9, crash 2 = ₹18, crash 3 = ₹27, and so on. A payment is never started automatically. The player must press the displayed **Pay ₹X & Continue** button after each crash.

## Security model

- GitHub Pages contains only public frontend code.
- `RAZORPAY_KEY_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` and webhook secrets must never be committed to this repository.
- The backend creates Razorpay Orders and calculates the amount from server-side crash state.
- The browser cannot choose or reduce the amount.
- The backend verifies `razorpay_signature` with HMAC-SHA256 and checks the Razorpay payment's order ID, amount, currency and capture status before the game resumes.
- `localStorage` is used only for the best score; it is never proof of payment.

## Dedicated Supabase project required

Use a dedicated project for this game. Do not reuse an unrelated production database.

1. Run `supabase/payment-schema.sql` in the dedicated project's SQL editor.
2. Deploy `supabase/functions/racing-payments` as an anonymous Edge Function (`verify_jwt = false`) because the game itself has no Supabase login. The function performs its own origin/input/payment validation.
3. Add these Edge Function secrets in Supabase:
   - `RAZORPAY_KEY_ID`
   - `RAZORPAY_KEY_SECRET`
4. Do not expose `SUPABASE_SERVICE_ROLE_KEY`; hosted Edge Functions receive it server-side.
5. Set Razorpay payment capture to automatic, or update the backend to explicitly capture authorised payments before granting continuation.
6. In `payment-config.js`, set:

```js
window.RACING_PAYMENT_API_BASE = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/racing-payments";
```

7. Test with Razorpay Test Mode first. Confirm that ₹9 is charged for crash 1, ₹18 for crash 2, and ₹27 for crash 3, and that cancelling Checkout does not resume the run.
8. Only after test-mode verification, add Live Mode keys as Supabase secrets and retest with a small real payment.

## API contract

### POST `/start-run`
Creates an opaque server-side run and returns `{ runId }`.

### POST `/create-order`
Body: `{ runId }`.

The server increments the crash count exactly once, computes `900 * crashNumber` paise and creates/reuses the pending Razorpay order. The client-supplied amount is never accepted.

### POST `/verify-payment`
Body contains `runId`, `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`.

The server verifies the signature and Razorpay payment details before returning `{ verified: true }`.

## Before production

Add webhook reconciliation for `payment.captured` and payment failures so delayed gateway events can repair state automatically. Also add rate limiting/abuse protection to the anonymous start-run and create-order endpoints before meaningful traffic is expected.
