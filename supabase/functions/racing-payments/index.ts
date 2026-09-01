import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = new Set(["https://racinggame.fun", "https://www.racinggame.fun", "https://codingyetnahi.github.io"]);
const TERMS_VERSION = "2026-09-01";
const MAX_BODY_BYTES = 16_384;
const PASS_PRODUCTS = {
  day: { code: "day", name: "1 Day Pass", amountPaise: 2900, durationHours: 24 },
  week: { code: "week", name: "1 Week Pass", amountPaise: 9900, durationHours: 168 }
} as const;
type ProductCode = keyof typeof PASS_PRODUCTS;

function corsHeaders(origin: string | null) {
  const allowedOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://racinggame.fun";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "Content-Type": "application/json"
  };
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isProductCode(value: unknown): value is ProductCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PASS_PRODUCTS, value);
}

function isConfiguredEmail(value: string | undefined) {
  return Boolean(value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function basicAuth(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function razorpayRequest(path: string, init: RequestInit, keyId: string, keySecret: string) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: { "Authorization": basicAuth(keyId, keySecret), "Content-Type": "application/json", ...(init.headers || {}) }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Razorpay API error (${response.status})`);
  return body;
}

async function hmacHex(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function bearerToken(req: Request) {
  return /^Bearer ([A-Za-z0-9_-]{40,80})$/.exec(req.headers.get("authorization") || "")?.[1] || "";
}

function parseJsonBody(rawBody: string) {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
  if (!rawBody) return {};
  const parsed = JSON.parse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
  return parsed as Record<string, unknown>;
}

function publicEntitlement(row: Record<string, unknown>, key: "active" | "authorized") {
  return {
    [key]: true,
    productCode: row.product_code,
    productName: isProductCode(row.product_code) ? PASS_PRODUCTS[row.product_code].name : "Access Pass",
    expiresAt: row.expires_at
  };
}

export default {
  async fetch(req: Request) {
    const origin = req.headers.get("origin");
    const action = new URL(req.url).pathname.split("/").filter(Boolean).at(-1) || "";

    if (req.method === "OPTIONS") {
      if (!origin || !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (action !== "webhook" && (!origin || !ALLOWED_ORIGINS.has(origin))) return json({ error: "Origin not allowed" }, 403, origin);
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "Request is too large" }, 413, origin);

    const rawBody = await req.text();
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
    const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    const paymentsEnabled = Deno.env.get("PAYMENTS_ENABLED") === "true";
    const merchantLegalName = Deno.env.get("MERCHANT_LEGAL_NAME");
    const supportEmail = Deno.env.get("SUPPORT_EMAIL");

    if (!supabaseUrl || !serviceRoleKey || !rateLimitSecret) return json({ error: "Payment service is not configured" }, 503, origin);
    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

    try {
      if (action === "webhook") {
        if (!webhookSecret) return json({ error: "Webhook is not configured" }, 503, origin);
        const expectedSignature = await hmacHex(rawBody, webhookSecret);
        if (!safeEqual(expectedSignature, req.headers.get("x-razorpay-signature") || "")) return json({ error: "Invalid webhook signature" }, 401, origin);
        const event = parseJsonBody(rawBody);
        const eventName = String(event.event || "");
        const payload = event.payload as Record<string, Record<string, Record<string, unknown>>> | undefined;
        const paymentEntity = payload?.payment?.entity;
        const refundEntity = payload?.refund?.entity;
        const paymentId = String(paymentEntity?.id || refundEntity?.payment_id || "");
        const orderId = String(paymentEntity?.order_id || "");

        if (eventName === "payment.captured" && paymentId && orderId) {
          const { error } = await db.from("racing_payments").update({ status: "captured", payment_id: paymentId }).eq("order_id", orderId).in("status", ["pending", "captured"]);
          if (error) throw new Error("Unable to reconcile captured payment");
        } else if (eventName === "payment.failed" && orderId) {
          const { error } = await db.from("racing_payments").update({ status: "failed", payment_id: paymentId || null }).eq("order_id", orderId).eq("status", "pending");
          if (error) throw new Error("Unable to reconcile failed payment");
        } else if ((eventName === "refund.processed" || eventName === "payment.refunded") && paymentId) {
          const { data: payment, error } = await db.from("racing_payments").update({ status: "refunded" }).eq("payment_id", paymentId).select("entitlement_id").maybeSingle();
          if (error) throw new Error("Unable to reconcile refund");
          if (payment?.entitlement_id) {
            const { error: revokeError } = await db.from("racing_entitlements").update({ status: "refunded", updated_at: new Date().toISOString() }).eq("id", payment.entitlement_id);
            if (revokeError) throw new Error("Unable to revoke refunded pass");
          }
        }
        return json({ received: true }, 200, origin);
      }

      const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const userAgent = (req.headers.get("user-agent") || "unknown").slice(0, 160);
      const clientKey = await hmacHex(`${forwardedFor}|${userAgent}`, rateLimitSecret);
      const limits: Record<string, number> = { "start-run": 20, "create-order": 5, "verify-payment": 10, "check-pass": 30, "authorize-continue": 30 };
      const bucketMs = Math.floor(Date.now() / 60_000) * 60_000;
      const { data: allowed, error: limitError } = await db.rpc("consume_racing_rate_limit", {
        p_client_key: clientKey,
        p_action: action.slice(0, 40),
        p_bucket: new Date(bucketMs).toISOString(),
        p_max_requests: limits[action] || 20
      });
      if (limitError) throw new Error("Rate limiter unavailable");
      if (!allowed) return json({ error: "Too many requests. Try again shortly." }, 429, origin);

      const body = parseJsonBody(rawBody);
      if (action === "start-run") {
        const { data, error } = await db.from("racing_payment_runs").insert({ state: "playing" }).select("id").single();
        if (error || !data) throw new Error("Unable to create run");
        return json({ runId: data.id }, 200, origin);
      }

      if (action === "check-pass" || action === "authorize-continue") {
        if (action === "authorize-continue" && !isUuid(body.runId)) return json({ error: "Invalid run" }, 400, origin);
        const token = bearerToken(req);
        if (!token) return json({ error: "Pass token required" }, 401, origin);
        const tokenHash = await sha256Hex(token);
        const entitlementResult = action === "authorize-continue"
          ? await db.rpc("consume_racing_entitlement", { p_token_hash: tokenHash }).maybeSingle()
          : await db.from("racing_entitlements").select("id, product_code, expires_at, status")
            .eq("token_hash", tokenHash).eq("status", "active").gt("expires_at", new Date().toISOString()).maybeSingle();
        const entitlement = entitlementResult.data;
        if (!entitlement) return json({ active: false, authorized: false }, 401, origin);
        if (action === "authorize-continue") {
          return json(publicEntitlement(entitlement, "authorized"), 200, origin);
        }
        return json(publicEntitlement(entitlement, "active"), 200, origin);
      }

      if (!paymentsEnabled || !merchantLegalName || merchantLegalName.trim().length < 3 || !isConfiguredEmail(supportEmail) || !razorpayKeyId || !razorpayKeySecret) return json({ error: "Payments are not available yet" }, 503, origin);

      if (action === "create-order") {
        if (!isUuid(body.runId) || !isProductCode(body.productCode)) return json({ error: "Invalid pass request" }, 400, origin);
        if (body.adultConfirmed !== true || body.termsVersion !== TERMS_VERSION) return json({ error: "Adult confirmation and current terms are required" }, 400, origin);
        const product = PASS_PRODUCTS[body.productCode];
        const { data: run } = await db.from("racing_payment_runs").select("id, state, pending_order_id, pending_amount_paise, pending_product_code").eq("id", body.runId).maybeSingle();
        if (!run) return json({ error: "Run not found" }, 404, origin);
        if (run.state === "closed") return json({ error: "Run is closed" }, 409, origin);
        if (run.state === "awaiting_payment" && run.pending_order_id) {
          if (run.pending_product_code !== product.code) return json({ error: "Another pass order is already pending" }, 409, origin);
          return json({ keyId: razorpayKeyId, orderId: run.pending_order_id, amountPaise: run.pending_amount_paise, currency: "INR", productCode: product.code }, 200, origin);
        }
        if (run.state !== "playing") return json({ error: "Payment is already being prepared" }, 409, origin);
        const now = new Date().toISOString();
        const { data: locked } = await db.from("racing_payment_runs")
          .update({ state: "ordering", pending_product_code: product.code, terms_version: TERMS_VERSION, adult_confirmed_at: now, updated_at: now })
          .eq("id", body.runId).eq("state", "playing").select("id").maybeSingle();
        if (!locked) return json({ error: "Payment is already being prepared" }, 409, origin);

        let order;
        try {
          order = await razorpayRequest("/orders", {
            method: "POST",
            body: JSON.stringify({
              amount: product.amountPaise,
              currency: "INR",
              receipt: `race_${body.runId.slice(0, 8)}_${product.code}_${Date.now().toString(36)}`.slice(0, 40),
              notes: { run_id: body.runId, product_code: product.code, terms_version: TERMS_VERSION, adult_confirmed: "true" }
            })
          }, razorpayKeyId, razorpayKeySecret);
          const { error } = await db.rpc("record_racing_order", {
            p_run_id: body.runId, p_order_id: order.id, p_product_code: product.code,
            p_amount_paise: product.amountPaise, p_terms_version: TERMS_VERSION
          });
          if (error) throw new Error("Unable to record order");
        } catch (error) {
          await db.from("racing_payment_runs").update({ state: "playing", pending_product_code: null }).eq("id", body.runId).eq("state", "ordering");
          throw error;
        }
        return json({ keyId: razorpayKeyId, orderId: order.id, amountPaise: product.amountPaise, currency: "INR", productCode: product.code }, 200, origin);
      }

      if (action === "verify-payment") {
        const { runId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;
        if (!isUuid(runId) || ![razorpay_payment_id, razorpay_order_id, razorpay_signature].every((value) => typeof value === "string" && value.length > 0 && value.length < 256)) return json({ error: "Invalid verification request" }, 400, origin);
        const { data: purchase } = await db.from("racing_payments")
          .select("id, run_id, order_id, payment_id, amount_paise, currency, product_code, status, entitlement_id")
          .eq("order_id", razorpay_order_id).eq("run_id", runId).maybeSingle();
        if (!purchase || !isProductCode(purchase.product_code)) return json({ error: "Order not found" }, 404, origin);

        const accessToken = randomToken();
        const tokenHash = await sha256Hex(accessToken);
        if (purchase.status === "paid" && purchase.payment_id === razorpay_payment_id && purchase.entitlement_id) {
          const { data: entitlement, error } = await db.rpc("rotate_racing_entitlement_token", { p_entitlement_id: purchase.entitlement_id, p_token_hash: tokenHash }).single();
          if (error || !entitlement) throw new Error("Unable to recover pass");
          return json({ verified: true, accessToken, active: true, productCode: entitlement.product_code, productName: isProductCode(entitlement.product_code) ? PASS_PRODUCTS[entitlement.product_code].name : "Access Pass", expiresAt: entitlement.expires_at }, 200, origin);
        }

        const expectedSignature = await hmacHex(`${razorpay_order_id}|${razorpay_payment_id}`, razorpayKeySecret);
        if (!safeEqual(expectedSignature, razorpay_signature)) return json({ error: "Payment signature verification failed" }, 400, origin);
        const payment = await razorpayRequest(`/payments/${encodeURIComponent(razorpay_payment_id)}`, { method: "GET" }, razorpayKeyId, razorpayKeySecret);
        if (payment.order_id !== purchase.order_id || payment.amount !== purchase.amount_paise || payment.currency !== "INR") return json({ error: "Payment details do not match the order" }, 409, origin);
        if (payment.status !== "captured") return json({ error: "Payment is not captured yet" }, 409, origin);

        const expiresAt = new Date(Date.now() + PASS_PRODUCTS[purchase.product_code].durationHours * 60 * 60 * 1000).toISOString();
        const { data: entitlementId, error } = await db.rpc("complete_racing_payment", {
          p_run_id: runId, p_order_id: razorpay_order_id, p_payment_id: razorpay_payment_id,
          p_token_hash: tokenHash, p_expires_at: expiresAt
        });
        if (error || !entitlementId) throw new Error("Unable to grant pass");
        const { data: entitlement } = await db.from("racing_entitlements").select("product_code, expires_at").eq("id", entitlementId).single();
        if (!entitlement || !isProductCode(entitlement.product_code)) throw new Error("Unable to read granted pass");
        return json({ verified: true, accessToken, active: true, productCode: entitlement.product_code, productName: PASS_PRODUCTS[entitlement.product_code].name, expiresAt: entitlement.expires_at }, 200, origin);
      }

      return json({ error: "Unknown action" }, 404, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      if (message === "REQUEST_TOO_LARGE") return json({ error: "Request is too large" }, 413, origin);
      if (message === "INVALID_JSON" || error instanceof SyntaxError) return json({ error: "Invalid JSON request" }, 400, origin);
      console.error("racing-payments error", message);
      return json({ error: "Payment service error" }, 500, origin);
    }
  }
};
