import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { Building2, Globe2, Package, Inbox, ArrowLeftRight, AlertTriangle, FileDown, FileSpreadsheet, ClipboardCheck, Trash2, LineChart as LineChartIcon } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { exportToExcel, exportToPdf } from "@/lib/exporters";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type Mov = {
  id: string; created_at: string; tipo: string; quantidade: number; saldo_apos: number;
  produto_id: string; sala_id: string;
  produto: { nome: string; unidade: string };
  sala: { nome: string };
  usuario: { nome: string } | null;
};
type Sala = { id: string; nome: string };
type Produto = { id: string; nome: string; estoque_minimo: number };

const TIPO_LABEL: Record<string, { label: string; cls: string }> = {
  solicitacao: { label: "Requisição", cls: "bg-warning/15 text-warning border-warning/30" },
  estorno: { label: "Estorno", cls: "bg-secondary text-secondary-foreground" },
  ajuste: { label: "Ajuste", cls: "bg-accent/15 text-accent border-accent/30" },
  emprestimo_saida: { label: "Emp. saída", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  emprestimo_entrada: { label: "Emp. entrada", cls: "bg-success/15 text-success border-success/30" },
  entrada: { label: "Entrada", cls: "bg-success/15 text-success border-success/30" },
  saida: { label: "Saída", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

const PIE_COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--accent))",
  "hsl(var(--warning))",
  "hsl(var(--success))",
  "hsl(var(--destructive))",
  "hsl(var(--secondary-foreground))",
];

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function RelatoriosPage() {
  const { scopeSalaId } = useMasterScope();
  const isGlobal = scopeSalaId === null;

  // filtros
  const [periodo, setPeriodo] = useState("30");
  const [salaFilter, setSalaFilter] = useState<string>("all");
  const [produtoFilter, setProdutoFilter] = useState<string>("all");

  const [movs, setMovs] = useState<Mov[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [criticos, setCriticos] = useState<{ produto: string; sala: string; qtd: number; min: number }[]>([]);
  const [totalReq, setTotalReq] = useState(0);
  const [totalEmp, setTotalEmp] = useState(0);
  const [dividas, setDividas] = useState<{ devedora: string; credora: string; produto: string; saldo: number }[]>([]);

  useEffect(() => {
    setSalaFilter(scopeSalaId ?? "all");
  }, [scopeSalaId]);

  useEffect(() => {
    (async () => {
      const [{ data: ss }, { data: pp }] = await Promise.all([
        supabase.from("salas").select("id, nome").order("nome"),
        supabase.from("produtos").select("id, nome, estoque_minimo").order("nome"),
      ]);
      setSalas((ss as Sala[]) ?? []);
      setProdutos((pp as Produto[]) ?? []);
    })();
  }, []);

  // Carregamento principal: movimentações + KPIs + dívidas
  useEffect(() => {
    (async () => {
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;

      // movimentações
      let q = supabase
        .from("movimentacoes")
        .select(`id, created_at, tipo, quantidade, saldo_apos, produto_id, sala_id,
                 produto:produtos(nome, unidade), sala:salas(nome),
                 usuario:profiles!movimentacoes_usuario_id_fkey(nome)`)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (desde) q = q.gte("created_at", desde);
      if (efetivaSala) q = q.eq("sala_id", efetivaSala);
      if (produtoFilter !== "all") q = q.eq("produto_id", produtoFilter);
      const { data } = await q;
      setMovs((data as any) ?? []);

      // contagens (KPIs)
      let qReq = supabase.from("solicitacoes").select("id", { count: "exact", head: true });
      if (desde) qReq = qReq.gte("created_at", desde);
      if (efetivaSala) qReq = qReq.eq("sala_id", efetivaSala);
      const { count: cReq } = await qReq;
      setTotalReq(cReq ?? 0);

      let qEmp = supabase.from("emprestimos").select("id", { count: "exact", head: true });
      if (desde) qEmp = qEmp.gte("created_at", desde);
      if (efetivaSala) qEmp = qEmp.or(`sala_origem_id.eq.${efetivaSala},sala_destino_id.eq.${efetivaSala}`);
      const { count: cEmp } = await qEmp;
      setTotalEmp(cEmp ?? 0);

      // estoque baixo
      let qEst = supabase
        .from("estoque")
        .select(`quantidade, produto:produtos(nome, estoque_minimo), sala:salas(nome), produto_id, sala_id`);
      if (efetivaSala) qEst = qEst.eq("sala_id", efetivaSala);
      const { data: estData } = await qEst;
      const cr = ((estData as any[]) ?? [])
        .filter((e) => e.produto && e.quantidade <= (e.produto.estoque_minimo ?? 0))
        .map((e) => ({ produto: e.produto.nome, sala: e.sala.nome, qtd: e.quantidade, min: e.produto.estoque_minimo }));
      setCriticos(cr);

      // dívidas
      let qDiv = supabase
        .from("dividas")
        .select(`saldo, produto:produtos(nome),
                 devedora:salas!dividas_sala_devedora_id_fkey(nome),
                 credora:salas!dividas_sala_credora_id_fkey(nome),
                 sala_devedora_id, sala_credora_id`);
      if (efetivaSala) qDiv = qDiv.or(`sala_devedora_id.eq.${efetivaSala},sala_credora_id.eq.${efetivaSala}`);
      const { data: divData } = await qDiv;
      setDividas(((divData as any[]) ?? []).map((d) => ({
        devedora: d.devedora?.nome ?? "—",
        credora: d.credora?.nome ?? "—",
        produto: d.produto?.nome ?? "—",
        saldo: d.saldo,
      })));
    })();
  }, [periodo, salaFilter, produtoFilter, scopeSalaId, isGlobal]);

  // KPIs derivados
  const consumoTotal = useMemo(
    () => movs
      .filter((m) => m.tipo === "solicitacao" || m.tipo === "emprestimo_saida" || m.tipo === "saida")
      .reduce((acc, m) => acc + Math.abs(m.quantidade), 0),
    [movs]
  );

  // Gráfico: top 10 produtos consumidos
  const topProdutos = useMemo(() => {
    const map = new Map<string, number>();
    movs
      .filter((m) => m.tipo === "solicitacao" || m.tipo === "emprestimo_saida" || m.tipo === "saida")
      .forEach((m) => map.set(m.produto.nome, (map.get(m.produto.nome) ?? 0) + Math.abs(m.quantidade)));
    return Array.from(map.entries())
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [movs]);

  // Gráfico: consumo por sala (barras)
  const consumoPorSala = useMemo(() => {
    const map = new Map<string, number>();
    movs
      .filter((m) => m.tipo === "solicitacao" || m.tipo === "emprestimo_saida" || m.tipo === "saida")
      .forEach((m) => map.set(m.sala.nome, (map.get(m.sala.nome) ?? 0) + Math.abs(m.quantidade)));
    return Array.from(map.entries())
      .map(([nome, total]) => ({ nome, total }))
      .sort((a, b) => b.total - a.total);
  }, [movs]);

  // Pizza: distribuição por produto (top 6 + outros)
  const distribuicaoProdutos = useMemo(() => {
    if (topProdutos.length === 0) return [];
    const top = topProdutos.slice(0, 6);
    const restante = topProdutos.slice(6).reduce((s, x) => s + x.total, 0);
    const arr = top.map((x) => ({ name: x.nome, value: x.total }));
    if (restante > 0) arr.push({ name: "Outros", value: restante });
    return arr;
  }, [topProdutos]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios avançados"
        description={isGlobal
          ? "Indicadores agregados de consumo, requisições, empréstimos e estoque baixo."
          : `Indicadores da sala em foco.`}
      />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isGlobal
          ? <><Globe2 className="size-3.5 text-primary" /> Visão global.</>
          : <><Building2 className="size-3.5 text-primary" /> Filtrado pela sala em foco.</>}
      </div>

      <Card className="p-4">
        <div className="text-sm font-medium mb-3">Central de Relatórios</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/app/inventario"><ClipboardCheck className="size-4" /> Inventário</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/consumo-interno"><Trash2 className="size-4" /> Consumo Interno</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/dashboard-gerencial"><LineChartIcon className="size-4" /> Dashboard Gerencial</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/auditoria"><AlertTriangle className="size-4" /> Auditoria</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/movimentacoes"><Package className="size-4" /> Movimentações</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/requisicoes"><Inbox className="size-4" /> Requisições</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/emprestimos"><ArrowLeftRight className="size-4" /> Empréstimos</Link></Button>
          <Button asChild variant="outline" size="sm"><Link to="/app/dividas"><AlertTriangle className="size-4" /> Dívidas</Link></Button>
        </div>
      </Card>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Período</Label>
            <Select value={periodo} onValueChange={setPeriodo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="180">Últimos 180 dias</SelectItem>
                <SelectItem value="365">Último ano</SelectItem>
                <SelectItem value="all">Tudo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sala</Label>
            <Select value={salaFilter} onValueChange={setSalaFilter} disabled={!isGlobal}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as salas</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Produto</Label>
            <Select value={produtoFilter} onValueChange={setProdutoFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os produtos</SelectItem>
                {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Package} label="Consumo total (un.)" value={consumoTotal} accent="text-primary" />
        <KpiCard icon={Inbox} label="Requisições" value={totalReq} accent="text-warning" />
        <KpiCard icon={ArrowLeftRight} label="Empréstimos" value={totalEmp} accent="text-accent" />
        <KpiCard icon={AlertTriangle} label="Itens em estoque baixo" value={criticos.length} accent="text-warning" />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="consumo">
        <TabsList>
          <TabsTrigger value="consumo">Consumo</TabsTrigger>
          <TabsTrigger value="distribuicao">Distribuição</TabsTrigger>
          <TabsTrigger value="dividas">Empréstimos &amp; dívidas</TabsTrigger>
          <TabsTrigger value="movs">Histórico</TabsTrigger>
          <TabsTrigger value="criticos">Estoque baixo</TabsTrigger>
        </TabsList>

        <TabsContent value="consumo" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="text-sm font-medium mb-2">Top 10 produtos mais consumidos</div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProdutos} margin={{ top: 8, right: 12, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="nome" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-15} textAnchor="end" height={60} />
                  <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {isGlobal && (
            <Card className="p-4">
              <div className="text-sm font-medium mb-2">Consumo por sala</div>
              <div className="h-72">
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
          )}
        </TabsContent>

        <TabsContent value="distribuicao" className="mt-4">
          <Card className="p-4">
            <div className="text-sm font-medium mb-2">Distribuição do consumo por produto</div>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribuicaoProdutos} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label>
                    {distribuicaoProdutos.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="dividas" className="mt-4">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 text-sm font-medium border-b border-border">Saldos de empréstimos não quitados</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sala devedora</TableHead>
                  <TableHead>Sala credora</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right w-[120px]">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dividas.map((d, i) => (
                  <TableRow key={i} className="table-row-hover">
                    <TableCell>{d.devedora}</TableCell>
                    <TableCell>{d.credora}</TableCell>
                    <TableCell>{d.produto}</TableCell>
                    <TableCell className="text-right font-mono">{d.saldo}</TableCell>
                  </TableRow>
                ))}
                {dividas.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">Sem dívidas em aberto.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="movs" className="mt-4">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 text-sm font-medium border-b border-border">Histórico de movimentações ({movs.length})</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[170px]">Quando</TableHead>
                    <TableHead className="w-[150px]">Tipo</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Sala</TableHead>
                    <TableHead className="text-right w-[90px]">Qtd.</TableHead>
                    <TableHead>Usuário</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movs.slice(0, 200).map((m) => {
                    const cfg = TIPO_LABEL[m.tipo] ?? { label: m.tipo, cls: "" };
                    return (
                      <TableRow key={m.id} className="table-row-hover">
                        <TableCell className="text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                        <TableCell><Badge variant="outline" className={cfg.cls}>{cfg.label}</Badge></TableCell>
                        <TableCell>{m.produto.nome}</TableCell>
                        <TableCell>{m.sala.nome}</TableCell>
                        <TableCell className={`text-right font-mono ${m.quantidade < 0 ? "text-destructive" : "text-success"}`}>
                          {m.quantidade > 0 ? "+" : ""}{m.quantidade}
                        </TableCell>
                        <TableCell>{m.usuario?.nome ?? "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                  {movs.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">Sem movimentações no período.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="criticos" className="mt-4">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 text-sm font-medium border-b border-border">Produtos no nível ou abaixo do estoque mínimo</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead className="text-right w-[120px]">Atual</TableHead>
                  <TableHead className="text-right w-[120px]">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {criticos.map((c, i) => (
                  <TableRow key={i} className="table-row-hover">
                    <TableCell>{c.produto}</TableCell>
                    <TableCell>{c.sala}</TableCell>
                    <TableCell className="text-right font-mono text-warning">{c.qtd}</TableCell>
                    <TableCell className="text-right font-mono">{c.min}</TableCell>
                  </TableRow>
                ))}
                {criticos.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">Nenhum item em estoque baixo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, accent }: { icon: any; label: string; value: number; accent: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-display font-bold mt-1">{value.toLocaleString("pt-BR")}</div>
        </div>
        <div className={`size-9 rounded-md bg-muted grid place-items-center ${accent}`}>
          <Icon className="size-5" />
        </div>
      </div>
    </Card>
  );
}
