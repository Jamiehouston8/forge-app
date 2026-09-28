import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Server-side proxy so the Anthropic key never ships in the app.
// Requires a real signed-in user (not just the public anon key), allowlists
// models, and caps input/output so it can't be used as an open, free Claude
// endpoint. Deploy with "Verify JWT" ON.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_MODEL = "claude-sonnet-4-5";
const ALLOWED_MODELS = new Set([
  "claude-sonnet-4-5",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "claude-opus-5", // the mentor agent (www/mentor/agent.js)
]);
const MAX_TOKENS_CAP = 1500;
// Thinking tokens count toward max_tokens, so requests that ask for adaptive
// thinking get more room.
const MAX_TOKENS_CAP_THINKING = 6000;
const MAX_INPUT_CHARS = 120000;
const EFFORTS = new Set(["low", "medium", "high"]);

// system may be a string (older app builds) or text blocks with an optional
// ephemeral cache_control (the agent caches its fixed prompt). Anything else → undefined.
function cleanSystem(sys: unknown): string | unknown[] | undefined {
  if (typeof sys === "string") return sys;
  if (!Array.isArray(sys) || sys.length === 0 || sys.length > 4) return undefined;
  const out = [];
  for (const b of sys) {
    if (!b || b.type !== "text" || typeof b.text !== "string") return undefined;
    out.push(b.cache_control?.type === "ephemeral"
      ? { type: "text", text: b.text, cache_control: { type: "ephemeral" } }
      : { type: "text", text: b.text });
  }
  return out;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Try the plausible secret names in order (newest first) and log which one
  // matched, plus the last 4 chars (safe) so it can be compared with the key
  // list in the Anthropic console.
  const KEY_NAMES = ["forge-proxy", "ANTHROPIC_API_KEY02", "ANTHROPIC_API_KEY"];
  const keyName = KEY_NAMES.find((n) => (Deno.env.get(n) ?? "").trim() !== "");
  const anthropicKey = keyName ? Deno.env.get(keyName)!.trim() : undefined;
  if (!anthropicKey) return json({ error: "AI is not configured yet" }, 500);
  console.log(`claude-proxy using secret "${keyName}" ending ...${anthropicKey.slice(-4)}`);
  const workspaceId = (Deno.env.get("ANTHROPIC_WORKSPACE_ID") ?? "").trim();

  // Must be a real user session, not the public anon key.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required" }, 401);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Sign in required" }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "messages required" }, 400);
  }
  const system = cleanSystem(body?.system);
  // Tool definitions so the mentor can act (mark goals done, log health, etc.),
  // not just talk. Passed straight through to Anthropic; only shape-checked.
  const tools = Array.isArray(body?.tools) ? body.tools : undefined;
  const tool_choice = tools && body?.tool_choice ? body.tool_choice : undefined;
  if (
    JSON.stringify(messages).length + JSON.stringify(system ?? "").length +
        (tools ? JSON.stringify(tools).length : 0) >
      MAX_INPUT_CHARS
  ) {
    return json({ error: "Request too large" }, 413);
  }

  const model = ALLOWED_MODELS.has(body?.model) ? body.model : DEFAULT_MODEL;
  // Optional agent features, only passed on in the exact shapes the app sends.
  const thinking = body?.thinking?.type === "adaptive" ? { type: "adaptive" } : undefined;
  const output_config = EFFORTS.has(body?.output_config?.effort) ? { effort: body.output_config.effort } : undefined;
  const cache_control = body?.cache_control?.type === "ephemeral" ? { type: "ephemeral" } : undefined;
  // Server-side refusal fallback (Opus 5): "default" lets Anthropic pick the model.
  const fallbacks = body?.fallbacks === "default" && model === "claude-opus-5" ? "default" : undefined;
  const cap = thinking ? MAX_TOKENS_CAP_THINKING : MAX_TOKENS_CAP;
  const max_tokens = Math.min(Math.max(Number(body?.max_tokens) || 400, 1), cap);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      ...(fallbacks ? { "anthropic-beta": "server-side-fallback-2026-07-01" } : {}),
      // Only needed if the key is not scoped to a workspace.
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens,
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      ...(tool_choice ? { tool_choice } : {}),
      ...(thinking ? { thinking } : {}),
      ...(output_config ? { output_config } : {}),
      ...(cache_control ? { cache_control } : {}),
      ...(fallbacks ? { fallbacks } : {}),
      messages,
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
