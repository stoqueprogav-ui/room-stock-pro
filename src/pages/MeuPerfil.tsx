import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { RoleBadge } from "@/components/StatusBadge";
import { User, KeyRound, Save } from "lucide-react";

export default function MeuPerfil() {
  const { profile, role, refreshProfile } = useAuth();
  const [nome, setNome] = useState(profile?.nome ?? "");
  const [salaNome, setSalaNome] = useState<string>("—");
  const [savingNome, setSavingNome] = useState(false);

  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);

  useEffect(() => { setNome(profile?.nome ?? ""); }, [profile?.nome]);

  useEffect(() => {
    (async () => {
      if (!profile?.sala_id) { setSalaNome("—"); return; }
      const { data } = await supabase.from("salas").select("nome").eq("id", profile.sala_id).maybeSingle();
      setSalaNome(data?.nome ?? "—");
    })();
  }, [profile?.sala_id]);

  const salvarNome = async () => {
    if (!nome.trim()) return toast.error("Nome obrigatório");
    setSavingNome(true);
    const { error } = await supabase.from("profiles").update({ nome: nome.trim() }).eq("id", profile!.id);
    setSavingNome(false);
    if (error) return toast.error(error.message);
    toast.success("Nome atualizado");
    refreshProfile();
  };

  const alterarSenha = async () => {
    if (nova.length < 6) return toast.error("Nova senha deve ter ao menos 6 caracteres");
    if (nova !== conf) return toast.error("Confirmação não confere");
    if (!profile?.email) return;
    setSavingPwd(true);
    // Valida senha atual
    const { error: signErr } = await supabase.auth.signInWithPassword({ email: profile.email, password: atual });
    if (signErr) { setSavingPwd(false); return toast.error("Senha atual inválida"); }
    const { error } = await supabase.auth.updateUser({ password: nova });
    if (error) { setSavingPwd(false); return toast.error(error.message); }
    await supabase.rpc("marcar_senha_trocada");
    setSavingPwd(false);
    setAtual(""); setNova(""); setConf("");
    toast.success("Senha alterada");
    refreshProfile();
  };

  const ROLE_LABEL: Record<string, string> = { master: "Master", admin: "Administrador", analista: "Analista" };

  return (
    <div className="space-y-6 max-w-3xl">
      <PageHeader title="Meu Perfil" description="Atualize seus dados pessoais e sua senha." />

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><User className="size-5" /> Dados</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>E-mail</Label>
              <Input value={profile?.email ?? ""} readOnly disabled />
            </div>
            <div className="space-y-2">
              <Label>Tipo de usuário</Label>
              <div className="flex items-center gap-2 h-10">
                {role && <RoleBadge role={role} />}
                <span className="text-sm text-muted-foreground">{role ? ROLE_LABEL[role] : "—"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sala vinculada</Label>
              <Input value={salaNome} readOnly disabled />
            </div>
          </div>
          <div>
            <Button onClick={salvarNome} disabled={savingNome || nome === profile?.nome}>
              <Save className="size-4" /> {savingNome ? "Salvando…" : "Salvar nome"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="size-5" /> Alterar senha</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Senha atual</Label>
              <Input type="password" value={atual} onChange={(e) => setAtual(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Nova senha</Label>
              <Input type="password" value={nova} onChange={(e) => setNova(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Confirmar nova senha</Label>
              <Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} />
            </div>
          </div>
          <Button onClick={alterarSenha} disabled={savingPwd || !atual || !nova || !conf}>
            {savingPwd ? "Alterando…" : "Alterar senha"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
