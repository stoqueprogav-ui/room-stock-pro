import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { Boxes, Package, Inbox, ArrowLeftRight, Trash2, History as HistoryIcon } from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

const COLORS = ["hsl(var(--primary))","hsl(var(--accent))","hsl(var(--warning))","hsl(var(--success))","hsl(var(--destructive))","hsl(var(--secondary-foreground))"];

function fromDays(d: number) {
  const date = new Date(); date.setDate(date.getDate() - d); return date.toISOString();
}

export default function DashboardGerencial() {
  const [periodo, setPeriodo] = useState("30");
  const [kpis, setKpis] = useState({ produtos: 0, unidadesEstoque: 0, movMes: 0, reqMes: 0, empAtivos: 0, consumosMes: 0 });
  const [valorizacao, setValorizacao] = useState<{ produtos_valorizados: number; produtos_sem_valor: number; produtos_total: number; percentual_valorizado: number; itens_valorizados: number; itens_sem_valor: number; patrimonio_total: number } | null>(null);
  const [salaConsumo, setSalaConsumo] = useState<{ name: string; value: number }[]>([]);
  const [catConsumo, setCatConsumo] = useState<{ name: string; value: number }[]>([]);
  const [reqPeriodo, setReqPeriodo] = useState<{ data: string; total: number }[]>([]);
  const [empPeriodo, setEmpPeriodo] = useState<{ data: string; total: number }[]>([]);
  const [consPeriodo, setConsPeriodo] = useState<{ data: string; total: number }[]>([]);
  const [topProds, setTopProds] = useState<{ name: string; value: number }[]>([]);

  const reload = useCallback(async () => {
    const days = parseInt(periodo, 10);
    const since = fromDays(days);

    const [prods, estoque, mov, req, emp, cons] = await Promise.all([
      supabase.from("produtos").select("id", { count: "exact", head: true }).eq("ativo", true),
      supabase.from("estoque").select("quantidade"),
      supabase.from("movimentacoes").select("id", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("solicitacoes").select("id, created_at").gte("created_at", since),
      supabase.from("emprestimos").select("id, created_at, status"),
      supabase.from("consumos_internos")
        .select("id, created_at, quantidade, motivo, sala:salas(nome), produto:produtos(nome, categoria:categorias(nome))")
        .gte("created_at", since),
    ]);

    const unidades = ((estoque.data as any[]) ?? []).reduce((s, r) => s + (r.quantidade ?? 0), 0);
    const consData = (cons.data as any[]) ?? [];

    setKpis({
      produtos: prods.count ?? 0,
      unidadesEstoque: unidades,
      movMes: mov.count ?? 0,
      reqMes: ((req.data as any[]) ?? []).length,
      empAtivos: ((emp.data as any[]) ?? []).filter((e) => e.status === "aprovado" || e.status === "pendente").length,
      consumosMes: consData.length,
    });

    // consumo por sala
    const bySala = new Map<string, number>();
    const byCat = new Map<string, number>();
    const byProd = new Map<string, number>();
    const byDayCons = new Map<string, number>();
    for (const c of consData) {
      const sala = c.sala?.nome ?? "—";
      bySala.set(sala, (bySala.get(sala) ?? 0) + c.quantidade);
      const cat = c.produto?.categoria?.nome ?? "Sem categoria";
      byCat.set(cat, (byCat.get(cat) ?? 0) + c.quantidade);
      const prod = c.produto?.nome ?? "—";
      byProd.set(prod, (byProd.get(prod) ?? 0) + c.quantidade);
      const dia = (c.created_at as string).slice(0, 10);
      byDayCons.set(dia, (byDayCons.get(dia) ?? 0) + c.quantidade);
    }
    setSalaConsumo([...bySala.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8));
    setCatConsumo([...byCat.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8));
    setTopProds([...byProd.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10));

    // req e emp por dia
    const reqDay = new Map<string, number>();
    for (const r of ((req.data as any[]) ?? [])) {
      const d = (r.created_at as string).slice(0, 10);
      reqDay.set(d, (reqDay.get(d) ?? 0) + 1);
    }
    const empSince = ((emp.data as any[]) ?? []).filter((e) => new Date(e.created_at) >= new Date(since));
    const empDay = new Map<string, number>();
    for (const e of empSince) {
      const d = (e.created_at as string).slice(0, 10);
      empDay.set(d, (empDay.get(d) ?? 0) + 1);
    }
    const days7 = [...Array(days)].map((_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (days - 1 - i));
      return d.toISOString().slice(0, 10);
    });
    setReqPeriodo(days7.map((d) => ({ data: d.slice(5), total: reqDay.get(d) ?? 0 })));
    setEmpPeriodo(days7.map((d) => ({ data: d.slice(5), total: empDay.get(d) ?? 0 })));
    setConsPeriodo(days7.map((d) => ({ data: d.slice(5), total: byDayCons.get(d) ?? 0 })));
  }, [periodo]);

  useEffect(() => { reload(); }, [reload]);
  useRealtimeSync(["movimentacoes", "consumos_internos", "solicitacoes", "emprestimos", "estoque", "produtos"], reload, { debounceMs: 400 });

  const kpiCards = useMemo(() => [
    { label: "Produtos cadastrados", value: kpis.produtos, icon: Package, color: "text-primary" },
    { label: "Unidades em estoque", value: kpis.unidadesEstoque, icon: Boxes, color: "text-accent" },
    { label: `Movimentações (${periodo}d)`, value: kpis.movMes, icon: HistoryIcon, color: "text-warning" },
    { label: `Requisições (${periodo}d)`, value: kpis.reqMes, icon: Inbox, color: "text-warning" },
    { label: "Empréstimos ativos", value: kpis.empAtivos, icon: ArrowLeftRight, color: "text-primary" },
    { label: `Consumos internos (${periodo}d)`, value: kpis.consumosMes, icon: Trash2, color: "text-destructive" },
  ], [kpis, periodo]);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard Gerencial" description="Visão executiva consolidada de consumo, requisições e empréstimos." actions={
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Período</Label>
          <Select value={periodo} onValueChange={setPeriodo}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Últimos 7 dias</SelectItem>
              <SelectItem value="30">Últimos 30 dias</SelectItem>
              <SelectItem value="90">Últimos 90 dias</SelectItem>
              <SelectItem value="365">Último ano</SelectItem>
            </SelectContent>
          </Select>
        </div>
      } />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {kpiCards.map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="p-4 flex items-start justify-between">
            <div>
              <div className="text-sm text-muted-foreground">{label}</div>
              <div className="font-display text-3xl font-bold mt-1">{value}</div>
            </div>
            <div className={`size-10 rounded-md bg-muted grid place-items-center ${color}`}><Icon className="size-5" /></div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-2">Consumo interno por sala</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={salaConsumo}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-2">Consumo interno por categoria</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={catConsumo} dataKey="value" nameKey="name" outerRadius={90} label>
                {catConsumo.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-2">Requisições por período</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={reqPeriodo}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--warning))" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-2">Empréstimos por período</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={empPeriodo}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--primary))" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h3 className="font-semibold mb-2">Consumo interno por período</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={consPeriodo}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Line type="monotone" dataKey="total" stroke="hsl(var(--destructive))" />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h3 className="font-semibold mb-2">Top produtos consumidos</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={topProds} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="name" type="category" width={150} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="hsl(var(--accent))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
