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

    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "master").maybeSingle();
    if (!roleRow) return jsonResp({ ok: false, error: "Apenas Master pode criar usuários", step: "perm" }, 403);

    let body: any = {};
    try { body = await req.json(); } catch { return jsonResp({ ok: false, error: "payload inválido", step: "input" }, 400); }

    const email = String(body?.email ?? "").trim().toLowerCase();
    const password = String(body?.password ?? "");
    const nome = String(body?.nome ?? "").trim();
    const role = String(body?.role ?? "analista");
    const sala_id = body?.sala_id ? String(body.sala_id) : null;

    if (!email || !password || !nome) return jsonResp({ ok: false, error: "Preencha nome, email e senha", step: "input" }, 400);
    if (password.length < 6) return jsonResp({ ok: false, error: "Senha deve ter ao menos 6 caracteres", step: "input" }, 400);
    if (!["master", "admin", "analista"].includes(role)) return jsonResp({ ok: false, error: "Perfil inválido", step: "input" }, 400);
    if (role !== "master" && !sala_id) return jsonResp({ ok: false, error: "Admin/Analista exige sala", step: "input" }, 400);

    // admin.createUser NÃO altera a sessão do master (não usa signUp).
    // A trigger handle_new_user cria só o profile — NÃO o cargo.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        nome,
        sala_id: role === "master" ? "" : sala_id,
        must_change_password: "true",
      },
    });
    if (createErr || !created?.user) {
      console.error("admin-create-user createUser error", createErr);
      const msg = createErr?.message ?? "Falha ao criar usuário no Auth";
      const friendly = /already.*registered|exists/i.test(msg) ? "Já existe um usuário com este email" : msg;
      return jsonResp({ ok: false, error: friendly, step: "auth.create", details: msg }, 400);
    }

    // Atribuição de cargo via RPC set_user_role, executada com o JWT do Master
    // (o trigger de user_roles valida auth.uid() = Master, então service_role não passa).
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { error: roleErr } = await userClient.rpc("set_user_role", {
      _user: created.user.id,
      _role: role,
    });
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
