# 2D-Car-Racing

Lightweight static HTML/CSS/JavaScript racing game deployed with GitHub Pages.

## Fixed access passes

Payment processing is **disabled**. The prepared model uses a fixed ₹29 one-day pass and ₹99 one-week pass. Both are non-renewing access fees with no wager, prize, cash-out or redeemable value. Players can always restart free.

GitHub Pages must never contain a Razorpay key secret or webhook secret and must never be trusted to verify a payment. Order creation, signature verification, webhook validation and paid-entitlement state require a server/serverless backend.

The backend refuses orders until live payments, merchant identity and support settings are explicitly configured. See [SECURITY_REMEDIATION.md](./SECURITY_REMEDIATION.md), [RAZORPAY_SECURITY.md](./RAZORPAY_SECURITY.md), [RAZORPAY_LIVE_SETUP.md](./RAZORPAY_LIVE_SETUP.md) and [LEGAL_READINESS.md](./LEGAL_READINESS.md) before enabling Checkout.
