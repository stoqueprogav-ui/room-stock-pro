import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ShieldAlert, LogOut } from "lucide-react";

export default function TrocarSenhaObrigatoria() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [nova, setNova] = useState("");
  const [conf, setConf] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user) return <Navigate to="/login" replace />;
  if (profile && !profile.must_change_password) return <Navigate to="/app" replace />;

  const submit = async () => {
    if (nova.length < 6) return toast.error("Mínimo 6 caracteres");
    if (nova !== conf) return toast.error("As senhas não conferem");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: nova });
    if (error) { setSaving(false); return toast.error(error.message); }
    await supabase.rpc("marcar_senha_trocada");
    await refreshProfile();
    setSaving(false);
    toast.success("Senha alterada com sucesso");
    navigate("/app", { replace: true });
  };

  const sair = async () => { await signOut(); navigate("/login", { replace: true }); };

  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="size-5 text-warning" /> Altere sua senha</CardTitle>
          <CardDescription>
            Por segurança, você precisa definir uma nova senha antes de continuar.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Nova senha</Label>
            <Input type="password" value={nova} onChange={(e) => setNova(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Confirmar nova senha</Label>
            <Input type="password" value={conf} onChange={(e) => setConf(e.target.value)} />
          </div>
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button variant="ghost" onClick={sair}><LogOut className="size-4" /> Sair</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Salvando…" : "Salvar nova senha"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
