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

test("checkout requires adult consent and legal links", async () => {
  const html = await read("index.html");
  const source = await read("script.js");
  assert.match(html, /id="adultConfirmation"/);
  assert.match(source, /adultConfirmed:\s*true/);
  for (const page of ["terms.html", "privacy.html", "refund.html", "parents.html", "contact.html"]) {
    await stat(new URL(`../${page}`, import.meta.url));
    assert.match(html, new RegExp(page.replace(".", "\\.")));
  }
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
  const schema = await read("supabase/payment-schema.sql");
  for (const table of ["racing_payment_runs", "racing_payments", "racing_entitlements", "racing_rate_limits"]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(schema, /revoke all .* from public, anon, authenticated/i);
  assert.match(schema, /security invoker/);
  assert.doesNotMatch(schema, /security definer/i);
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
  const files = ["script.js", "payment-config.js", "README.md", "RAZORPAY_LIVE_SETUP.md", "supabase/functions/racing-payments/index.ts"];
  for (const file of files) {
    const content = await read(file);
    assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
    assert.doesNotMatch(content, /(?:RAZORPAY_KEY_SECRET|SUPABASE_SERVICE_ROLE_KEY)\s*=\s*["'][^"']{8,}["']/);
  }
});
