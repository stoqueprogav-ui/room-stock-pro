import { useEffect, useMemo, useRef, useState } from "react";
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
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";
import {
  Building2, Globe2, Package, DollarSign, TrendingUp, Crown, Layers,
  ArrowLeftRight, FileDown, FileSpreadsheet, Printer,
} from "lucide-react";
import { exportToExcel, exportReportPdf, printReport, exportExecutiveExcel, exportExecutivePdf, type ExportColumn } from "@/lib/exporters";
import { Button } from "@/components/ui/button";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string; custo_unitario: number | null; categoria_id: string | null };

type ConsumoRow = {
  produto_id: string; produto_nome: string;
  categoria_id: string | null; categoria_nome: string | null;
  sala_id: string; sala_nome: string;
  quantidade: number;
  custo_unitario: number;
  valor: number;
};

type EmpSalaRow = {
  sala_id: string; sala_nome: string;
  emprestados_unidades: number; recebidos_unidades: number;
  emprestados_qtd: number; recebidos_qtd: number;
};

type EstoqueValorRow = {
  sala_id: string; sala_nome: string; total_itens: number; itens_sem_valor: number; valor_total: number;
};
type ValorizacaoStats = {
  produtos_valorizados: number; produtos_sem_valor: number; produtos_total: number;
  percentual_valorizado: number; itens_valorizados: number; itens_sem_valor: number; patrimonio_total: number;
};

const PIE_COLORS = [
  "hsl(var(--primary))", "hsl(var(--accent))", "hsl(var(--warning))",
  "hsl(var(--success))", "hsl(var(--destructive))", "hsl(var(--secondary-foreground))",
  "#8b5cf6", "#06b6d4", "#f97316", "#84cc16",
];

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const NUM = (v: number) => v.toLocaleString("pt-BR");
const PCT = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}
function monthKey(iso: string) {
  return iso.slice(0, 7); // YYYY-MM
}

export default function RelatoriosPage() {
  const { scopeSalaId } = useMasterScope();
  const { profile } = useAuth();
  const { logoUrl } = useCompanyLogo();
  const isGlobal = scopeSalaId === null;

  // Filtros globais
  const [periodo, setPeriodo] = useState("30");
  const [salaFilter, setSalaFilter] = useState<string>("all");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("all");
  const [produtoFilter, setProdutoFilter] = useState<string>("all");

  // Dados base
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [consumo, setConsumo] = useState<ConsumoRow[]>([]);
  
  const [movMensalRaw, setMovMensalRaw] = useState<{ created_at: string; quantidade: number; tipo: string; produto_id: string; sala_id: string }[]>([]);
  const [empSalas, setEmpSalas] = useState<EmpSalaRow[]>([]);
  const [empStatus, setEmpStatus] = useState<{ status: string; count: number }[]>([]);
  const [estoqueValor, setEstoqueValor] = useState<EstoqueValorRow[]>([]);
  const [valorizacao, setValorizacao] = useState<ValorizacaoStats | null>(null);
  const [reqPorSala, setReqPorSala] = useState<{ sala_id: string; sala_nome: string; total: number }[]>([]);
  const [empMensal, setEmpMensal] = useState<{ mes: string; count: number }[]>([]);

  useEffect(() => {
    setSalaFilter(scopeSalaId ?? "all");
  }, [scopeSalaId]);

  // Bases (salas, categorias, produtos, valor estoque, emp por sala)
  useEffect(() => {
    (async () => {
      const [ss, cc, pp, ev, es] = await Promise.all([
        supabase.from("salas").select("id, nome").order("nome"),
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("produtos").select("id, nome, custo_unitario, categoria_id").order("nome"),
        supabase.rpc("valor_estoque_por_sala"),
        supabase.rpc("relatorio_emprestimos_salas"),
      ]);
      setSalas((ss.data as Sala[]) ?? []);
      setCategorias((cc.data as Categoria[]) ?? []);
      setProdutos((pp.data as Produto[]) ?? []);
      setEstoqueValor((ev.data as EstoqueValorRow[]) ?? []);
      setEmpSalas((es.data as EmpSalaRow[]) ?? []);
    })();
  }, []);

  // Consumo filtrado
  useEffect(() => {
    (async () => {
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      const { data } = await supabase.rpc("relatorio_consumo", {
        _from: desde,
        _to: null,
        _sala: efetivaSala,
        _categoria: categoriaFilter === "all" ? null : categoriaFilter,
        _produto: produtoFilter === "all" ? null : produtoFilter,
      });
      setConsumo((data as ConsumoRow[]) ?? []);
    })();
  }, [periodo, salaFilter, categoriaFilter, produtoFilter, scopeSalaId, isGlobal]);

  // Evolução mensal — últimos 12 meses (apenas filtros sala/categoria/produto, sem período)
  useEffect(() => {
    (async () => {
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const desde = isoDaysAgo(365);

      let q = supabase
        .from("movimentacoes")
        .select("created_at, quantidade, tipo, produto_id, sala_id")
        .gte("created_at", desde)
        .lt("quantidade", 0)
        .in("tipo", ["consumo_interno", "solicitacao", "emprestimo_saida", "ajuste"])
        .limit(50000);
      if (efetivaSala) q = q.eq("sala_id", efetivaSala);
      if (produtoFilter !== "all") q = q.eq("produto_id", produtoFilter);
      const { data } = await q;
      setMovMensalRaw((data as any) ?? []);

      // emprestimos mensal
      let qe = supabase.from("emprestimos").select("created_at").gte("created_at", desde).limit(50000);
      if (efetivaSala) qe = qe.or(`sala_origem_id.eq.${efetivaSala},sala_destino_id.eq.${efetivaSala}`);
      const { data: edata } = await qe;
      const mapE = new Map<string, number>();
      ((edata as any[]) ?? []).forEach((r) => {
        const k = monthKey(r.created_at);
        mapE.set(k, (mapE.get(k) ?? 0) + 1);
      });
      setEmpMensal(Array.from(mapE.entries()).sort().map(([mes, count]) => ({ mes, count })));
    })();
  }, [salaFilter, produtoFilter, scopeSalaId, isGlobal]);

  // Empréstimos status counts
  useEffect(() => {
    (async () => {
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const statuses = ["pendente", "aprovado", "rejeitado", "arquivado"];
      const results = await Promise.all(
        statuses.map(async (st) => {
          let q = supabase.from("emprestimos").select("id", { count: "exact", head: true }).eq("status", st as any);
          if (efetivaSala) q = q.or(`sala_origem_id.eq.${efetivaSala},sala_destino_id.eq.${efetivaSala}`);
          const { count } = await q;
          return { status: st, count: count ?? 0 };
        })
      );
      setEmpStatus(results);
    })();
  }, [salaFilter, scopeSalaId, isGlobal]);

  // Requisições por sala
  useEffect(() => {
    (async () => {
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      let q = supabase.from("solicitacoes").select("sala_id").limit(50000);
      if (desde) q = q.gte("created_at", desde);
      const { data } = await q;
      const map = new Map<string, number>();
      ((data as any[]) ?? []).forEach((r) => map.set(r.sala_id, (map.get(r.sala_id) ?? 0) + 1));
      const arr = Array.from(map.entries())
        .map(([sala_id, total]) => ({ sala_id, sala_nome: salas.find((s) => s.id === sala_id)?.nome ?? "—", total }))
        .sort((a, b) => b.total - a.total);
      setReqPorSala(arr);
    })();
  }, [periodo, salas]);

  // ===== Derivados =====

  // Por produto (agregado entre salas)
  const consumoPorProduto = useMemo(() => {
    const map = new Map<string, { produto_id: string; produto: string; categoria: string; qtd: number; valor: number; custo: number }>();
    consumo.forEach((c) => {
      const k = c.produto_id;
      const cur = map.get(k) ?? { produto_id: c.produto_id, produto: c.produto_nome, categoria: c.categoria_nome ?? "—", qtd: 0, valor: 0, custo: c.custo_unitario };
      cur.qtd += Number(c.quantidade); cur.valor += Number(c.valor);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.qtd - a.qtd);
  }, [consumo]);

  const consumoPorSala = useMemo(() => {
    const map = new Map<string, { sala_id: string; sala: string; qtd: number; valor: number }>();
    consumo.forEach((c) => {
      const k = c.sala_id;
      const cur = map.get(k) ?? { sala_id: c.sala_id, sala: c.sala_nome, qtd: 0, valor: 0 };
      cur.qtd += Number(c.quantidade); cur.valor += Number(c.valor);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [consumo]);

  const consumoPorCategoria = useMemo(() => {
    const map = new Map<string, { cat: string; qtd: number; valor: number }>();
    consumo.forEach((c) => {
      const k = c.categoria_nome ?? "Sem categoria";
      const cur = map.get(k) ?? { cat: k, qtd: 0, valor: 0 };
      cur.qtd += Number(c.quantidade); cur.valor += Number(c.valor);
      map.set(k, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.valor - a.valor);
  }, [consumo]);

  const totalQtd = consumoPorProduto.reduce((s, x) => s + x.qtd, 0);
  const totalValor = consumoPorProduto.reduce((s, x) => s + x.valor, 0);

  // Curva ABC
  const curvaABC = useMemo(() => {
    const sorted = [...consumoPorProduto].filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
    const total = sorted.reduce((s, x) => s + x.valor, 0) || 1;
    let acc = 0;
    return sorted.map((p) => {
      acc += p.valor;
      const partAcc = acc / total;
      const classe = partAcc <= 0.8 ? "A" : partAcc <= 0.95 ? "B" : "C";
      return { ...p, participacao: p.valor / total, acumulado: partAcc, classe };
    });
  }, [consumoPorProduto]);

  // Evolução mensal
  const evolucaoMensal = useMemo(() => {
    const map = new Map<string, { qtd: number; valor: number }>();
    movMensalRaw.forEach((m) => {
      const k = monthKey(m.created_at);
      const qty = Math.abs(m.quantidade);
      const prod = produtos.find((p) => p.id === m.produto_id);
      const val = qty * Number(prod?.custo_unitario ?? 0);
      const cur = map.get(k) ?? { qtd: 0, valor: 0 };
      cur.qtd += qty; cur.valor += val;
      map.set(k, cur);
    });
    return Array.from(map.entries()).sort().map(([mes, v]) => ({ mes, ...v }));
  }, [movMensalRaw, produtos]);

  // Top líderes (para indicadores executivos)
  const topProduto = consumoPorProduto[0];
  const topSala = consumoPorSala[0];
  const topCategoria = consumoPorCategoria[0];
  const consumoMesAtual = useMemo(() => {
    const k = new Date().toISOString().slice(0, 7);
    return evolucaoMensal.find((m) => m.mes === k)?.valor ?? 0;
  }, [evolucaoMensal]);
  const valorTotalEstoque = estoqueValor.reduce((s, x) => s + Number(x.valor_total), 0);
  const salaMaiorEstoque = [...estoqueValor].sort((a, b) => b.valor_total - a.valor_total)[0];

  // Comparativo: matriz produto x sala (top 10 produtos por qtd)
  const comparativo = useMemo(() => {
    const top = consumoPorProduto.slice(0, 10).map((p) => p.produto_id);
    const matriz: { produto: string; [sala: string]: any }[] = [];
    top.forEach((pid) => {
      const row: any = { produto: consumoPorProduto.find((p) => p.produto_id === pid)!.produto };
      salas.forEach((s) => {
        const r = consumo.find((c) => c.produto_id === pid && c.sala_id === s.id);
        row[s.nome] = r ? Number(r.quantidade) : 0;
      });
      matriz.push(row);
    });
    return matriz;
  }, [consumo, consumoPorProduto, salas]);

  // ===== Resumo executivo (cabeçalho dos relatórios) =====
  const periodoLabel = periodo === "all" ? "todo o período" : `últimos ${periodo} dias`;
  const subtitle = `Período: ${periodoLabel} · ${isGlobal && salaFilter === "all" ? "Todas as salas" : salas.find((s) => s.id === (isGlobal ? salaFilter : scopeSalaId))?.nome ?? ""}`;

  // ===== Exportação genérica =====
  const exportar = async <T extends Record<string, any>>(
    nome: string, cols: ExportColumn<T>[], rows: T[], formato: "xlsx" | "pdf" | "print",
  ) => {
    const meta = { title: nome, subtitle, companyName: "Estoque Pro", logoUrl, user: profile?.nome ?? null };
    if (formato === "xlsx") exportToExcel(nome, cols, rows);
    else if (formato === "pdf") await exportReportPdf(nome, cols, rows, meta);
    else printReport(cols, rows, meta);
  };

  // ===== Resumo Executivo (Dashboard) =====
  const chart1Ref = useRef<HTMLDivElement>(null);
  const chart2Ref = useRef<HTMLDivElement>(null);
  const chart3Ref = useRef<HTMLDivElement>(null);
  const [execLoading, setExecLoading] = useState(false);

  const kpisExec = [
    { label: "Valor total em estoque", value: BRL(valorTotalEstoque) },
    { label: "Consumo do mês (R$)", value: BRL(consumoMesAtual) },
    { label: "Valor consumido no período", value: BRL(totalValor) },
    { label: "Quantidade consumida", value: NUM(totalQtd) },
    { label: "Sala líder em consumo", value: topSala ? `${topSala.sala} — ${BRL(topSala.valor)}` : "—" },
    { label: "Produto mais consumido", value: topProduto ? `${topProduto.produto} (${NUM(topProduto.qtd)} un.)` : "—" },
    { label: "Categoria líder", value: topCategoria ? `${topCategoria.cat} — ${BRL(topCategoria.valor)}` : "—" },
    { label: "Maior estoque financeiro", value: salaMaiorEstoque ? `${salaMaiorEstoque.sala_nome} — ${BRL(Number(salaMaiorEstoque.valor_total))}` : "—" },
  ];

  const exportarExecutivoXLSX = () => {
    exportExecutiveExcel(
      "resumo_executivo",
      [
        { name: "Consumo por Sala", columns: [
          { header: "Sala", key: "sala" },
          { header: "Quantidade", key: "qtd" },
          { header: "Valor (R$)", key: "valor", map: (r: any) => Number(r.valor).toFixed(2) },
        ], rows: consumoPorSala },
        { name: "Top Produtos", columns: [
          { header: "Produto", key: "produto" },
          { header: "Categoria", key: "categoria" },
          { header: "Quantidade", key: "qtd" },
          { header: "Valor (R$)", key: "valor", map: (r: any) => Number(r.valor).toFixed(2) },
        ], rows: consumoPorProduto.slice(0, 50) },
        { name: "Categorias", columns: [
          { header: "Categoria", key: "cat" },
          { header: "Quantidade", key: "qtd" },
          { header: "Valor (R$)", key: "valor", map: (r: any) => Number(r.valor).toFixed(2) },
        ], rows: consumoPorCategoria },
        { name: "Valor de Estoque", columns: [
          { header: "Sala", key: "sala_nome" },
          { header: "Itens", key: "total_itens" },
          { header: "Valor (R$)", key: "valor_total", map: (r: any) => Number(r.valor_total).toFixed(2) },
        ], rows: estoqueValor },
      ],
      { title: "Resumo Executivo", subtitle, lines: kpisExec, user: profile?.nome ?? null, company: "Estoque Pro" },
    );
  };

  const exportarExecutivoPDF = async () => {
    setExecLoading(true);
    try {
      await exportExecutivePdf(
        "resumo_executivo",
        { title: "Resumo Executivo", subtitle, companyName: "Estoque Pro", logoUrl, user: profile?.nome ?? null, kpis: kpisExec },
        [
          { title: "Evolução mensal de consumo (R$)", element: chart1Ref.current },
          { title: "Evolução mensal de empréstimos", element: chart2Ref.current },
          { title: "Top 10 produtos consumidos (R$)", element: chart3Ref.current },
        ],
        [
          { name: "Consumo por Sala", columns: [
            { header: "Sala", key: "sala" },
            { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
            { header: "Valor", key: "valor", map: (r: any) => BRL(r.valor) },
          ], rows: consumoPorSala },
          { name: "Top Produtos", columns: [
            { header: "Produto", key: "produto" },
            { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
            { header: "Valor", key: "valor", map: (r: any) => BRL(r.valor) },
          ], rows: consumoPorProduto.slice(0, 30) },
        ],
      );
    } finally { setExecLoading(false); }
  };



  return (
    <div className="space-y-6">
      <PageHeader
        title="Central Analítica"
        description="Inteligência operacional, financeira e estratégica do estoque."
      />

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isGlobal
          ? <><Globe2 className="size-3.5 text-primary" /> Visão global.</>
          : <><Building2 className="size-3.5 text-primary" /> Filtrado pela sala em foco.</>}
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
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
            <Label className="text-xs">Categoria</Label>
            <Select value={categoriaFilter} onValueChange={setCategoriaFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
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

      {/* Indicadores executivos */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={DollarSign} label="Valor total em estoque" value={BRL(valorTotalEstoque)} accent="text-primary" />
        <KpiCard icon={TrendingUp} label="Consumo do mês (R$)" value={BRL(consumoMesAtual)} accent="text-warning" />
        <KpiCard icon={Package} label="Valor consumido (período)" value={BRL(totalValor)} accent="text-accent" />
        <KpiCard icon={Crown} label="Sala líder em consumo" value={topSala?.sala ?? "—"} sub={topSala ? BRL(topSala.valor) : ""} accent="text-success" />
        <KpiCard icon={Crown} label="Produto mais consumido" value={topProduto?.produto ?? "—"} sub={topProduto ? `${NUM(topProduto.qtd)} un.` : ""} accent="text-primary" />
        <KpiCard icon={Layers} label="Categoria líder" value={topCategoria?.cat ?? "—"} sub={topCategoria ? BRL(topCategoria.valor) : ""} accent="text-accent" />
        <KpiCard icon={Building2} label="Maior estoque financeiro" value={salaMaiorEstoque?.sala_nome ?? "—"} sub={salaMaiorEstoque ? BRL(Number(salaMaiorEstoque.valor_total)) : ""} accent="text-warning" />
        <KpiCard icon={ArrowLeftRight} label="Empréstimos pendentes" value={empStatus.find((e) => e.status === "pendente")?.count ?? 0} accent="text-destructive" />
      </div>

      <Tabs defaultValue="dashboard">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="emprestimos">Empréstimos</TabsTrigger>
          <TabsTrigger value="ranking">Rankings</TabsTrigger>
          <TabsTrigger value="consumo-sala">Consumo por sala</TabsTrigger>
          <TabsTrigger value="top-produtos">Top produtos</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="estoque">Valor de estoque</TabsTrigger>
        </TabsList>

        {/* ===== DASHBOARD ===== */}
        <TabsContent value="dashboard" className="mt-4 space-y-4">
          <Card className="p-3 flex flex-wrap items-center gap-2 justify-between">
            <div className="text-sm font-medium">Resumo Executivo — exporte um relatório completo com KPIs, gráficos e tabelas</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportarExecutivoXLSX}>
                <FileSpreadsheet className="size-4 mr-1.5" /> Excel executivo
              </Button>
              <Button size="sm" onClick={exportarExecutivoPDF} disabled={execLoading}>
                <FileDown className="size-4 mr-1.5" /> {execLoading ? "Gerando PDF…" : "PDF executivo"}
              </Button>
            </div>
          </Card>
          <div className="grid lg:grid-cols-2 gap-4">
            <div ref={chart1Ref}>
              <ChartCard title="Evolução mensal de consumo (R$)">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={evolucaoMensal}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: any) => BRL(Number(v))} />
                    <Line type="monotone" dataKey="valor" stroke="hsl(var(--primary))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
            <div ref={chart2Ref}>
              <ChartCard title="Evolução mensal de empréstimos">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={empMensal}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="count" stroke="hsl(var(--accent))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          </div>
          <div ref={chart3Ref}>
            <ChartCard title="Top 10 produtos consumidos (R$)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={consumoPorProduto.slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="produto" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: any) => BRL(Number(v))} />
                  <Bar dataKey="valor" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        </TabsContent>


        {/* ===== EMPRÉSTIMOS ===== */}
        <TabsContent value="emprestimos" className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {empStatus.map((s) => (
              <KpiCard key={s.status} icon={ArrowLeftRight} label={`Empréstimos ${s.status}`} value={s.count} accent="text-primary" />
            ))}
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Salas que mais emprestam (unidades)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[...empSalas].sort((a, b) => b.emprestados_unidades - a.emprestados_unidades).slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sala_nome" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="emprestados_unidades" name="Emprestadas" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Salas que mais solicitam (unidades)">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={[...empSalas].sort((a, b) => b.recebidos_unidades - a.recebidos_unidades).slice(0, 10)}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="sala_nome" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="recebidos_unidades" name="Recebidas" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <TableCard
            title="Detalhamento por sala"
            cols={[
              { header: "Sala", key: "sala_nome" },
              { header: "Empréstimos feitos", key: "emprestados_qtd" },
              { header: "Unidades emprestadas", key: "emprestados_unidades" },
              { header: "Empréstimos recebidos", key: "recebidos_qtd" },
              { header: "Unidades recebidas", key: "recebidos_unidades" },
            ]}
            rows={empSalas}
            filename="emprestimos_por_sala"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== RANKINGS ===== */}
        <TabsContent value="ranking" className="mt-4 space-y-4">
          <RankCard title="Top 10 salas que mais requisitam" rows={reqPorSala.slice(0, 10).map((r) => ({ sala: r.sala_nome, total: r.total }))} valueLabel="Requisições" />
          <RankCard title="Top 10 salas com maior consumo (R$)" rows={consumoPorSala.slice(0, 10).map((r) => ({ sala: r.sala, total: r.valor }))} valueLabel="Valor" money />
          <RankCard title="Top 10 salas que mais pegam empréstimos" rows={[...empSalas].sort((a, b) => b.recebidos_qtd - a.recebidos_qtd).slice(0, 10).map((r) => ({ sala: r.sala_nome, total: r.recebidos_qtd }))} valueLabel="Empréstimos" />
          <RankCard title="Top 10 salas que mais emprestam" rows={[...empSalas].sort((a, b) => b.emprestados_qtd - a.emprestados_qtd).slice(0, 10).map((r) => ({ sala: r.sala_nome, total: r.emprestados_qtd }))} valueLabel="Empréstimos" />
          <RankCard title="Top 10 salas com maior custo operacional (R$)" rows={consumoPorSala.slice(0, 10).map((r) => ({ sala: r.sala, total: r.valor }))} valueLabel="Valor" money />
        </TabsContent>

        {/* ===== CONSUMO POR SALA ===== */}
        <TabsContent value="consumo-sala" className="mt-4">
          <TableCard
            title="Consumo por sala"
            cols={[
              { header: "Sala", key: "sala" },
              { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
              { header: "Valor (R$)", key: "valor", map: (r: any) => BRL(r.valor) },
              { header: "% global", key: "pct", map: (r: any) => PCT(totalValor > 0 ? r.valor / totalValor : 0) },
            ]}
            rows={consumoPorSala}
            filename="consumo_por_sala"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== TOP PRODUTOS ===== */}
        <TabsContent value="top-produtos" className="mt-4 space-y-4">
          <ChartCard title="Top 10 produtos mais consumidos">
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={consumoPorProduto.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="produto" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="qtd" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <TableCard
            title="Produtos mais consumidos"
            cols={[
              { header: "Produto", key: "produto" },
              { header: "Categoria", key: "categoria" },
              { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
              { header: "Valor (R$)", key: "valor", map: (r: any) => BRL(r.valor) },
              { header: "% global", key: "pct", map: (r: any) => PCT(totalValor > 0 ? r.valor / totalValor : 0) },
            ]}
            rows={consumoPorProduto.slice(0, 50)}
            filename="produtos_mais_consumidos"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== COMPARATIVO ===== */}
        <TabsContent value="comparativo" className="mt-4">
          <Card className="p-0 overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="text-sm font-medium">Comparativo entre salas (Top 10 produtos)</div>
              <ExportButtons
                onClick={(f) => exportar(
                  "comparativo_salas",
                  [{ header: "Produto", key: "produto" }, ...salas.map((s) => ({ header: s.nome, key: s.nome }))],
                  comparativo as any[], f,
                )}
              />
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    {salas.map((s) => <TableHead key={s.id} className="text-right">{s.nome}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparativo.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{row.produto}</TableCell>
                      {salas.map((s) => <TableCell key={s.id} className="text-right font-mono">{NUM(Number(row[s.nome] ?? 0))}</TableCell>)}
                    </TableRow>
                  ))}
                  {comparativo.length === 0 && <TableRow><TableCell colSpan={salas.length + 1} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ===== FINANCEIRO ===== */}
        <TabsContent value="financeiro" className="mt-4 space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <KpiCard icon={Package} label="Quantidade consumida" value={NUM(totalQtd)} accent="text-primary" />
            <KpiCard icon={DollarSign} label="Valor consumido" value={BRL(totalValor)} accent="text-warning" />
            <KpiCard icon={TrendingUp} label="Ticket médio (R$/un.)" value={BRL(totalQtd > 0 ? totalValor / totalQtd : 0)} accent="text-accent" />
          </div>
          <ChartCard title="Custo por sala (R$)">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={consumoPorSala}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sala" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Bar dataKey="valor" fill="hsl(var(--warning))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <TableCard
            title="Produtos que mais geram custo"
            cols={[
              { header: "Produto", key: "produto" },
              { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
              { header: "Valor (R$)", key: "valor", map: (r: any) => BRL(r.valor) },
            ]}
            rows={[...consumoPorProduto].sort((a, b) => b.valor - a.valor).slice(0, 10)}
            filename="produtos_maior_custo"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== CATEGORIAS ===== */}
        <TabsContent value="categorias" className="mt-4 space-y-4">
          <div className="grid lg:grid-cols-2 gap-4">
            <ChartCard title="Distribuição por categoria (R$)">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={consumoPorCategoria} dataKey="valor" nameKey="cat" cx="50%" cy="50%" outerRadius={110} label>
                    {consumoPorCategoria.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => BRL(Number(v))} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Quantidade por categoria">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={consumoPorCategoria}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cat" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="qtd" fill="hsl(var(--accent))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
          <TableCard
            title="Categorias — consumo"
            cols={[
              { header: "Categoria", key: "cat" },
              { header: "Quantidade", key: "qtd", map: (r: any) => NUM(r.qtd) },
              { header: "Valor (R$)", key: "valor", map: (r: any) => BRL(r.valor) },
              { header: "% global", key: "pct", map: (r: any) => PCT(totalValor > 0 ? r.valor / totalValor : 0) },
            ]}
            rows={consumoPorCategoria}
            filename="consumo_categorias"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== CURVA ABC ===== */}
        <TabsContent value="abc" className="mt-4">
          <TableCard
            title="Curva ABC — concentração de custo por produto"
            cols={[
              { header: "Produto", key: "produto" },
              { header: "Valor consumido", key: "valor", map: (r: any) => BRL(r.valor) },
              { header: "Participação", key: "participacao", map: (r: any) => PCT(r.participacao) },
              { header: "Acumulado", key: "acumulado", map: (r: any) => PCT(r.acumulado) },
              { header: "Classe", key: "classe" },
            ]}
            rows={curvaABC}
            filename="curva_abc"
            onExport={exportar}
          />
        </TabsContent>

        {/* ===== VALOR DE ESTOQUE ===== */}
        <TabsContent value="estoque" className="mt-4 space-y-4">
          <Card className="p-4">
            <div className="text-sm text-muted-foreground">Patrimônio total em estoque</div>
            <div className="text-3xl font-semibold text-primary mt-1">{BRL(valorTotalEstoque)}</div>
          </Card>
          <ChartCard title="Valor financeiro por sala (R$)">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={estoqueValor}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="sala_nome" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={70} interval={0} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: any) => BRL(Number(v))} />
                <Bar dataKey="valor_total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <TableCard
            title="Valor de estoque por sala"
            cols={[
              { header: "Sala", key: "sala_nome" },
              { header: "Itens", key: "total_itens", map: (r: any) => NUM(Number(r.total_itens)) },
              { header: "Valor (R$)", key: "valor_total", map: (r: any) => BRL(Number(r.valor_total)) },
            ]}
            rows={estoqueValor}
            filename="valor_estoque_por_sala"
            onExport={exportar}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ===== Helpers de UI =====

function KpiCard({ icon: Icon, label, value, sub, accent }: { icon: any; label: string; value: any; sub?: string; accent?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={`size-4 ${accent ?? ""}`} /> {label}
      </div>
      <div className={`text-2xl font-semibold mt-1 ${accent ?? ""}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-2">{title}</div>
      {children}
    </Card>
  );
}

function ExportButtons({ onClick }: { onClick: (f: "xlsx" | "pdf" | "print") => void }) {
  return (
    <div className="flex gap-1">
      <Button variant="outline" size="sm" onClick={() => onClick("xlsx")}><FileSpreadsheet className="size-4" /> Excel</Button>
      <Button variant="outline" size="sm" onClick={() => onClick("pdf")}><FileDown className="size-4" /> PDF</Button>
      <Button variant="outline" size="sm" onClick={() => onClick("print")}><Printer className="size-4" /> Imprimir</Button>
    </div>
  );
}

function TableCard<T extends Record<string, any>>({
  title, cols, rows, filename, onExport,
}: {
  title: string;
  cols: ExportColumn<T>[];
  rows: T[];
  filename: string;
  onExport: (nome: string, cols: ExportColumn<T>[], rows: T[], f: "xlsx" | "pdf" | "print") => void;
}) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium">{title}</div>
        <ExportButtons onClick={(f) => onExport(filename, cols, rows, f)} />
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c, i) => <TableHead key={i}>{c.header}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {cols.map((c, j) => (
                  <TableCell key={j} className={typeof (c.map ? c.map(r) : r[c.key as string]) === "number" ? "font-mono" : ""}>
                    {c.map ? c.map(r) : (r as any)[c.key]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={cols.length} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function RankCard({ title, rows, valueLabel, money }: { title: string; rows: { sala: string; total: number }[]; valueLabel: string; money?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <Card className="p-4">
      <div className="text-sm font-medium mb-3">{title}</div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[24px_1fr_auto] items-center gap-2">
            <Badge variant="outline" className="justify-center w-6 h-6 p-0 text-xs">{i + 1}</Badge>
            <div className="relative h-7 rounded bg-muted overflow-hidden">
              <div className="absolute inset-y-0 left-0 bg-primary/30" style={{ width: `${(r.total / max) * 100}%` }} />
              <div className="relative px-2 leading-7 text-sm">{r.sala}</div>
            </div>
            <div className="text-sm font-mono whitespace-nowrap">{money ? BRL(r.total) : NUM(r.total)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">Sem dados.</div>}
      </div>
    </Card>
  );
}
