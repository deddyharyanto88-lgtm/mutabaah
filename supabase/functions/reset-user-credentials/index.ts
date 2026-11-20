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

    const authHeader = req.headers.get("Authorization") ?? "";
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
    if (callerError || !caller) {
      return json({ error: "Tidak terautentikasi." }, 401);
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile, error: callerProfileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (callerProfileError) {
      console.error("Failed to load caller profile.", {
        callerId: caller.id,
        code: callerProfileError.code,
        message: callerProfileError.message,
      });
      return json({ error: "Gagal memeriksa profil pemanggil." }, 500);
    }
    if (!["admin", "super_admin"].includes(callerProfile.role)) {
      return json({ error: "Tidak memiliki izin mengelola akun." }, 403);
    }

    const payload = await req.json();
    const targetId = String(payload.user_id ?? "");
    const loginId = String(payload.login_id ?? "").trim().toLowerCase();
    const password = String(payload.password ?? "");
    if (!targetId || !/^[a-z0-9._-]{3,32}$/.test(loginId)) {
      return json({ error: "ID login harus 3–32 karakter: huruf, angka, titik, garis bawah, atau tanda hubung." }, 400);
    }
    if (password && password.length < 6) {
      return json({ error: "Kata sandi minimal 6 karakter." }, 400);
    }
    const { data: target, error: targetError } = await adminClient
      .from("profiles")
      .select("id, login_id, role, created_by")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) {
      console.error("Failed to load target profile.", {
        targetId,
        code: targetError.code,
        message: targetError.message,
      });
      return json({ error: "Gagal memeriksa akun tujuan." }, 500);
    }
    if (!target || target.id === caller.id) {
      return json({ error: "Akun tujuan tidak dapat dikelola." }, 404);
    }

    const canManage = callerProfile.role === "super_admin"
      ? ["user", "admin"].includes(target.role)
      : target.role === "user" && target.created_by === caller.id;
    if (!canManage) {
      return json({ error: "Tidak memiliki izin mengelola akun tujuan." }, 403);
    }

    const loginIdChanged = loginId !== String(target.login_id).toLowerCase();
    if (!loginIdChanged && !password) {
      return json({ error: "Tidak ada perubahan kredensial." }, 400);
    }
    if (loginIdChanged) {
      const { data: profiles, error: existingProfileError } = await adminClient
        .from("profiles")
        .select("id, login_id")
        .neq("id", target.id);
      if (existingProfileError) {
        console.error("Failed to check login ID availability.", {
          code: existingProfileError.code,
          message: existingProfileError.message,
        });
        return json({ error: "Gagal memeriksa ID login." }, 500);
      }
      if (profiles?.some((profile) => String(profile.login_id).toLowerCase() === loginId)) {
        return json({ error: "ID login sudah digunakan." }, 409);
      }
    }

    const { data: targetAuth, error: targetAuthError } = await adminClient.auth.admin.getUserById(target.id);
    if (targetAuthError || !targetAuth.user) {
      console.error("Failed to load target authentication account.", {
        targetId,
        message: targetAuthError?.message,
      });
      return json({ error: "Gagal memeriksa akun autentikasi." }, 500);
    }

    if (loginIdChanged) {
      const { error } = await adminClient.from("profiles").update({ login_id: loginId }).eq("id", target.id);
      if (error) {
        console.error("Failed to update target login ID.", { targetId, message: error.message });
        return json({ error: "Gagal mengubah ID login." }, 500);
      }
    }

    if (password) {
      const { error } = await adminClient.auth.admin.updateUserById(target.id, { password });
      if (error) {
        if (loginIdChanged) {
          const { error: rollbackError } = await adminClient.from("profiles")
            .update({ login_id: target.login_id })
            .eq("id", target.id);
          if (rollbackError) {
            console.error("Failed to roll back login ID after password reset failed.", {
              targetId,
              message: rollbackError.message,
            });
          }
        }
        console.error("Failed to reset target password.", { targetId, message: error.message });
        return json({
          error: loginIdChanged
            ? "Gagal mengubah kata sandi; perubahan ID login dibatalkan."
            : "Gagal mengubah kata sandi.",
        }, 500);
      }
    }

    return json({ success: true, login_id: loginId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Terjadi kesalahan.";
    console.error("Credential reset request failed.", message);
    return json({ error: "Permintaan reset kredensial tidak valid." }, 400);
  }
});
