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
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ error: "Konfigurasi server belum lengkap." }, 500);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) {
      return json({ error: "Tidak terautentikasi." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: callerProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (profileError) {
      console.error("Failed to load caller profile.", {
        callerId: caller.id,
        code: profileError.code,
        message: profileError.message,
      });
      return json({ error: "Gagal memeriksa profil pemanggil." }, 500);
    }
    if (!callerProfile) {
      console.warn("Caller profile not found.", { callerId: caller.id });
      return json({ error: "Profil pemanggil tidak ditemukan." }, 403);
    }

    const payload = await req.json().catch(() => ({}));
    const loginId = String(payload.login_id || "").trim().toLowerCase();
    const cleanName = String(payload.full_name || "").trim();
    const cleanPassword = String(payload.password || "");
    const requestedRole = String(payload.role || "user");

    if (!/^[a-z0-9._-]{3,32}$/.test(loginId)) {
      return json({ error: "ID login harus 3–32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung." }, 400);
    }
    if (!cleanPassword) {
      return json({ error: "Kata sandi wajib diisi." }, 400);
    }
    if (cleanPassword.length < 6) {
      return json({ error: "Kata sandi minimal 6 karakter." }, 400);
    }

    let cleanRole = "user";
    if (callerProfile.role === "super_admin") {
      if (!["admin", "user"].includes(requestedRole)) {
        return json({ error: "Super admin hanya dapat membuat akun admin atau user." }, 400);
      }
      cleanRole = requestedRole;
    } else if (callerProfile.role === "admin") {
      if (requestedRole !== "user") {
        return json({ error: "Admin hanya dapat membuat akun user." }, 403);
      }
      cleanRole = "user";
    } else {
      return json({ error: "Tidak memiliki izin membuat akun." }, 403);
    }

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from("profiles")
      .select("id")
      .eq("login_id", loginId)
      .maybeSingle();
    if (existingProfileError) {
      console.error("Failed to check login ID availability.", {
        code: existingProfileError.code,
        message: existingProfileError.message,
      });
      return json({ error: "Gagal memeriksa ID login." }, 500);
    }
    if (existingProfile) {
      return json({ error: "ID login sudah digunakan." }, 409);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: `${loginId}@login.mutabaah.invalid`,
      password: cleanPassword,
      email_confirm: true,
      user_metadata: { login_id: loginId, full_name: cleanName },
    });
    if (createError || !created?.user) {
      return json({ error: createError?.message || "Gagal membuat akun." }, 400);
    }

    const { error: upsertError } = await adminClient.from("profiles").upsert({
      id: created.user.id,
      login_id: loginId,
      email: null,
      full_name: cleanName,
      role: cleanRole,
      created_by: caller.id,
    });
    if (upsertError) {
      const { error: cleanupError } = await adminClient.auth.admin.deleteUser(created.user.id);
      if (cleanupError) {
        console.error("Failed to clean up account after profile creation failed.", {
          userId: created.user.id,
          message: cleanupError.message,
        });
      }
      return json({ error: upsertError.message }, 400);
    }

    return json({
      success: true,
      user: {
        login_id: loginId,
        id: created.user.id,
        full_name: cleanName,
        role: cleanRole,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan.";
    return json({ error: message }, 500);
  }
});
