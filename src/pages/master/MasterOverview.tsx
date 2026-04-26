import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Boxes, Building2, Inbox, ArrowLeftRight, AlertTriangle, Wallet } from "lucide-react";

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
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const [salas, prods, solP, empP, dividas, low] = await Promise.all([
        supabase.from("salas").select("id", { count: "exact", head: true }),
        supabase.from("produtos").select("id", { count: "exact", head: true }),
        supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        supabase.from("emprestimos").select("id", { count: "exact", head: true }).eq("status", "pendente"),
        supabase.from("dividas").select("id", { count: "exact", head: true }),
        supabase.from("estoque").select("quantidade, produtos!inner(estoque_minimo)"),
      ]);
      const lowCount = (low.data ?? []).filter((r: any) => r.quantidade <= r.produtos.estoque_minimo).length;
      setS({
        salas: salas.count ?? 0,
        produtos: prods.count ?? 0,
        solicitacoesPendentes: solP.count ?? 0,
        emprestimosPendentes: empP.count ?? 0,
        alertasEstoque: lowCount,
        dividas: dividas.count ?? 0,
      });
    })();
  }, []);

  const cards = [
    { label: "Salas ativas", value: s?.salas ?? "…", icon: Building2, color: "text-primary" },
    { label: "Produtos", value: s?.produtos ?? "…", icon: Boxes, color: "text-accent" },
    { label: "Solicitações pendentes", value: s?.solicitacoesPendentes ?? "…", icon: Inbox, color: "text-warning" },
    { label: "Empréstimos pendentes", value: s?.emprestimosPendentes ?? "…", icon: ArrowLeftRight, color: "text-warning" },
    { label: "Alertas de estoque baixo", value: s?.alertasEstoque ?? "…", icon: AlertTriangle, color: "text-destructive" },
    { label: "Dívidas em aberto", value: s?.dividas ?? "…", icon: Wallet, color: "text-primary" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`Olá, ${profile?.nome?.split(" ")[0] ?? "Master"}`} description="Visão consolidada de todo o sistema." />
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
