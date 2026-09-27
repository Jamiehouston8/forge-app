import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Permanently deletes the signed-in user's account and their data.
// Required by App Store guideline 5.1.1(v): apps that let people sign up must
// let them delete their account from inside the app. Deploy with "Verify JWT" ON.
// Uses the service role (auto-injected as SUPABASE_SERVICE_ROLE_KEY) because
// deleting an auth user is an admin operation.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Identify the caller from their own session token — never from the body,
  // so nobody can delete someone else's account.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in required" }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ error: "Sign in required" }, 401);
  const uid = userData.user.id;

  // Delete the user's rows first, then the auth user.
  const steps = [
    admin.from("lifeos").delete().eq("user_id", uid),
    admin.from("notifications").delete().or(`to_user_id.eq.${uid},from_user_id.eq.${uid}`),
    admin.from("subscriptions").delete().eq("user_id", uid),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) {
      console.error("delete-account data step failed", uid, error.message);
      return json({ error: "Could not delete your data, please try again" }, 500);
    }
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) {
    console.error("delete-account auth delete failed", uid, delErr.message);
    return json({ error: "Could not delete your account, please try again" }, 500);
  }

  console.log("delete-account: deleted", uid);
  return json({ ok: true });
});
