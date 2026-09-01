import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { PASS_PRODUCTS, TERMS_VERSION, getPassProduct } from "../payment-policy.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("fixed passes use the approved server prices and durations", () => {
  assert.deepEqual(PASS_PRODUCTS.day, { code: "day", name: "1 Day Pass", amountPaise: 2900, durationHours: 24 });
  assert.deepEqual(PASS_PRODUCTS.week, { code: "week", name: "1 Week Pass", amountPaise: 9900, durationHours: 168 });
  assert.equal(getPassProduct("admin"), null);
  assert.match(TERMS_VERSION, /^20\d{2}-\d{2}-\d{2}$/);
});

test("legacy escalating crash pricing is removed", async () => {
  const source = await read("script.js");
  const html = await read("index.html");
  assert.doesNotMatch(source, /BASE_CONTINUE_PRICE|amountPaise\s*\*\s*crash/i);
  assert.doesNotMatch(html, /price increases|Pay ₹9/i);
});

test("checkout asks for adult confirmation only after pass selection", async () => {
  const html = await read("index.html");
  const source = await read("script.js");
  assert.match(html, /id="continueToPaymentButton"/);
  assert.match(html, /id="ageDialog"/);
  assert.match(html, /Are you 18 or older\?/);
  assert.match(source, /continueToPaymentButton\?\.addEventListener\("click", askForAdultConfirmation\)/);
  assert.match(source, /confirmAdultButton\?\.addEventListener/);
  assert.doesNotMatch(html, /id="adultConfirmation"/);
  assert.match(source, /adultConfirmed:\s*true/);
  for (const page of ["terms.html", "privacy.html", "refund.html", "parents.html", "contact.html"]) {
    await stat(new URL(`../${page}`, import.meta.url));
    assert.match(html, new RegExp(page.replace(".", "\\.")));
  }
});

test("game fills the first viewport while help and legal links stay below", async () => {
  const html = await read("index.html");
  const css = await read("style.css");
  const paymentCss = await read("payment.css");
  const source = await read("script.js");
  assert.match(css, /\.game-shell[\s\S]*height:\s*100dvh/);
  assert.match(css, /\.game-shell[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  assert.match(css, /body\.game-page[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /\.game-over[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.game-stage[\s\S]*aspect-ratio:\s*2\s*\/\s*3/);
  assert.match(css, /#gameCanvas[\s\S]*height:\s*100%/);
  assert.match(css, /\.game-stage[\s\S]*height:\s*min\(100%, 52rem/);
  assert.match(html, /<\/main>[\s\S]*class="below-game"[\s\S]*class="site-footer"/);
  assert.match(paymentCss, /\.age-dialog::backdrop/);
  assert.match(source, /opposing traffic travels down/);
});

test("SEO has canonical metadata, crawl controls and structured game data", async () => {
  const html = await read("index.html");
  const robots = await read("robots.txt");
  const sitemap = await read("sitemap.xml");
  const customDomain = await read("CNAME");
  const manifest = JSON.parse(await read("site.webmanifest"));
  assert.match(html, /<link rel="canonical" href="https:\/\/racinggame\.fun\/">/);
  assert.match(html, /<meta property="og:title"/);
  assert.match(html, /<script type="application\/ld\+json">/);
  assert.match(html, /"@type": "VideoGame"/);
  assert.match(robots, /Sitemap: https:\/\/racinggame\.fun\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/racinggame\.fun\/<\/loc>/);
  assert.equal(customDomain.trim(), "racinggame.fun");
  assert.equal(manifest.start_url, "/");
});

test("all local page assets and links resolve", async () => {
  for (const page of ["index.html", "terms.html", "privacy.html", "refund.html", "parents.html", "contact.html"]) {
    const html = await read(page);
    for (const match of html.matchAll(/(?:href|src)="\.\/([^"?#]+)"/g)) {
      await stat(new URL(`../${match[1]}`, import.meta.url));
    }
  }
});

test("payment service stays fail-closed and verifies server facts", async () => {
  const backend = await read("supabase/functions/racing-payments/index.ts");
  assert.match(backend, new RegExp(`const TERMS_VERSION = "${TERMS_VERSION}"`));
  assert.match(backend, new RegExp(`amountPaise: ${PASS_PRODUCTS.day.amountPaise}`));
  assert.match(backend, new RegExp(`amountPaise: ${PASS_PRODUCTS.week.amountPaise}`));
  assert.match(backend, /PAYMENTS_ENABLED/);
  assert.match(backend, /MERCHANT_LEGAL_NAME/);
  assert.match(backend, /SUPPORT_EMAIL/);
  assert.match(backend, /payment\.amount !== purchase\.amount_paise/);
  assert.match(backend, /payment\.status !== "captured"/);
  assert.match(backend, /x-razorpay-signature/);
  assert.match(backend, /consume_racing_rate_limit/);
});

test("database objects deny browser roles and use RLS", async () => {
  const schemas = [await read("supabase/payment-schema.sql"), await read("supabase/verified-schema.sql")];
  for (const [schema, tables] of [
    [schemas[0], ["racing_payment_runs", "racing_payments", "racing_entitlements", "racing_rate_limits"]],
    [schemas[1], ["racing_verified_players", "racing_verified_runs", "racing_verified_scores", "racing_verification_rate_limits"]]
  ]) {
    for (const table of tables) {
      assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    }
    assert.match(schema, /revoke all .* from public, anon, authenticated/i);
    assert.match(schema, /security invoker/);
    assert.doesNotMatch(schema, /security definer/i);
  }
});

test("official scores use signed, single-use, server-replayed runs", async () => {
  const backend = await read("supabase/functions/verified-runs/index.ts");
  const frontend = await read("script.js");
  const engine = await read("supabase/functions/_shared/racing-engine.js");
  assert.match(backend, /hmacHex/);
  assert.match(backend, /safeEqual/);
  assert.match(backend, /replayGame/);
  assert.match(backend, /complete_racing_verified_run/);
  assert.match(backend, /consume_racing_verification_rate_limit/);
  assert.match(frontend, /events:\s*replayEvents/);
  assert.match(frontend, /result\.score !== gameState\.score/);
  assert.doesNotMatch(engine, /Math\.random/);
});

test("frontend keeps strong browser controls and avoids common code sinks", async () => {
  const html = await read("index.html");
  const source = await read("script.js");
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|document\.write|\beval\s*\(|new Function/);
});

test("production payment endpoint remains blank", async () => {
  const config = await read("payment-config.js");
  assert.match(config, /window\.RACING_PAYMENT_API_BASE\s*=\s*""/);
});

test("repository does not contain obvious private-key or live-secret assignments", async () => {
  const files = ["script.js", "payment-config.js", "game-config.js", "README.md", "RAZORPAY_LIVE_SETUP.md", "supabase/functions/racing-payments/index.ts", "supabase/functions/verified-runs/index.ts"];
  for (const file of files) {
    const content = await read(file);
    assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    assert.doesNotMatch(content, /(?:RAZORPAY_KEY_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["'][^"']{8,}["']/);
  }
});
