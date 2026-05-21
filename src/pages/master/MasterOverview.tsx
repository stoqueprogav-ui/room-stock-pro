import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import WelcomeAlerts from "@/components/WelcomeAlerts";
import { Card } from "@/components/ui/card";
import { Boxes, Building2, Inbox, ArrowLeftRight, AlertTriangle, Wallet, Globe2 } from "lucide-react";
import type { Sala } from "@/lib/types";

type Stats = {
  salas: number;
  produtos: number;
  solicitacoesPendentes: number;
  emprestimosPendentes: number;
  alertasEstoque: number;
  dividas: number;
};

export default function MasterOverview() {
  const { profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const [s, setS] = useState<Stats | null>(null);
  const [salaNome, setSalaNome] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (scopeSalaId) {
      const { data } = await supabase.from("salas").select("nome").eq("id", scopeSalaId).maybeSingle();
      setSalaNome((data as Sala | null)?.nome ?? null);
    } else {
      setSalaNome(null);
    }

    const applySala = (q: any, col = "sala_id") => scopeSalaId ? q.eq(col, scopeSalaId) : q;
    const applySalaEmprestimo = (q: any) => scopeSalaId ? q.or(`sala_origem_id.eq.${scopeSalaId},sala_destino_id.eq.${scopeSalaId}`) : q;
    const applySalaDivida = (q: any) => scopeSalaId ? q.or(`sala_devedora_id.eq.${scopeSalaId},sala_credora_id.eq.${scopeSalaId}`) : q;

    const [salas, prods, solP, empP, dividas, low] = await Promise.all([
      supabase.from("salas").select("id", { count: "exact", head: true }),
      supabase.from("produtos").select("id", { count: "exact", head: true }).eq("ativo", true),
      applySala(supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "pendente")),
      applySalaEmprestimo(supabase.from("emprestimos").select("id", { count: "exact", head: true }).eq("status", "pendente")),
      applySalaDivida(supabase.from("dividas").select("id", { count: "exact", head: true })),
      applySala(supabase.from("estoque").select("quantidade, produtos!inner(estoque_minimo, ativo)").eq("produtos.ativo", true)),
    ]);
    const lowCount = (low.data ?? []).filter((r: any) => {
      const min = r.produtos.estoque_minimo ?? 0;
      return r.quantidade <= min;
    }).length;
    setS({
      salas: salas.count ?? 0,
      produtos: prods.count ?? 0,
      solicitacoesPendentes: solP.count ?? 0,
      emprestimosPendentes: empP.count ?? 0,
      alertasEstoque: lowCount,
      dividas: dividas.count ?? 0,
    });
  }, [scopeSalaId]);

  useEffect(() => { reload(); }, [reload]);

  // Sincronização em tempo real: qualquer alteração relevante recarrega o dashboard
  useRealtimeSync(
    ["estoque", "produtos", "solicitacoes", "emprestimos", "dividas", "salas", "movimentacoes"],
    reload,
    { debounceMs: 300 }
  );

  const isGlobal = scopeSalaId === null;

  const cards = [
    !isGlobal ? null : { label: "Salas ativas", value: s?.salas ?? "…", icon: Building2, color: "text-primary" },
    { label: "Produtos no catálogo", value: s?.produtos ?? "…", icon: Boxes, color: "text-accent" },
    { label: "Requisições pendentes", value: s?.solicitacoesPendentes ?? "…", icon: Inbox, color: "text-warning" },
    { label: "Empréstimos pendentes", value: s?.emprestimosPendentes ?? "…", icon: ArrowLeftRight, color: "text-warning" },
    { label: "Alertas de estoque baixo", value: s?.alertasEstoque ?? "…", icon: AlertTriangle, color: "text-destructive" },
    { label: "Dívidas em aberto", value: s?.dividas ?? "…", icon: Wallet, color: "text-primary" },
  ].filter(Boolean) as Array<{ label: string; value: any; icon: any; color: string }>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Olá, ${profile?.nome?.split(" ")[0] ?? "Master"}`}
        description={isGlobal
          ? "Visão consolidada de todo o sistema."
          : `Visão da sala: ${salaNome ?? "—"}`}
      />
      <WelcomeAlerts />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {isGlobal
          ? <><Globe2 className="size-4 text-primary" /> Modo global ativo — use o seletor no topo para entrar em uma sala específica.</>
          : <><Building2 className="size-4 text-primary" /> Sala em foco — use o seletor no topo para alternar ou voltar ao modo global.</>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="font-display text-3xl font-bold mt-1">{value}</div>
              </div>
              <div className={`size-10 rounded-md bg-muted grid place-items-center ${color}`}>
                <Icon className="size-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
