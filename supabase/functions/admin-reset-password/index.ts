import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "missing token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Identifica o requisitante
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jsonResp = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    // Cargo do solicitante
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const roles = (callerRoles ?? []).map((r: { role: string }) => r.role);
    const isSuper = roles.includes("super_master");
    const isMaster = roles.includes("master");
    if (!isSuper && !isMaster) return jsonResp({ error: "forbidden" }, 403);

    const body = await req.json();
    const target_user_id = String(body?.target_user_id ?? "");
    const new_password = String(body?.new_password ?? "");
    if (!target_user_id || new_password.length < 6) {
      return jsonResp({ error: "invalid input" }, 400);
    }

    // Alvo privilegiado: só o Super Master mexe
    const { data: targetRoles } = await admin
      .from("user_roles").select("role").eq("user_id", target_user_id);
    const targetIsPrivileged = (targetRoles ?? [])
      .some((r: { role: string }) => r.role === "master" || r.role === "super_master");
    if (targetIsPrivileged && !isSuper) {
      return jsonResp({ error: "Apenas o Super Master pode redefinir a senha de um Master" }, 403);
    }

    // Alvo comum: precisa estar numa região do solicitante
    if (!isSuper) {
      const { data: podeVer } = await admin.rpc("master_ve_usuario", {
        _master: userData.user.id, _target: target_user_id,
      });
      if (!podeVer) return jsonResp({ error: "Usuário fora da sua região" }, 403);
    }

    const { error: updErr } = await admin.auth.admin.updateUserById(target_user_id, {
      password: new_password,
    });
    if (updErr) {
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin
      .from("profiles")
      .update({ must_change_password: true })
      .eq("id", target_user_id);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
