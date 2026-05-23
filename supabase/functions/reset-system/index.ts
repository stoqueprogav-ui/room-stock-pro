import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ success: false, step: "method", error: "método não permitido" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ success: false, step: "auth", error: "sessão não encontrada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response(JSON.stringify({ success: false, step: "env", error: "configuração segura do backend ausente" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    console.log("reset-system step=auth.validate");
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) {
      console.error("reset-system auth error", userErr);
      return new Response(JSON.stringify({ success: false, step: "auth", error: "sessão inválida" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`reset-system step=auth.master user=${userData.user.id}`);
    const { data: roleRow } = await admin
      .from("user_roles").select("role")
      .eq("user_id", userData.user.id).eq("role", "master").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ success: false, step: "auth.master", error: "apenas Master pode resetar o sistema" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    if (body?.confirm !== "RESETAR SISTEMA") {
      return new Response(JSON.stringify({ success: false, step: "confirmacao", error: "confirmação inválida" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("reset-system step=database.transaction.start");
    const { data: rpcData, error: rpcErr } = await admin.rpc("reset_sistema_total", {
      _caller: userData.user.id,
    });
    if (rpcErr) {
      console.error("reset-system rpc error", rpcErr);
      return new Response(JSON.stringify({
        success: false,
        step: "database.rpc",
        error: rpcErr.message,
        details: rpcErr,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const resetResult = (rpcData ?? {}) as {
      success?: boolean;
      step?: string;
      error?: string;
      deleted?: Record<string, number>;
      master_ids?: string[];
      kept_masters?: number;
    };
    console.log("reset-system database result", JSON.stringify(resetResult));

    if (!resetResult.success) {
      return new Response(JSON.stringify(resetResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const masterIds: string[] = resetResult.master_ids ?? [];
    const masterSet = new Set(masterIds);

    console.log("reset-system step=auth.users.delete.start");
    let deletedUsers = 0;
    let scannedUsers = 0;
    const userErrors: Array<{ user_id: string; error: string }> = [];
    let page = 1;
    while (true) {
      const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (listErr) {
        console.error("reset-system listUsers error", listErr);
        return new Response(JSON.stringify({
          success: false,
          step: "auth.users.list",
          error: listErr.message,
          deleted: { ...(resetResult.deleted ?? {}), usuarios_auth: deletedUsers },
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const users = list?.users ?? [];
      if (users.length === 0) break;
      scannedUsers += users.length;
      for (const u of users) {
        if (!masterSet.has(u.id)) {
          const { error: dErr } = await admin.auth.admin.deleteUser(u.id);
          if (dErr) {
            console.error("reset-system deleteUser error", { user_id: u.id, error: dErr.message });
            userErrors.push({ user_id: u.id, error: dErr.message });
          } else {
            deletedUsers++;
          }
        }
      }
      if (users.length < 200) break;
      page++;
      if (page > 50) break;
    }

    if (userErrors.length > 0) {
      return new Response(JSON.stringify({
        success: false,
        step: "auth.users.delete",
        error: "alguns usuários não puderam ser removidos",
        user_errors: userErrors,
        deleted: { ...(resetResult.deleted ?? {}), usuarios_auth: deletedUsers },
        kept_masters: masterIds.length,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = {
      success: true,
      step: "finalizado",
      deleted: { ...(resetResult.deleted ?? {}), usuarios_auth: deletedUsers },
      scanned_users: scannedUsers,
      kept_masters: resetResult.kept_masters ?? masterIds.length,
    };
    console.log("reset-system success", JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("reset-system unexpected", e);
    return new Response(JSON.stringify({
      success: false,
      step: "edge.unexpected",
      error: String((e as Error)?.message ?? e),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
