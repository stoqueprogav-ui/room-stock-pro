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
import MovimentacaoFinanceiraTab from "./tabs/MovimentacaoFinanceiraTab";
import AvaliacaoPatrimonialPage from "./AvaliacaoPatrimonialPage";

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
  const { scopeSalaId, isSuperMode } = useMasterScope();
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
  
  const [evolucaoMensal, setEvolucaoMensal] = useState<{ mes: string; qtd: number; valor: number }[]>([]);
  const [empSalas, setEmpSalas] = useState<EmpSalaRow[]>([]);
  const [empStatus, setEmpStatus] = useState<{ status: string; count: number }[]>([]);
  const [estoqueValor, setEstoqueValor] = useState<EstoqueValorRow[]>([]);
  const [valorPatrimonial, setValorPatrimonial] = useState<number>(0);
  const [patTotais, setPatTotais] = useState<any | null>(null);
  const [pendValorAprox, setPendValorAprox] = useState<number>(0);
  const [valorizacao, setValorizacao] = useState<ValorizacaoStats | null>(null);
  const [reqPorSala, setReqPorSala] = useState<{ sala_id: string; sala_nome: string; total: number }[]>([]);
  const [empMensal, setEmpMensal] = useState<{ mes: string; count: number }[]>([]);
  const [consolidadoRegioes, setConsolidadoRegioes] = useState<{ regiao_id: string; regiao_nome: string; qtd: number; valorConsumo: number; valorEstoque: number }[]>([]);


  useEffect(() => {
    setSalaFilter(scopeSalaId ?? "all");
  }, [scopeSalaId]);

  // Bases (salas, categorias, produtos, valor estoque, emp por sala)
  useEffect(() => {
    (async () => {
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const [ss, cc, pp, ev, es, vz, pt, ps] = await Promise.all([
        supabase.from("salas").select("id, nome").order("nome"),
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("produtos").select("id, nome, custo_unitario, categoria_id").order("nome"),
        supabase.rpc("valor_estoque_por_sala"),
        supabase.rpc("relatorio_emprestimos_salas"),
        supabase.rpc("estatisticas_valorizacao"),
        (supabase as any).rpc("patrimonio_totais", { _sala: efetivaSala }),
        (supabase as any).rpc("produtos_sem_avaliacao", { _sala: efetivaSala }),
      ]);
      setSalas((ss.data as Sala[]) ?? []);
      setCategorias((cc.data as Categoria[]) ?? []);
      setProdutos((pp.data as Produto[]) ?? []);
      setEstoqueValor((ev.data as EstoqueValorRow[]) ?? []);
      setEmpSalas((es.data as EmpSalaRow[]) ?? []);
      const vzRow = Array.isArray(vz.data) ? (vz.data as any[])[0] : (vz.data as any);
      if (vzRow) setValorizacao(vzRow as ValorizacaoStats);
      const ptRow = Array.isArray(pt?.data) ? (pt.data as any[])[0] : (pt?.data as any);
      setValorPatrimonial(Number(ptRow?.valor_patrimonial ?? 0));
      setPatTotais(ptRow ?? null);
      const pendRows: any[] = (ps?.data as any[]) ?? [];
      setPendValorAprox(pendRows.reduce((s, r) => s + Number(r.valor_total_atual ?? (Number(r.quantidade ?? 0) * Number(r.custo_unitario_ref ?? 0))), 0));
    })();
  }, [salaFilter, scopeSalaId, isGlobal]);


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

  // Evolução mensal — RPC consumo_mensal (mesmos filtros do relatorio_consumo)
  useEffect(() => {
    (async () => {
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      const { data } = await (supabase as any).rpc("consumo_mensal", {
        _from: desde,
        _to: null,
        _sala: efetivaSala,
        _categoria: categoriaFilter === "all" ? null : categoriaFilter,
        _produto: produtoFilter === "all" ? null : produtoFilter,
      });
      const rows = ((data as any[]) ?? [])
        .map((r) => ({
          mes: String(r.mes ?? "").slice(0, 7),
          qtd: Number(r.quantidade ?? 0),
          valor: Number(r.valor ?? 0),
        }))
        .filter((r) => r.mes)
        .sort((a, b) => a.mes.localeCompare(b.mes));
      setEvolucaoMensal(rows);

      // emprestimos mensal — últimos 12 meses
      const desde12 = isoDaysAgo(365);
      let qe = supabase.from("emprestimos").select("created_at").gte("created_at", desde12).limit(50000);
      if (efetivaSala) qe = qe.or(`sala_origem_id.eq.${efetivaSala},sala_destino_id.eq.${efetivaSala}`);
      const { data: edata } = await qe;
      const mapE = new Map<string, number>();
      ((edata as any[]) ?? []).forEach((r) => {
        const k = monthKey(r.created_at);
        mapE.set(k, (mapE.get(k) ?? 0) + 1);
      });
      setEmpMensal(Array.from(mapE.entries()).sort().map(([mes, count]) => ({ mes, count })));
    })();
  }, [periodo, salaFilter, categoriaFilter, produtoFilter, scopeSalaId, isGlobal]);

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
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      let q = supabase.from("solicitacoes").select("sala_id").limit(50000);
      if (desde) q = q.gte("created_at", desde);
      if (efetivaSala) q = q.eq("sala_id", efetivaSala);
      const { data } = await q;
      const map = new Map<string, number>();
      ((data as any[]) ?? []).forEach((r) => map.set(r.sala_id, (map.get(r.sala_id) ?? 0) + 1));
      const arr = Array.from(map.entries())
        .map(([sala_id, total]) => ({ sala_id, sala_nome: salas.find((s) => s.id === sala_id)?.nome ?? "—", total }))
        .sort((a, b) => b.total - a.total);
      setReqPorSala(arr);
    })();
  }, [periodo, salas, salaFilter, scopeSalaId, isGlobal]);

  // Consolidado por região (apenas super master)
  useEffect(() => {
    if (!isSuperMode) { setConsolidadoRegioes([]); return; }
    (async () => {
      const desde = periodo === "all" ? null : isoDaysAgo(parseInt(periodo, 10));
      const ate = null;
      const [{ data: cReg }, { data: vReg }] = await Promise.all([
        (supabase as any).rpc("consumo_por_regiao", { _from: desde, _to: ate }),
        (supabase as any).rpc("valor_estoque_por_regiao"),
      ]);
      const map = new Map<string, { regiao_id: string; regiao_nome: string; qtd: number; valorConsumo: number; valorEstoque: number }>();
      ((cReg as any[]) ?? []).forEach((r) => {
        map.set(r.regiao_id, {
          regiao_id: r.regiao_id,
          regiao_nome: r.regiao_nome,
          qtd: Number(r.quantidade ?? 0),
          valorConsumo: Number(r.valor ?? 0),
          valorEstoque: 0,
        });
      });
      ((vReg as any[]) ?? []).forEach((r) => {
        const cur = map.get(r.regiao_id) ?? { regiao_id: r.regiao_id, regiao_nome: r.regiao_nome, qtd: 0, valorConsumo: 0, valorEstoque: 0 };
        cur.valorEstoque = Number(r.valor_total ?? 0);
        map.set(r.regiao_id, cur);
      });
      setConsolidadoRegioes(Array.from(map.values()).sort((a, b) => a.regiao_nome.localeCompare(b.regiao_nome)));
    })();
  }, [isSuperMode, periodo]);

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


  // Top líderes (para indicadores executivos)
  const topProduto = consumoPorProduto[0];
  const topSala = consumoPorSala[0];
  const topCategoria = consumoPorCategoria[0];
  const consumoMesAtual = useMemo(() => {
    const k = new Date().toISOString().slice(0, 7);
    return evolucaoMensal.find((m) => m.mes === k)?.valor ?? 0;
  }, [evolucaoMensal]);
  const valorCompras = estoqueValor.reduce((s, x) => s + Number(x.valor_total), 0);
  const valorTotalEstoque = Number(patTotais?.valor_total_estoque ?? 0);
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
    { label: "Produtos valorizados", value: valorizacao ? `${NUM(valorizacao.produtos_valorizados)} de ${NUM(valorizacao.produtos_total)} (${valorizacao.percentual_valorizado}%)` : "—" },
    { label: "Itens sem valorização", value: valorizacao ? `${NUM(valorizacao.itens_sem_valor)} un.` : "—" },
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

      {/* Consolidado por região (apenas super master) */}
      {isSuperMode && (
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Globe2 className="size-4 text-primary" />
            <h3 className="font-semibold">Visão consolidada por região</h3>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Região</TableHead>
                  <TableHead className="text-right">Consumo (qtd)</TableHead>
                  <TableHead className="text-right">Consumo (R$)</TableHead>
                  <TableHead className="text-right">Valor em estoque (R$)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consolidadoRegioes.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem dados no período.</TableCell></TableRow>
                )}
                {consolidadoRegioes.map((r) => (
                  <TableRow key={r.regiao_id}>
                    <TableCell>{r.regiao_nome}</TableCell>
                    <TableCell className="text-right">{NUM(r.qtd)}</TableCell>
                    <TableCell className="text-right">{BRL(r.valorConsumo)}</TableCell>
                    <TableCell className="text-right">{BRL(r.valorEstoque)}</TableCell>
                  </TableRow>
                ))}
                {consolidadoRegioes.length > 0 && (
                  <TableRow className="font-semibold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">{NUM(consolidadoRegioes.reduce((s, r) => s + r.qtd, 0))}</TableCell>
                    <TableCell className="text-right">{BRL(consolidadoRegioes.reduce((s, r) => s + r.valorConsumo, 0))}</TableCell>
                    <TableCell className="text-right">{BRL(consolidadoRegioes.reduce((s, r) => s + r.valorEstoque, 0))}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

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

      {/* Composição do Valor do Estoque */}
      <ComposicaoEstoquePanel
        valorConfirmado={Number(patTotais?.valor_compras ?? 0)}
        valorEstimado={Number(patTotais?.valor_patrimonial ?? 0)}
        produtosConfirmados={Number(patTotais?.produtos_confirmados ?? 0)}
        produtosEstimados={Number(patTotais?.produtos_estimados ?? 0)}
        produtosSemAvaliacao={Number(patTotais?.produtos_sem_avaliacao ?? 0)}
        coberturaPct={Number(patTotais?.cobertura_pct ?? 0)}
        pendValorAprox={pendValorAprox}
      />

      <Tabs defaultValue="dashboard">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="emprestimos">Empréstimos</TabsTrigger>
          <TabsTrigger value="ranking">Rankings</TabsTrigger>
          <TabsTrigger value="consumo-sala">Consumo por sala</TabsTrigger>
          <TabsTrigger value="top-produtos">Top produtos</TabsTrigger>
          <TabsTrigger value="comparativo">Comparativo</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="mov-financeira">Mov. Financeira</TabsTrigger>
          <TabsTrigger value="categorias">Categorias</TabsTrigger>
          <TabsTrigger value="abc">Curva ABC</TabsTrigger>
          <TabsTrigger value="estoque">Valor de estoque</TabsTrigger>
          <TabsTrigger value="patrimonio">Patrimônio</TabsTrigger>
        </TabsList>

        <TabsContent value="mov-financeira" className="mt-4">
          <MovimentacaoFinanceiraTab
            salas={salas}
            categorias={categorias}
            produtos={produtos}
            scopeSalaId={scopeSalaId}
          />
        </TabsContent>

        <TabsContent value="patrimonio" className="mt-4">
          <AvaliacaoPatrimonialPage embedded />
        </TabsContent>


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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Patrimônio total em estoque</div>
              <div className="text-3xl font-semibold text-primary mt-1">{BRL(valorTotalEstoque)}</div>
              {valorizacao && (
                <div className="text-xs text-muted-foreground mt-1">
                  Base financeira: {NUM(valorizacao.itens_valorizados)} itens valorizados
                </div>
              )}
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Produtos valorizados</div>
              <div className="text-3xl font-semibold mt-1">
                {valorizacao ? `${NUM(valorizacao.produtos_valorizados)} / ${NUM(valorizacao.produtos_total)}` : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {valorizacao ? `${valorizacao.percentual_valorizado}% do catálogo ativo` : ""}
              </div>
            </Card>
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Itens sem valorização financeira</div>
              <div className="text-3xl font-semibold text-warning mt-1">
                {valorizacao ? NUM(valorizacao.itens_sem_valor) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Excluídos dos relatórios financeiros até receberem custo
              </div>
            </Card>
          </div>
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
              { header: "Itens valorizados", key: "total_itens", map: (r: any) => NUM(Number(r.total_itens)) },
              { header: "Itens sem valor", key: "itens_sem_valor", map: (r: any) => NUM(Number(r.itens_sem_valor ?? 0)) },
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


// ================== COMPOSIÇÃO DO VALOR DO ESTOQUE ==================
function ComposicaoEstoquePanel({
  valorConfirmado, valorEstimado,
  produtosConfirmados, produtosEstimados, produtosSemAvaliacao,
  coberturaPct, pendValorAprox,
}: {
  valorConfirmado: number; valorEstimado: number;
  produtosConfirmados: number; produtosEstimados: number; produtosSemAvaliacao: number;
  coberturaPct: number; pendValorAprox: number;
}) {
  const total = valorConfirmado + valorEstimado;
  const pctConf = total > 0 ? (valorConfirmado / total) * 100 : 0;
  const pctEst = total > 0 ? (valorEstimado / total) * 100 : 0;
  const totalProdutos = produtosConfirmados + produtosEstimados + produtosSemAvaliacao;
  const data = [
    { name: "Confirmado", value: valorConfirmado, color: "hsl(var(--success))" },
    { name: "Estimado", value: valorEstimado, color: "hsl(var(--warning))" },
  ];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
        <div>
          <div className="text-sm font-medium">Composição do Valor do Estoque</div>
          <div className="text-xs text-muted-foreground">Confiabilidade financeira do patrimônio total</div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-muted-foreground">Valor total</div>
          <div className="text-2xl font-semibold text-primary">{BRL(total)}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6 items-center">
        <div className="h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                {data.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip formatter={(v: any) => BRL(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-3">
          {/* Barra horizontal empilhada */}
          <div className="w-full h-3 rounded-full overflow-hidden bg-muted flex">
            <div style={{ width: `${pctConf}%`, background: "hsl(var(--success))" }} />
            <div style={{ width: `${pctEst}%`, background: "hsl(var(--warning))" }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-success" /> Confirmado (compras)
              </div>
              <div className="text-lg font-semibold text-success mt-1">{BRL(valorConfirmado)}</div>
              <div className="text-[11px] text-muted-foreground">{pctConf.toFixed(1)}% do total</div>
            </div>
            <div className="rounded-md border p-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="size-2 rounded-full bg-warning" /> Estimado (avaliação patrimonial)
              </div>
              <div className="text-lg font-semibold text-warning mt-1">{BRL(valorEstimado)}</div>
              <div className="text-[11px] text-muted-foreground">{pctEst.toFixed(1)}% do total</div>
            </div>
          </div>
        </div>
      </div>

      {/* Indicadores complementares */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 pt-4 border-t">
        <div>
          <div className="text-[11px] text-muted-foreground">Com valor confirmado</div>
          <div className="text-lg font-semibold">{NUM(produtosConfirmados)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Com valor estimado</div>
          <div className="text-lg font-semibold">{NUM(produtosEstimados)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Sem avaliação</div>
          <div className="text-lg font-semibold text-destructive">{NUM(produtosSemAvaliacao)}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground">Cobertura financeira</div>
          <div className="text-lg font-semibold text-primary">{coberturaPct.toFixed(1)}%</div>
          <div className="text-[10px] text-muted-foreground">Meta: 100%</div>
        </div>
      </div>

      {/* Meta de cobertura */}
      {produtosSemAvaliacao > 0 ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-xs">
            <span className="font-medium text-warning">Faltam regularizar:</span>{" "}
            <span className="font-semibold">{NUM(produtosSemAvaliacao)}</span> produto(s)
            {pendValorAprox > 0 && <> · valor aproximado <span className="font-semibold">{BRL(pendValorAprox)}</span></>}
            {totalProdutos > 0 && <> · {((produtosSemAvaliacao / totalProdutos) * 100).toFixed(1)}% do catálogo</>}
          </div>
          <a href="/app/relatorios" className="text-xs text-primary hover:underline">Ir para Patrimônio →</a>
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-success/30 bg-success/5 p-3 text-xs text-success">
          🎉 100% de cobertura patrimonial — todo o estoque está avaliado.
        </div>
      )}
    </Card>
  );
}
