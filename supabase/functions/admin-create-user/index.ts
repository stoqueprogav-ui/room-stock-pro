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
      console.error("admin-create-user missing env");
      return jsonResp({ ok: false, error: "Configuração do servidor ausente", step: "env" }, 500);
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      console.error("admin-create-user invalid token", userErr);
      return jsonResp({ ok: false, error: "Sessão inválida — faça login novamente", step: "auth" }, 401);
    }
    const callerId = userData.user.id;

    // Papéis do solicitante
    const { data: callerRoles } = await admin
      .from("user_roles").select("role").eq("user_id", callerId);
    const roles = (callerRoles ?? []).map((r) => r.role);
    const isSuper = roles.includes("super_master");
    const isMaster = roles.includes("master");
    if (!isSuper && !isMaster) {
      return jsonResp({ ok: false, error: "Apenas Master pode criar usuários", step: "perm" }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return jsonResp({ ok: false, error: "payload inválido", step: "input" }, 400); }

    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const nome = String(body?.nome ?? "").trim();
    const role = String(body?.role ?? "analista");
    const sala_id = body?.sala_id ? String(body.sala_id) : null;

    if (!email || !password || !nome) return jsonResp({ ok: false, error: "Preencha nome, email e senha", step: "input" }, 400);
    if (password.length < 6) return jsonResp({ ok: false, error: "Senha deve ter ao menos 6 caracteres", step: "input" }, 400);
    if (!["super_master", "master", "admin", "analista"].includes(role)) {
      return jsonResp({ ok: false, error: "Perfil inválido", step: "input" }, 400);
    }

    // Guard de cargo: master/super_master só o Super Master concede.
    if ((role === "master" || role === "super_master") && !isSuper) {
      return jsonResp({ ok: false, error: "Apenas o Super Master pode criar Master/Super Master", step: "perm" }, 403);
    }

    // admin/analista exigem sala; e a sala precisa estar numa região do solicitante (a menos que Super).
    if (role !== "master" && role !== "super_master") {
      if (!sala_id) return jsonResp({ ok: false, error: "Admin/Analista exige sala", step: "input" }, 400);
      if (!isSuper) {
        const { data: sala } = await admin.from("salas").select("regiao_id").eq("id", sala_id).maybeSingle();
        const regiao = sala?.regiao_id ?? null;
        if (!regiao) return jsonResp({ ok: false, error: "Sala sem região definida", step: "input" }, 400);
        const { data: vinculo } = await admin
          .from("master_regioes").select("regiao_id")
          .eq("user_id", callerId).eq("regiao_id", regiao).maybeSingle();
        if (!vinculo) {
          return jsonResp({ ok: false, error: "Você não administra a região desta sala", step: "perm" }, 403);
        }
      }
    }

    const userMeta = {
      nome,
      sala_id: (role === "master" || role === "super_master") ? "" : sala_id,
      must_change_password: "true",
    };

    // admin.createUser NÃO altera a sessão do solicitante. A trigger cria só o profile.
    let { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMeta,
    });

    // Se o email já existe, verifica se é um "órfão" (sem profile/roles — restos de exclusão anterior)
    // e nesse caso apaga e recria. Caso contrário, retorna erro amigável.
    if (createErr && /already.*registered|exists/i.test(createErr.message ?? "")) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
      const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
      if (existing) {
        const [{ data: existProf }, { data: existRoles }] = await Promise.all([
          admin.from("profiles").select("id").eq("id", existing.id).maybeSingle(),
          admin.from("user_roles").select("role").eq("user_id", existing.id),
        ]);
        const isOrphan = !existProf && (!existRoles || existRoles.length === 0);
        if (isOrphan) {
          await admin.auth.admin.deleteUser(existing.id);
          const retry = await admin.auth.admin.createUser({
            email, password, email_confirm: true, user_metadata: userMeta,
          });
          created = retry.data;
          createErr = retry.error;
        }
      }
    }

    if (createErr || !created?.user) {
      console.error("admin-create-user createUser error", createErr);
      const msg = createErr?.message ?? "Falha ao criar usuário no Auth";
      const friendly = /already.*registered|exists/i.test(msg)
        ? "Já existe um usuário ativo com este email"
        : msg;
      return jsonResp({ ok: false, error: friendly, step: "auth.create", details: msg }, 400);
    }

    // Cargo atribuído aqui (service_role). A trigger de banco não faz isso.
    const { error: roleErr } = await admin
      .from("user_roles").insert({ user_id: created.user.id, role });
    if (roleErr) {
      console.error("admin-create-user role insert error", roleErr);
      await admin.auth.admin.deleteUser(created.user.id);
      return jsonResp({ ok: false, error: "Falha ao atribuir cargo: " + roleErr.message, step: "role" }, 400);
    }

    return jsonResp({ ok: true, user_id: created.user.id, email, nome });
  } catch (e) {
    console.error("admin-create-user unexpected", e);
    return jsonResp({ ok: false, error: String((e as Error)?.message ?? e), step: "unexpected" }, 500);
  }
});
