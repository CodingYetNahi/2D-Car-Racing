# Production security checklist

Source control contains no production secret values. Complete and periodically re-check every item below outside this repository.

- [ ] Apply both SQL migrations to a dedicated Supabase project, inspect Security/Performance Advisor output, and confirm `anon` and `authenticated` cannot access internal tables or RPCs.
- [ ] Store `SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RATE_LIMIT_SECRET`, and `VERIFIED_RUN_SIGNING_SECRET` only in Supabase secrets. Generate the two application secrets independently with at least 32 random bytes and rotate on exposure.
- [ ] Keep Razorpay Test and Live projects/keys separate. Validate in Test Mode before switching keys; never mix a Test order with Live verification.
- [ ] Configure the exact Razorpay webhook URL and an independent webhook secret. Subscribe to `payment.captured`, `payment.failed`, `refund.processed`, and `payment.refunded`; monitor repeated delivery failures.
- [ ] Set and verify `PAYMENTS_ENABLED`, `MERCHANT_LEGAL_NAME`, and `SUPPORT_EMAIL`. Keep payments disabled until legal, merchant, support, refund, and test gates are complete.
- [ ] Review the exact production CORS origin allowlists in both Edge Functions before changing domains. Do not add wildcard origins.
- [ ] Deploy Edge Functions without exposing service-role credentials to browser bundles, logs, error messages, or GitHub Actions.
- [ ] Schedule `cleanup_racing_payment_operational_data()` and `cleanup_racing_verification_operational_data()` daily with Supabase Cron and alert on failure. Set an approved retention schedule for payment/audit records separately.
- [ ] Configure database backups and test point-in-time recovery/restoration. Restrict backup access and document recovery ownership.
- [ ] Configure Supabase/CDN/WAF request-size limits, bot/abuse controls, rate limits, and spend alerts upstream. Application buckets are defense in depth, not DDoS protection; ensure the proxy overwrites client-IP headers.
- [ ] Review Edge Function, database, Razorpay, refund, authentication, and rate-limit logs without logging bearer tokens/signatures. Alert on error spikes and unusual order/run volume.
- [ ] Run `npm test`, dependency review, secret scanning, and pinned-Action review for every release. Apply security updates promptly and verify immutable Action SHAs.
- [ ] Account for GitHub Pages limitations: it cannot set arbitrary response headers. The CSP/referrer meta policies are useful fallbacks but do not replace HTTP headers such as HSTS, `frame-ancestors`, or `X-Content-Type-Options`; use a controlled CDN if those are required.
- [ ] Document anonymous-token support: raw entitlement tokens are never stored server-side, Checkout replay cannot recover one, and loss requires the approved support/refund path until authenticated recovery exists.
