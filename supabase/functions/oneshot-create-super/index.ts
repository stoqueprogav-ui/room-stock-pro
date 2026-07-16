import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

Deno.serve(async () => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const email = "stoqueprogav@gmail.com";
  const password = "Estoque140213$";

  // Find or create
  let userId: string | null = null;
  const { data: list } = await admin.auth.admin.listUsers();
  const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { nome: "Super Master", must_change_password: "false" },
    });
    if (error) return new Response(JSON.stringify({ ok: false, step: "create", error: error.message }), { status: 500 });
    userId = created.user!.id;
  }

  // Upsert profile
  await admin.from("profiles").upsert({ id: userId, nome: "Super Master", email, must_change_password: false });

  // Reset roles to only super_master
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error: rErr } = await admin.from("user_roles").insert({ user_id: userId, role: "super_master" });
  if (rErr) return new Response(JSON.stringify({ ok: false, step: "role", error: rErr.message }), { status: 500 });

  // Remove super_master from thiago and ensure master
  const { data: thiagoProf } = await admin.from("profiles").select("id").ilike("email", "thiagosahy@gmail.com").maybeSingle();
  if (thiagoProf?.id) {
    await admin.from("user_roles").delete().eq("user_id", thiagoProf.id).eq("role", "super_master");
    await admin.from("user_roles").upsert({ user_id: thiagoProf.id, role: "master" }, { onConflict: "user_id,role" });
  }

  return new Response(JSON.stringify({ ok: true, userId, thiagoId: thiagoProf?.id ?? null }), { headers: { "Content-Type": "application/json" } });
});
