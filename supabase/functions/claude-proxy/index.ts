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
]);
const MAX_TOKENS_CAP = 1500;
const MAX_INPUT_CHARS = 60000;

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
  const system = typeof body?.system === "string" ? body.system : undefined;
  // Tool definitions so the mentor can act (mark goals done, log health, etc.),
  // not just talk. Passed straight through to Anthropic; only shape-checked.
  const tools = Array.isArray(body?.tools) ? body.tools : undefined;
  const tool_choice = tools && body?.tool_choice ? body.tool_choice : undefined;
  if (
    JSON.stringify(messages).length + (system?.length ?? 0) +
        (tools ? JSON.stringify(tools).length : 0) >
      MAX_INPUT_CHARS
  ) {
    return json({ error: "Request too large" }, 413);
  }

  const model = ALLOWED_MODELS.has(body?.model) ? body.model : DEFAULT_MODEL;
  const max_tokens = Math.min(Math.max(Number(body?.max_tokens) || 400, 1), MAX_TOKENS_CAP);

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
      // Only needed if the key is not scoped to a workspace.
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens,
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      ...(tool_choice ? { tool_choice } : {}),
      messages,
    }),
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
