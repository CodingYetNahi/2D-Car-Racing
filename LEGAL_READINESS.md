# Legal launch gates

This repository implements technical safeguards, not a legal opinion. Payments remain disabled until Indian gaming, privacy and consumer counsel, the payment provider and a chartered accountant approve the final launch.

## Current policy

- Minors may use the free, age-appropriate game only with parent or guardian permission.
- A person under 18 must not purchase directly.
- An adult parent or guardian may buy a pass in the adult's own name and with an authorised adult-controlled payment method.
- The paid products are fixed, non-renewing time passes. They are not wagers and provide no prize, cash-out, transferable or redeemable value.

## Required before `PAYMENTS_ENABLED=true`

- [ ] Written gaming-law classification advice and any required Online Gaming Authority step
- [ ] Written Razorpay approval for this exact model
- [ ] Verified operator legal name, address, private support email and grievance contact published
- [ ] Terms, Privacy, Refund and Parent pages reviewed by counsel
- [ ] Adult-only purchase flow tested
- [ ] No child behavioural tracking or targeted advertising
- [ ] CA memo on GST, registration, invoices, records and displayed tax treatment
- [ ] India-only payment scope unless other markets are cleared
- [ ] Security audit Critical/High release gates closed and retested
- [ ] Test-mode duplicate, failed, delayed, refunded and paid-but-not-unlocked cases pass

The public legal pages state that payments are disabled and operator details remain pending. The Edge Function also requires `MERCHANT_LEGAL_NAME`, `SUPPORT_EMAIL` and `PAYMENTS_ENABLED=true` before order creation.
