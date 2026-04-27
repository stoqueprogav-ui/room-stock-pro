import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { Building2, Globe2 } from "lucide-react";

type Mov = { produto_id: string; sala_id: string; tipo: string; quantidade: number; produto: { nome: string }; sala: { nome: string } };

export default function RelatoriosPage() {
  const { scopeSalaId } = useMasterScope();
  const [movs, setMovs] = useState<Mov[]>([]);
  const [salaNome, setSalaNome] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase
        .from("movimentacoes")
        .select(`produto_id, sala_id, tipo, quantidade, produto:produtos(nome), sala:salas(nome)`)
        .in("tipo", ["solicitacao", "emprestimo_saida"])
        .limit(2000)
        .order("created_at", { ascending: false });
      if (scopeSalaId) q = q.eq("sala_id", scopeSalaId);
      const { data } = await q;
      setMovs((data as any) ?? []);
      if (scopeSalaId) {
        const { data: s } = await supabase.from("salas").select("nome").eq("id", scopeSalaId).maybeSingle();
        setSalaNome((s as any)?.nome ?? null);
      } else {
        setSalaNome(null);
      }
    })();
  }, [scopeSalaId]);

  const consumoPorProduto = useMemo(() => {
    const map = new Map<string, number>();
    movs.forEach((m) => {
      const k = m.produto.nome;
      map.set(k, (map.get(k) ?? 0) + Math.abs(m.quantidade));
    });
    return Array.from(map.entries()).map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [movs]);

  const consumoPorSala = useMemo(() => {
    const map = new Map<string, number>();
    movs.forEach((m) => {
      const k = m.sala.nome;
      map.set(k, (map.get(k) ?? 0) + Math.abs(m.quantidade));
    });
    return Array.from(map.entries()).map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);
  }, [movs]);

  const isGlobal = scopeSalaId === null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        description={isGlobal
          ? "Indicadores agregados de consumo e movimentação (todas as salas)."
          : `Consumo da sala ${salaNome ?? "—"}.`}
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isGlobal
          ? <><Globe2 className="size-3.5 text-primary" /> Visão global.</>
          : <><Building2 className="size-3.5 text-primary" /> Filtrado pela sala em foco.</>}
      </div>
      <Tabs defaultValue="produtos">
        <TabsList>
          <TabsTrigger value="produtos">Produtos mais consumidos</TabsTrigger>
          {isGlobal && <TabsTrigger value="salas">Salas que mais consomem</TabsTrigger>}
        </TabsList>
        <TabsContent value="produtos" className="mt-4">
          <Card className="p-4">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumoPorProduto} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
        <TabsContent value="salas" className="mt-4">
          <Card className="p-4">
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={consumoPorSala} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="total" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
