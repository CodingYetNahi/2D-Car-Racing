# 2D-Car-Racing

Lightweight static HTML/CSS/JavaScript racing game deployed with GitHub Pages.

## Verified online runs

The game now has an optional Supabase-backed official-score path. A server issues a signed run seed, the browser records directional inputs, and the Edge Function independently replays the deterministic simulation before accepting a single score. Editing browser JavaScript can still alter local play, but it cannot directly write an official score or make the verifier accept an impossible result.

Local play remains available if verification is unavailable. Paid continuation scores are submitted from an immutable crash snapshot, so completing Checkout cannot invalidate a score while server verification is in flight. See [VERIFIED_RUN_SETUP.md](./VERIFIED_RUN_SETUP.md).

## Optional Spotify music

The game supports the configured public playlist through Spotify's official Embed API. The player is created only after the user opens Music, playback still requires the user's action, and the engine sound and game continue normally if Spotify is blocked. No Spotify login, secret, access token, or Web Playback SDK is used.

## Fixed access passes

Payment processing is connected to the deployed backend. Checkout availability remains controlled server-side with `PAYMENTS_ENABLED`; use Razorpay test mode until the production-readiness checklist is complete. The model uses a fixed ₹29 one-day pass and ₹99 one-week pass. Both are non-renewing access fees with no wager, prize, cash-out or redeemable value. Players can always restart free. An active pass also unlocks cosmetic cars only for that pass's duration.

GitHub Pages must never contain a Razorpay key secret or webhook secret and must never be trusted to verify a payment. Order creation, signature verification, webhook validation and paid-entitlement state require a server/serverless backend.

The backend refuses orders until live payments, merchant identity and support settings are explicitly configured. See [SECURITY_REMEDIATION.md](./SECURITY_REMEDIATION.md), [RAZORPAY_SECURITY.md](./RAZORPAY_SECURITY.md), [RAZORPAY_LIVE_SETUP.md](./RAZORPAY_LIVE_SETUP.md) and [LEGAL_READINESS.md](./LEGAL_READINESS.md) before enabling Checkout.

## Search setup after deployment

The site includes a canonical URL, crawl directives, a sitemap, game structured data, social metadata, a web manifest and a custom-domain file. Repository changes alone cannot guarantee a search rank.

After deploying to `https://racinggame.fun/`:

1. Verify the domain property in Google Search Console.
2. Submit `https://racinggame.fun/sitemap.xml` and request indexing for the home page.
3. Add the same sitemap in Bing Webmaster Tools.
4. Confirm that the HTTPS home page returns `200`, while every HTTP, `www` and GitHub Pages variant redirects to the canonical URL.
5. Build genuine links and useful game content; do not buy links or stuff repeated keywords.
6. Check Core Web Vitals and search queries monthly, then improve pages from real data.
