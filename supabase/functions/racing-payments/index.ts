import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGIN = "https://codingyetnahi.github.io";
const BASE_PRICE_PAISE = 900;
const MAX_CRASH_NUMBER = 100;

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : ALLOWED_ORIGIN,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function basicAuth(keyId: string, keySecret: string) {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

async function razorpayRequest(path: string, init: RequestInit, keyId: string, keySecret: string) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      "Authorization": basicAuth(keyId, keySecret),
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Razorpay API error (${response.status})`);
  return body;
}

async function hmacHex(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req: Request) {
    const origin = req.headers.get("origin");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
    if (origin && origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed" }, 403, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const razorpayKeyId = Deno.env.get("RAZORPAY_KEY_ID");
    const razorpayKeySecret = Deno.env.get("RAZORPAY_KEY_SECRET");

    if (!supabaseUrl || !serviceRoleKey || !razorpayKeyId || !razorpayKeySecret) {
      return json({ error: "Payment service is not configured" }, 503, origin);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const url = new URL(req.url);
    const action = url.pathname.split("/").filter(Boolean).at(-1);
    const body = await req.json().catch(() => ({}));

    try {
      if (action === "start-run") {
        const { data, error } = await db
          .from("racing_payment_runs")
          .insert({ state: "playing", crash_number: 0 })
          .select("id")
          .single();
        if (error || !data) throw new Error("Unable to create run");
        return json({ runId: data.id }, 200, origin);
      }

      if (action === "create-order") {
        if (!isUuid(body.runId)) return json({ error: "Invalid run" }, 400, origin);

        const { data: run, error: runError } = await db
          .from("racing_payment_runs")
          .select("id, crash_number, state, pending_order_id, pending_amount_paise")
          .eq("id", body.runId)
          .single();
        if (runError || !run) return json({ error: "Run not found" }, 404, origin);
        if (run.state === "closed") return json({ error: "Run is closed" }, 409, origin);

        if (run.state === "awaiting_payment" && run.pending_order_id && run.pending_amount_paise) {
          return json({
            keyId: razorpayKeyId,
            orderId: run.pending_order_id,
            amountPaise: run.pending_amount_paise,
            currency: "INR",
            crashNumber: run.crash_number
          }, 200, origin);
        }

        if (run.state !== "playing") return json({ error: "Payment is already being prepared" }, 409, origin);

        const crashNumber = run.crash_number + 1;
        if (crashNumber > MAX_CRASH_NUMBER) return json({ error: "Crash limit reached" }, 409, origin);
        const amountPaise = BASE_PRICE_PAISE * crashNumber;

        const { data: locked } = await db
          .from("racing_payment_runs")
          .update({ state: "ordering", updated_at: new Date().toISOString() })
          .eq("id", body.runId)
          .eq("state", "playing")
          .select("id")
          .maybeSingle();
        if (!locked) return json({ error: "Payment is already being prepared" }, 409, origin);

        let order;
        try {
          order = await razorpayRequest("/orders", {
            method: "POST",
            body: JSON.stringify({
              amount: amountPaise,
              currency: "INR",
              receipt: `race_${body.runId.slice(0, 8)}_${crashNumber}`,
              notes: { run_id: body.runId, crash_number: String(crashNumber) }
            })
          }, razorpayKeyId, razorpayKeySecret);
        } catch (error) {
          await db.from("racing_payment_runs").update({ state: "playing" }).eq("id", body.runId).eq("state", "ordering");
          throw error;
        }

        const { error: paymentError } = await db.from("racing_payments").insert({
          run_id: body.runId,
          crash_number: crashNumber,
          order_id: order.id,
          amount_paise: amountPaise,
          currency: "INR",
          status: "pending"
        });
        if (paymentError) throw new Error("Unable to record order");

        const { error: updateError } = await db
          .from("racing_payment_runs")
          .update({
            crash_number: crashNumber,
            state: "awaiting_payment",
            pending_order_id: order.id,
            pending_amount_paise: amountPaise,
            updated_at: new Date().toISOString()
          })
          .eq("id", body.runId)
          .eq("state", "ordering");
        if (updateError) throw new Error("Unable to update run");

        return json({
          keyId: razorpayKeyId,
          orderId: order.id,
          amountPaise,
          currency: "INR",
          crashNumber
        }, 200, origin);
      }

      if (action === "verify-payment") {
        const { runId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = body;
        if (!isUuid(runId) || ![razorpay_payment_id, razorpay_order_id, razorpay_signature].every((v) => typeof v === "string" && v.length > 0)) {
          return json({ error: "Invalid verification request" }, 400, origin);
        }

        const { data: run, error: runError } = await db
          .from("racing_payment_runs")
          .select("id, crash_number, state, pending_order_id, pending_amount_paise")
          .eq("id", runId)
          .single();
        if (runError || !run) return json({ error: "Run not found" }, 404, origin);
        if (run.pending_order_id !== razorpay_order_id || !run.pending_amount_paise) {
          return json({ error: "Order does not belong to this run" }, 409, origin);
        }

        const { data: existing } = await db
          .from("racing_payments")
          .select("status, payment_id")
          .eq("order_id", razorpay_order_id)
          .maybeSingle();
        if (existing?.status === "paid" && existing.payment_id === razorpay_payment_id) {
          return json({ verified: true, crashNumber: run.crash_number }, 200, origin);
        }

        const expectedSignature = await hmacHex(`${run.pending_order_id}|${razorpay_payment_id}`, razorpayKeySecret);
        if (!safeEqual(expectedSignature, razorpay_signature)) {
          return json({ error: "Payment signature verification failed" }, 400, origin);
        }

        const payment = await razorpayRequest(`/payments/${encodeURIComponent(razorpay_payment_id)}`, { method: "GET" }, razorpayKeyId, razorpayKeySecret);
        if (payment.order_id !== run.pending_order_id || payment.amount !== run.pending_amount_paise || payment.currency !== "INR") {
          return json({ error: "Payment details do not match the order" }, 409, origin);
        }
        if (payment.status !== "captured") {
          return json({ error: "Payment is not captured yet" }, 409, origin);
        }

        const paidAt = new Date().toISOString();
        const { error: paymentUpdateError } = await db
          .from("racing_payments")
          .update({ status: "paid", payment_id: razorpay_payment_id, paid_at: paidAt })
          .eq("order_id", run.pending_order_id)
          .eq("status", "pending");
        if (paymentUpdateError) throw new Error("Unable to record payment");

        const { error: runUpdateError } = await db
          .from("racing_payment_runs")
          .update({
            state: "playing",
            pending_order_id: null,
            pending_amount_paise: null,
            updated_at: paidAt
          })
          .eq("id", runId)
          .eq("state", "awaiting_payment");
        if (runUpdateError) throw new Error("Unable to unlock run");

        return json({ verified: true, crashNumber: run.crash_number }, 200, origin);
      }

      return json({ error: "Unknown action" }, 404, origin);
    } catch (error) {
      console.error("racing-payments error", error);
      return json({ error: "Payment service error" }, 500, origin);
    }
  }
};
