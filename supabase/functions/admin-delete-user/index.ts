import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return jsonResp({ ok: false, error: "missing token", step: "auth" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error("admin-delete-user missing env");
      return jsonResp({ ok: false, error: "Configuração do servidor ausente", step: "env" });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      console.error("admin-delete-user invalid token", userErr);
      return jsonResp({ ok: false, error: "Sessão inválida — faça login novamente", step: "auth" }, 401);
    }

    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", userData.user.id);
    const roles = (callerRoles ?? []).map((r: { role: string }) => r.role);
    const isSuper = roles.includes("super_master");
    const isMaster = roles.includes("master");
    if (!isSuper && !isMaster) {
      return jsonResp({ ok: false, error: "Apenas Master pode excluir usuários", step: "perm" }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return jsonResp({ ok: false, error: "payload inválido", step: "input" }); }

    const target_user_id = String(body?.target_user_id ?? "");
    if (!target_user_id) return jsonResp({ ok: false, error: "target_user_id obrigatório", step: "input" }, 400);
    if (target_user_id === userData.user.id) {
      return jsonResp({ ok: false, error: "Não é possível excluir a si mesmo", step: "input" }, 400);
    }

    // Alvo privilegiado: só o Super Master pode excluir, e ainda com confirmação
    const { data: targetRoles } = await admin
      .from("user_roles").select("role").eq("user_id", target_user_id);
    const targetIsPrivileged = (targetRoles ?? [])
      .some((r: { role: string }) => r.role === "master" || r.role === "super_master");
    if (targetIsPrivileged) {
      if (!isSuper) {
        return jsonResp({ ok: false, error: "Apenas o Super Master pode excluir um Master", step: "perm" }, 403);
      }
      if (!body?.confirm_master) {
        return jsonResp({ ok: false, error: "Alvo é Master. Reenvie com confirm_master=true para prosseguir", step: "perm" }, 400);
      }
    } else if (!isSuper) {
      const { data: podeVer } = await admin.rpc("master_ve_usuario", {
        _master: userData.user.id, _target: target_user_id,
      });
      if (!podeVer) {
        return jsonResp({ ok: false, error: "Usuário fora da sua região", step: "perm" }, 403);
      }
    }

    // Desvincula histórico (FKs principais já são ON DELETE SET NULL/CASCADE)
    const r1 = await admin.from("user_roles").delete().eq("user_id", target_user_id);
    if (r1.error) console.warn("delete user_roles warn", r1.error);
    const r2 = await admin.from("profiles").delete().eq("id", target_user_id);
    if (r2.error) console.warn("delete profile warn", r2.error);

    const { error: delErr } = await admin.auth.admin.deleteUser(target_user_id);
    if (delErr) {
      console.error("admin-delete-user auth delete error", delErr);
      return jsonResp({ ok: false, error: delErr.message, step: "auth.delete" });
    }

    return jsonResp({ ok: true });
  } catch (e) {
    console.error("admin-delete-user unexpected", e);
    return jsonResp({ ok: false, error: String((e as Error)?.message ?? e), step: "unexpected" });
  }
});
