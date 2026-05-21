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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "master").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "forbidden: apenas master" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "RESETAR SISTEMA") {
      return new Response(JSON.stringify({ error: "confirmação inválida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Limpa dados via RPC
    const { data: rpcData, error: rpcErr } = await admin.rpc("reset_sistema_total");
    if (rpcErr) {
      console.error("reset-system rpc error", rpcErr);
      return new Response(JSON.stringify({ error: rpcErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const masterIds: string[] = (rpcData as any)?.master_ids ?? [];
    const masterSet = new Set(masterIds);

    // 2. Apaga usuários auth.users que não sejam master (paginado)
    let deleted = 0;
    let page = 1;
    while (true) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) {
        console.error("reset-system listUsers error", listErr);
        break;
      }
      const users = list?.users ?? [];
      if (users.length === 0) break;
      for (const u of users) {
        if (!masterSet.has(u.id)) {
          const { error: dErr } = await admin.auth.admin.deleteUser(u.id);
          if (!dErr) deleted++;
        }
      }
      if (users.length < 200) break;
      page++;
      if (page > 50) break;
    }

    return new Response(JSON.stringify({ ok: true, deleted_users: deleted, kept_masters: masterIds.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reset-system unexpected", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
