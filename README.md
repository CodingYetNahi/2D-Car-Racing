# 2D-Car-Racing

Lightweight static HTML/CSS/JavaScript racing game deployed with GitHub Pages.

## Razorpay integration

The game is prepared for a secure Razorpay integration boundary, but payment processing is **not implemented in the static frontend**.

GitHub Pages must never contain a Razorpay key secret or webhook secret and must never be trusted to verify a payment. Order creation, signature verification, webhook validation and paid-entitlement state require a server/serverless backend.

See [RAZORPAY_SECURITY.md](./RAZORPAY_SECURITY.md) before adding Checkout.
