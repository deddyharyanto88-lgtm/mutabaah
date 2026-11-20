import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Konfigurasi server belum lengkap." }, 500);
    }

    const payload = await req.json();
    const identifier = String(payload.identifier || "").trim().toLowerCase();
    const password = String(payload.password || "");
    if (!identifier || !password) {
      return json({ error: "ID/email atau kata sandi salah." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const profileQuery = adminClient
      .from("profiles")
      .select("id")
      .limit(1);
    const { data: profile, error: profileError } = identifier.includes("@")
      ? await profileQuery.eq("email", identifier).maybeSingle()
      : await profileQuery.eq("login_id", identifier).maybeSingle();

    if (profileError) {
      console.error("Failed to resolve login identifier.", {
        code: profileError.code,
        message: profileError.message,
      });
      return json({ error: "Gagal memeriksa ID/email." }, 500);
    }
    if (!profile) {
      return json({ error: "ID/email atau kata sandi salah." }, 401);
    }

    const { data: authUserData, error: authUserError } = await adminClient.auth.admin.getUserById(profile.id);
    if (authUserError || !authUserData.user?.email) {
      console.error("Failed to load authentication account for profile.", {
        profileId: profile.id,
        message: authUserError?.message,
      });
      return json({ error: "Gagal memeriksa akun." }, 500);
    }

    const authClient = createClient(supabaseUrl, anonKey);
    const { data, error } = await authClient.auth.signInWithPassword({
      email: authUserData.user.email,
      password,
    });
    if (error || !data.session) {
      return json({ error: "ID/email atau kata sandi salah." }, 401);
    }

    return json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan.";
    console.error("Login request failed.", message);
    return json({ error: "Permintaan login tidak valid." }, 400);
  }
});
