import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import WelcomeAlerts from "@/components/WelcomeAlerts";
import { Card } from "@/components/ui/card";
import { Boxes, AlertTriangle, Inbox, ArrowLeftRight, Wallet } from "lucide-react";

export default function SalaOverview() {
  const { profile, role } = useAuth();
  const [s, setS] = useState<any>(null);

  const reload = useCallback(async () => {
    if (!profile?.sala_id) return;
    const sala = profile.sala_id;
    const [est, sol, emp, div] = await Promise.all([
      supabase.from("estoque").select("quantidade, produtos!inner(estoque_minimo, nome, ativo)").eq("sala_id", sala).eq("produtos.ativo", true),
      supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("sala_id", sala).eq("status", "pendente"),
      supabase.from("emprestimos").select("id, sala_origem_id, status").or(`sala_origem_id.eq.${sala},sala_destino_id.eq.${sala}`).eq("status", "pendente"),
      supabase.from("dividas").select("id", { count: "exact", head: true }).or(`sala_devedora_id.eq.${sala},sala_credora_id.eq.${sala}`),
    ]);
    const baixo = (est.data ?? []).filter((r: any) => r.quantidade <= r.produtos.estoque_minimo).length;
    const aprovar = (emp.data ?? []).filter((e: any) => e.sala_origem_id === sala).length;
    setS({
      produtos: (est.data ?? []).length,
      baixo,
      solicitacoesPendentes: sol.count ?? 0,
      emprestimosAprovar: aprovar,
      dividas: div.count ?? 0,
    });
  }, [profile?.sala_id]);

  useEffect(() => { reload(); }, [reload]);

  useRealtimeSync(
    ["estoque", "produtos", "solicitacoes", "emprestimos", "dividas", "movimentacoes"],
    reload,
    { debounceMs: 300 }
  );

  if (!profile?.sala_id) return <div className="text-muted-foreground">Sua conta não tem sala vinculada.</div>;

  const cards = [
    { label: "Itens no estoque", value: s?.produtos ?? "…", icon: Boxes },
    { label: "Estoque baixo", value: s?.baixo ?? "…", icon: AlertTriangle, danger: true },
    { label: "Requisições pendentes", value: s?.solicitacoesPendentes ?? "…", icon: Inbox },
    ...(role === "admin" ? [{ label: "Empréstimos a aprovar", value: s?.emprestimosAprovar ?? "…", icon: ArrowLeftRight }] : []),
    { label: "Dívidas envolvendo a sala", value: s?.dividas ?? "…", icon: Wallet },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Painel da Sala — Visão Geral" description={`Olá, ${profile.nome.split(" ")[0]} — visão geral da sua sala.`} />
      <WelcomeAlerts />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(({ label, value, icon: Icon, danger }) => (
          <Card key={label} className="stat-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="font-display text-3xl font-bold mt-1">{value}</div>
              </div>
              <div className={`size-10 rounded-md grid place-items-center ${danger ? "bg-destructive/10 text-destructive" : "bg-muted text-primary"}`}>
                <Icon className="size-5" />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
