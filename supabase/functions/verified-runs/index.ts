import { createClient } from "@supabase/supabase-js";
import { GAME_VERSION, replayGame, validateReplayEvents } from "../_shared/racing-engine.js";

const ALLOWED_ORIGINS = new Set(["https://racinggame.fun", "https://www.racinggame.fun", "https://codingyetnahi.github.io"]);
const MAX_BODY_BYTES = 131_072;
const RUN_LIFETIME_MS = 20 * 60 * 1000;

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

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function randomSeed() {
  const values = crypto.getRandomValues(new Uint32Array(1));
  return values[0] || 1;
}

function randomDisplayName() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const suffix = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `Racer-${suffix}`;
}

function bearerToken(req: Request) {
  return /^Bearer ([A-Za-z0-9_-]{40,90})$/.exec(req.headers.get("authorization") || "")?.[1] || "";
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(message: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

function ticketPayload(run: Record<string, unknown>) {
  return [run.id, run.player_id, run.seed, run.game_version, run.expires_at].join(".");
}

function parseJsonBody(rawBody: string) {
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) throw new Error("REQUEST_TOO_LARGE");
  if (!rawBody) return {};
  const parsed = JSON.parse(rawBody);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID_JSON");
  return parsed as Record<string, unknown>;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) return json({ error: "Request is too large" }, 413, origin);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Verification service is not configured" }, 503, origin);
    }
    // Dedicated secrets are preferred. A domain-separated digest of Supabase's
    // backend-only service key is a cryptographically strong deployment fallback.
    const configuredSigningSecret = Deno.env.get("VERIFIED_RUN_SIGNING_SECRET");
    const configuredRateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
    const signingSecret = configuredSigningSecret && configuredSigningSecret.length >= 32
      ? configuredSigningSecret
      : await sha256Hex(`racing-ticket-v1:${serviceRoleKey}`);
    const rateLimitSecret = configuredRateLimitSecret && configuredRateLimitSecret.length >= 32
      ? configuredRateLimitSecret
      : await sha256Hex(`racing-rate-v1:${serviceRoleKey}`);

    const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const ipAddress = req.headers.get("cf-connecting-ip") || "unknown";
    const clientKey = await sha256Hex(`${rateLimitSecret}:${ipAddress}`);
    const bucketDate = new Date(Math.floor(Date.now() / 600_000) * 600_000).toISOString();
    const rateLimit = async (name: string, maximum: number) => {
      const { data, error } = await db.rpc("consume_racing_verification_rate_limit", {
        p_client_key: clientKey,
        p_action: name,
        p_bucket: bucketDate,
        p_max_requests: maximum
      });
      if (error) throw new Error("RATE_LIMIT_UNAVAILABLE");
      return data === true;
    };

    const rawBody = await req.text();
    let body: Record<string, unknown>;
    try {
      body = parseJsonBody(rawBody);
    } catch (error) {
      return json({ error: error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? "Request is too large" : "Invalid request" }, error instanceof Error && error.message === "REQUEST_TOO_LARGE" ? 413 : 400, origin);
    }

    try {
      if (action === "start-run") {
        if (!await rateLimit("start-run", 30)) return json({ error: "Too many run requests" }, 429, origin);

        let playerToken = bearerToken(req);
        let player: Record<string, unknown> | null = null;
        if (playerToken) {
          const tokenHash = await sha256Hex(playerToken);
          const result = await db.from("racing_verified_players").select("id,display_name").eq("token_hash", tokenHash).maybeSingle();
          if (result.error) throw result.error;
          player = result.data;
        }

        let issuedPlayerToken: string | undefined;
        if (!player) {
          playerToken = randomToken();
          issuedPlayerToken = playerToken;
          const displayName = randomDisplayName();
          const result = await db.from("racing_verified_players").insert({ token_hash: await sha256Hex(playerToken), display_name: displayName }).select("id,display_name").single();
          if (result.error) throw result.error;
          player = result.data;
        }

        const expiresAt = new Date(Date.now() + RUN_LIFETIME_MS).toISOString();
        const seed = randomSeed();
        const result = await db.from("racing_verified_runs").insert({
          player_id: player.id,
          seed,
          game_version: GAME_VERSION,
          expires_at: expiresAt
        }).select("id,player_id,seed,game_version,expires_at").single();
        if (result.error) throw result.error;
        const ticket = await hmacHex(ticketPayload(result.data), signingSecret);

        return json({
          runId: result.data.id,
          seed: result.data.seed,
          gameVersion: result.data.game_version,
          expiresAt: result.data.expires_at,
          ticket,
          displayName: player.display_name,
          ...(issuedPlayerToken ? { playerToken: issuedPlayerToken } : {})
        }, 200, origin);
      }

      if (action === "submit-run") {
        if (!await rateLimit("submit-run", 20)) return json({ error: "Too many score submissions" }, 429, origin);
        const playerToken = bearerToken(req);
        if (!playerToken) return json({ error: "Player session required" }, 401, origin);
        const playerResult = await db.from("racing_verified_players").select("id,display_name").eq("token_hash", await sha256Hex(playerToken)).maybeSingle();
        if (playerResult.error) throw playerResult.error;
        if (!playerResult.data) return json({ error: "Player session is invalid" }, 401, origin);

        const runId = body.runId;
        const ticket = body.ticket;
        const endTick = body.endTick;
        const events = body.events;
        if (!isUuid(runId) || typeof ticket !== "string" || !Array.isArray(events) || !Number.isInteger(endTick)) {
          return json({ error: "Invalid replay submission" }, 400, origin);
        }
        const validation = validateReplayEvents(events, endTick as number);
        if (!validation.valid) return json({ error: validation.error }, 400, origin);

        const runResult = await db.from("racing_verified_runs")
          .select("id,player_id,seed,game_version,status,expires_at")
          .eq("id", runId)
          .eq("player_id", playerResult.data.id)
          .maybeSingle();
        if (runResult.error) throw runResult.error;
        const run = runResult.data;
        if (!run || run.status !== "issued" || new Date(run.expires_at).getTime() <= Date.now()) {
          return json({ error: "Run is unavailable or expired" }, 409, origin);
        }
        if (run.game_version !== GAME_VERSION) return json({ error: "Game version is no longer accepted" }, 409, origin);
        const expectedTicket = await hmacHex(ticketPayload(run), signingSecret);
        if (!safeEqual(ticket, expectedTicket)) return json({ error: "Run ticket is invalid" }, 403, origin);

        const verifiedState = replayGame(Number(run.seed), events, endTick as number);
        if ((!verifiedState.crashed && !verifiedState.capped) || verifiedState.tick !== endTick) {
          return json({ error: "The submitted replay does not have a verified ending" }, 422, origin);
        }

        const completion = await db.rpc("complete_racing_verified_run", {
          p_run_id: run.id,
          p_player_id: playerResult.data.id,
          p_score: verifiedState.score,
          p_end_tick: verifiedState.tick,
          p_input_count: events.length
        });
        if (completion.error) return json({ error: "Run was already submitted or could not be verified" }, 409, origin);
        return json({ verified: true, score: verifiedState.score, tick: verifiedState.tick, displayName: playerResult.data.display_name }, 200, origin);
      }

      if (action === "leaderboard") {
        if (!await rateLimit("leaderboard", 60)) return json({ error: "Too many leaderboard requests" }, 429, origin);
        const result = await db.from("racing_verified_scores")
          .select("score,created_at,racing_verified_players!inner(display_name)")
          .eq("game_version", GAME_VERSION)
          .order("score", { ascending: false })
          .order("created_at", { ascending: true })
          .limit(10);
        if (result.error) throw result.error;
        const entries = result.data.map((row: Record<string, unknown>, index: number) => ({
          rank: index + 1,
          name: (row.racing_verified_players as Record<string, unknown>).display_name,
          score: row.score,
          achievedAt: row.created_at
        }));
        return json({ gameVersion: GAME_VERSION, entries }, 200, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      console.error("Verified run service error", error instanceof Error ? error.message : "unknown");
      return json({ error: "Verification service is temporarily unavailable" }, 503, origin);
    }
  }
};
