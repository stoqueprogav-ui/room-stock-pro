import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";

const PHRASE = "RESETAR SISTEMA";

export default function ConfiguracoesPage() {
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  if (role !== "master") return <Navigate to="/app" replace />;

  const handleReset = async () => {
    if (confirm !== PHRASE) {
      toast.error(`Digite exatamente: ${PHRASE}`);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("reset-system", {
      body: { confirm: PHRASE },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message ?? "Falha ao resetar o sistema");
      return;
    }
    const result = data as any;
    if (!result?.success) {
      toast.error(result?.step ? `${result.step}: ${result?.error ?? "falha no reset"}` : result?.error ?? "Falha ao resetar o sistema");
      return;
    }
    toast.success(`Sistema resetado. Usuários removidos: ${result?.deleted?.usuarios_auth ?? result?.deleted?.usuarios ?? 0}`);
    setOpen(false);
    setConfirm("");
    localStorage.removeItem("master_scope_sala_id");
    setTimeout(() => window.location.assign("/app"), 800);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" description="Configurações avançadas do sistema." />

      <Card className="p-6 border-destructive/40 bg-destructive/5">
        <div className="flex items-start gap-4">
          <div className="size-10 rounded-md bg-destructive/15 grid place-items-center text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-display text-lg font-semibold text-destructive">Zona de Perigo · Resetar Sistema</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Esta ação apaga <strong>todas</strong> as salas, usuários (exceto Masters), produtos, categorias, estoques,
              requisições, empréstimos, dívidas, mensagens, conversas e movimentações. <strong>Não pode ser desfeito.</strong>
              Use apenas em ambiente de testes.
            </p>
            <Button variant="destructive" className="mt-4" onClick={() => setOpen(true)}>
              Resetar sistema
            </Button>
          </div>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={(v) => { if (!loading) { setOpen(v); if (!v) setConfirm(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="size-5" /> Confirmação obrigatória
            </DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Esta ação apagará permanentemente: salas, usuários (exceto Masters), produtos, categorias,
                requisições, empréstimos, dívidas, mensagens, conversas, notificações e movimentações.
              </span>
              <span className="block font-medium text-foreground">A ação NÃO poderá ser desfeita.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Para confirmar, digite: <span className="font-mono text-destructive">{PHRASE}</span></Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={PHRASE}
              autoFocus
              disabled={loading}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={handleReset}
              disabled={loading || confirm !== PHRASE}
            >
              {loading ? <><Loader2 className="size-4 animate-spin" /> Resetando…</> : "Confirmar reset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
