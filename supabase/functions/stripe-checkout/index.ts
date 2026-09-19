// Supabase Edge Function: stripe-checkout
// Creates a Stripe Checkout session and returns the redirect URL.
//
// SETUP (one time):
// 1. In Supabase dashboard -> Edge Functions -> create a new function called "stripe-checkout"
// 2. Paste this entire file as the function code.
// 3. In Supabase -> Project Settings -> Edge Functions -> Secrets, add:
//       STRIPE_SECRET_KEY = sk_live_... (or sk_test_... while testing)
// 4. Deploy the function.
//
// The publishable key and price IDs live in the front-end (forge-onboarding.html).
//
// 2026-09-19: return URLs are now restricted to our own domains (previously any
// https URL was accepted), and the fallbacks point at forge-app.co.uk.

import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Only ever send people back to our own domains.
const ALLOWED_ORIGINS = ["https://forge-app.co.uk", "https://forges.fit"];

function safeUrl(u: string | undefined, fallback: string): string {
  try {
    if (u && ALLOWED_ORIGINS.includes(new URL(u).origin)) return u;
  } catch (_) {
    // not a valid URL — fall through to the fallback
  }
  return fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  try {
    const { plan, userId, email, successUrl, cancelUrl } = await req.json();

    // Map plan -> Stripe Price ID
    const PRICES: Record<string, string> = {
      monthly: "price_1TgNfiLLD3SG3JwW5ymYtMM0",
      annual: "price_1TgNhBLLD3SG3JwWa6wf8d5T",
      trial: "price_1TgNfiLLD3SG3JwW5ymYtMM0", // trial uses monthly price with a trial period
    };

    const priceId = PRICES[plan];
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Invalid plan" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sessionConfig: any = {
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: safeUrl(successUrl, "https://forge-app.co.uk/forges.html?paid=1"),
      cancel_url: safeUrl(cancelUrl, "https://forge-app.co.uk/forge-onboarding.html"),
      allow_promotion_codes: true,
    };

    // 7-day free trial only for the trial plan
    if (plan === "trial") {
      sessionConfig.subscription_data = { trial_period_days: 7 };
    }

    // Attach the Forge user so the webhook can link the payment back to them
    if (userId) {
      sessionConfig.client_reference_id = userId;
      sessionConfig.metadata = { forge_user_id: userId };
      sessionConfig.subscription_data = sessionConfig.subscription_data || {};
      sessionConfig.subscription_data.metadata = { forge_user_id: userId };
    }
    if (email) {
      sessionConfig.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
