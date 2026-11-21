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
      .maybeSingle();
    if (callerProfileError) {
      console.error("Failed to load caller profile.", {
        callerId: caller.id,
        code: callerProfileError.code,
        message: callerProfileError.message,
      });
      return json({ error: "Gagal memeriksa profil pemanggil." }, 500);
    }
    if (!callerProfile) {
      return json({ error: "Profil pemanggil tidak ditemukan." }, 403);
    }

    const payload = await req.json();
    const action = String(payload.action ?? "");
    const targetId = String(payload.user_id ?? "");
    if (!targetId || targetId === caller.id) {
      return json({ error: "Akun tujuan tidak dapat dikelola." }, 400);
    }
    if (!["delete", "transfer"].includes(action)) {
      return json({ error: "Aksi tidak valid." }, 400);
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
    if (!target) {
      return json({ error: "Akun tujuan tidak ditemukan." }, 404);
    }

    if (action === "transfer") {
      if (callerProfile.role !== "super_admin" || target.role !== "user") {
        return json({ error: "Hanya super admin yang dapat memindahkan user." }, 403);
      }
      const adminId = String(payload.admin_id ?? "");
      const { data: destination, error: destinationError } = await adminClient
        .from("profiles")
        .select("id, role")
        .eq("id", adminId)
        .maybeSingle();
      if (destinationError) {
        console.error("Failed to load destination admin.", {
          adminId,
          code: destinationError.code,
          message: destinationError.message,
        });
        return json({ error: "Gagal memeriksa admin tujuan." }, 500);
      }
      if (!destination || destination.role !== "admin") {
        return json({ error: "Admin tujuan tidak valid." }, 400);
      }
      if (target.created_by === destination.id) {
        return json({ error: "User sudah dikelola oleh admin tersebut." }, 400);
      }

      const { error: transferError } = await adminClient
        .from("profiles")
        .update({ created_by: destination.id })
        .eq("id", target.id);
      if (transferError) {
        console.error("Failed to transfer user to destination admin.", {
          targetId,
          adminId,
          message: transferError.message,
        });
        return json({ error: "Gagal memindahkan user." }, 500);
      }
      return json({ success: true, created_by: destination.id });
    }

    const canDelete = callerProfile.role === "super_admin"
      ? ["user", "admin"].includes(target.role)
      : callerProfile.role === "admin" && target.role === "user" && target.created_by === caller.id;
    if (!canDelete) {
      return json({ error: "Tidak memiliki izin menghapus akun tujuan." }, 403);
    }

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(target.id);
    if (deleteError) {
      console.error("Failed to delete target authentication account.", {
        targetId,
        message: deleteError.message,
      });
      return json({ error: "Gagal menghapus akun." }, 500);
    }
    return json({ success: true });
  } catch (err) {
    console.error("User management request failed.", err);
    return json({ error: "Permintaan pengelolaan akun tidak valid." }, 400);
  }
});
