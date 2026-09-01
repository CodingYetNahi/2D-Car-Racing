# Verified run deployment

This phase protects official scores without making free local gameplay depend on a backend. It does not enable payments, prizes, real-money competition or cloud accounts.

## Current deployment

- Supabase project: `vwmxyogkrfhzxjoegjot` (`ap-south-1`)
- Edge Function: `https://vwmxyogkrfhzxjoegjot.supabase.co/functions/v1/verified-runs`
- Browser configuration: enabled in `game-config.js`
- Live verification: signed run creation, server replay, duplicate rejection (`409`), origin rejection (`403`) and leaderboard retrieval passed on 2026-09-01
- Test data: removed after verification; production tables started empty

## Security model

1. `start-run` creates a pseudonymous player when needed, a random seed, a 20-minute expiry and an HMAC ticket.
2. The browser runs the shared deterministic engine and records only direction changes.
3. `submit-run` binds the token, ticket and run, validates limits, and replays every tick on the server.
4. One atomic database function changes the run from `issued` to `verified` and inserts its score once.
5. The browser can read the leaderboard only through the Edge Function. Browser database roles have no table or RPC access.

The player token is an opaque identifier, not an authentication credential for sensitive personal data. It is held in browser storage so an XSS flaw could steal it; CSP and sink regression tests reduce that risk. Add Supabase Auth before cloud saves or user-owned purchases.

## Deploy

Use the dedicated Supabase project, not a database shared with another application.

1. Apply `supabase/verified-schema.sql`.
2. Deploy `supabase/functions/verified-runs/index.ts` with JWT verification disabled because this function validates its own opaque bearer token. Do not expose the service-role key.
3. Prefer setting independent random secrets of at least 32 bytes as `VERIFIED_RUN_SIGNING_SECRET` and `RATE_LIMIT_SECRET`. If absent, the function derives domain-separated keys from the backend-only service-role key; rotating that key then invalidates outstanding tickets.
4. Set `window.RACING_VERIFICATION_API_BASE` in `game-config.js` to `https://PROJECT_REF.supabase.co/functions/v1/verified-runs`.
5. Keep `window.RACING_PAYMENT_API_BASE` blank. Payment launch has separate legal and security gates.

## Verification checklist

- Submit the same run twice: the second request must return `409`.
- Change one input event or the ending tick: impossible or unfinished runs must be rejected.
- Use another player's token: the run must not be found for that player.
- Submit an invalid ticket: the request must return `403`.
- Call from an unapproved browser origin: the request must return `403`.
- Confirm anon/authenticated roles cannot select or mutate any `racing_verified_*` table.
- Confirm the leaderboard contains only rows produced by completed verified runs.
- Run `npm test`, then check Supabase security and performance advisors.

## Residual abuse risk

Replay validation proves a score is reachable under the published rules; it does not prove a human played. Bots can calculate inputs, users can discard weak seeds, and local gameplay remains modifiable. Before prizes or official competitions, add authenticated accounts, eligibility rules, seed-issuance quotas, anomaly detection, audit retention and documented dispute handling.
