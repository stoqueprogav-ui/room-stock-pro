import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LineChart, Line,
} from "recharts";
import {
  ArrowDownCircle, ArrowUpCircle, Scale, Activity, Package, Wallet,
  FileDown, FileSpreadsheet, Printer, Search, Info,
} from "lucide-react";
import { exportToExcel, exportReportPdf, printReport, type ExportColumn } from "@/lib/exporters";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string; categoria_id: string | null };

type MovRaw = {
  id: string;
  created_at: string;
  produto_id: string | null;
  sala_id: string | null;
  usuario_id: string | null;
  tipo: string;
  quantidade: number;
  custo_unitario_aplicado: number | null;
  valor_financeiro: number | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  observacao: string | null;
  produto?: { nome: string; categoria_id: string | null; categoria?: { nome: string | null } | null } | null;
  sala?: { nome: string } | null;
  usuario?: { nome: string | null; email: string | null } | null;
};

type MovRow = {
  id: string;
  data: string;
  hora: string;
  sala_id: string | null;
  sala_nome: string;
  produto_id: string | null;
  produto_nome: string;
  categoria_id: string | null;
  categoria_nome: string;
  tipo: string;
  tipo_label: string;
  origem: string;
  origem_key: string;
  referencia_id: string | null;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  usuario_nome: string;
  fluxo: "entrada" | "saida";
  observacao: string | null;
  created_at: string;
};

const BRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const NUM = (v: number) => v.toLocaleString("pt-BR");
const PCT = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const TIPO_LABELS: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste: "Ajuste de inventário",
  solicitacao: "Requisição",
  estorno: "Estorno / Correção",
  emprestimo_saida: "Empréstimo enviado",
  emprestimo_entrada: "Empréstimo devolvido",
  consumo_interno: "Consumo interno",
};

function originLabel(m: MovRaw): { origem: string; key: string } {
  const ref = m.referencia_tipo;
  if (ref === "entrada_estoque") return { origem: "Entrada de estoque", key: "entrada_estoque" };
  if (ref === "solicitacao") return { origem: "Requisição", key: "solicitacao" };
  if (ref === "emprestimo") {
    if (m.tipo === "emprestimo_saida") return { origem: "Empréstimo enviado", key: "emprestimo_saida" };
    if (m.tipo === "emprestimo_entrada") return { origem: "Empréstimo devolvido", key: "emprestimo_entrada" };
    return { origem: "Empréstimo", key: "emprestimo" };
  }
  if (ref === "devolucao") return { origem: "Empréstimo devolvido", key: "devolucao" };
  if (ref === "consumo_interno") return { origem: "Consumo interno", key: "consumo_interno" };
  if (m.tipo === "ajuste") return { origem: "Ajuste de inventário", key: "ajuste" };
  if (m.tipo === "estorno") return { origem: "Correção administrativa", key: "estorno" };
  return { origem: TIPO_LABELS[m.tipo] ?? m.tipo, key: m.tipo };
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function monthKey(iso: string) { return iso.slice(0, 7); }

const YEARS = (() => {
  const cur = new Date().getFullYear();
  return [cur, cur - 1, cur - 2, cur - 3, cur - 4];
})();
const MONTHS = [
  { v: "01", l: "Janeiro" }, { v: "02", l: "Fevereiro" }, { v: "03", l: "Março" },
  { v: "04", l: "Abril" }, { v: "05", l: "Maio" }, { v: "06", l: "Junho" },
  { v: "07", l: "Julho" }, { v: "08", l: "Agosto" }, { v: "09", l: "Setembro" },
  { v: "10", l: "Outubro" }, { v: "11", l: "Novembro" }, { v: "12", l: "Dezembro" },
];

export default function MovimentacaoFinanceiraTab({
  salas, categorias, produtos, scopeSalaId,
}: {
  salas: Sala[];
  categorias: Categoria[];
  produtos: Produto[];
  scopeSalaId: string | null;
}) {
  const { profile } = useAuth();
  const { logoUrl } = useCompanyLogo();
  const isGlobal = scopeSalaId === null;

  // filtros
  const [dataInicio, setDataInicio] = useState<string>(daysAgoISO(30));
  const [dataFim, setDataFim] = useState<string>(todayISO());
  const [mes, setMes] = useState<string>("all");
  const [ano, setAno] = useState<string>("all");
  const [salaFilter, setSalaFilter] = useState<string>(scopeSalaId ?? "all");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("all");
  const [produtoFilter, setProdutoFilter] = useState<string>("all");
  const [tipoFilter, setTipoFilter] = useState<string>("all");
  const [busca, setBusca] = useState<string>("");

  useEffect(() => { setSalaFilter(scopeSalaId ?? "all"); }, [scopeSalaId]);

  // Se mês/ano selecionados, sobrepõe a data inicial/final
  const effectiveRange = useMemo(() => {
    if (ano !== "all" && mes !== "all") {
      const from = `${ano}-${mes}-01`;
      const m = parseInt(mes, 10), y = parseInt(ano, 10);
      const last = new Date(y, m, 0).getDate();
      const to = `${ano}-${mes}-${String(last).padStart(2, "0")}`;
      return { from, to };
    }
    if (ano !== "all") return { from: `${ano}-01-01`, to: `${ano}-12-31` };
    return { from: dataInicio, to: dataFim };
  }, [dataInicio, dataFim, mes, ano]);

  const [rawMovs, setRawMovs] = useState<MovRaw[]>([]);
  const [loading, setLoading] = useState(false);
  const [valorEstoqueTotal, setValorEstoqueTotal] = useState<number>(0);

  // Carrega movimentações
  useEffect(() => {
    (async () => {
      setLoading(true);
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const fromISO = `${effectiveRange.from}T00:00:00`;
      const toISO = `${effectiveRange.to}T23:59:59.999`;
      let q = supabase
        .from("movimentacoes")
        .select(`
          id, created_at, produto_id, sala_id, usuario_id, tipo, quantidade,
          custo_unitario_aplicado, valor_financeiro, referencia_tipo, referencia_id, observacao,
          produto:produtos(nome, categoria_id, categoria:categorias(nome)),
          sala:salas(nome),
          usuario:profiles(nome, email)
        `)
        .gte("created_at", fromISO)
        .lte("created_at", toISO)
        .order("created_at", { ascending: false })
        .limit(20000);
      if (efetivaSala) q = q.eq("sala_id", efetivaSala);
      if (produtoFilter !== "all") q = q.eq("produto_id", produtoFilter);
      if (tipoFilter !== "all") q = q.eq("tipo", tipoFilter as any);
      const { data, error } = await q;
      if (error) console.error("[MovimentacaoFinanceira]", error);
      setRawMovs((data as any) ?? []);
      setLoading(false);
    })();
  }, [effectiveRange.from, effectiveRange.to, salaFilter, produtoFilter, tipoFilter, scopeSalaId, isGlobal]);

  // Valor total do estoque (patrimônio atual)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("valor_estoque_por_sala");
      const rows = (data as any[]) ?? [];
      const efetivaSala = isGlobal ? (salaFilter === "all" ? null : salaFilter) : scopeSalaId!;
      const filtered = efetivaSala ? rows.filter((r) => r.sala_id === efetivaSala) : rows;
      setValorEstoqueTotal(filtered.reduce((acc, r) => acc + Number(r.valor_total ?? 0), 0));
    })();
  }, [salaFilter, scopeSalaId, isGlobal]);

  // Normaliza e aplica filtros de categoria/busca (feito no cliente para simplicidade)
  const rows: MovRow[] = useMemo(() => {
    const out: MovRow[] = [];
    for (const m of rawMovs) {
      const catId = m.produto?.categoria_id ?? null;
      if (categoriaFilter !== "all" && catId !== categoriaFilter) continue;
      const qty = Number(m.quantidade || 0);
      const absQty = Math.abs(qty);
      const custo = Number(m.custo_unitario_aplicado ?? 0);
      const valorFin = m.valor_financeiro != null ? Math.abs(Number(m.valor_financeiro)) : absQty * custo;
      const { origem, key } = originLabel(m);
      const d = new Date(m.created_at);
      const nomeUsuario = m.usuario?.nome ?? m.usuario?.email ?? "—";
      const produtoNome = m.produto?.nome ?? "(produto removido)";
      const salaNome = m.sala?.nome ?? "—";
      const categoriaNome = m.produto?.categoria?.nome ?? "—";
      const row: MovRow = {
        id: m.id,
        data: d.toLocaleDateString("pt-BR"),
        hora: d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        sala_id: m.sala_id, sala_nome: salaNome,
        produto_id: m.produto_id, produto_nome: produtoNome,
        categoria_id: catId, categoria_nome: categoriaNome,
        tipo: m.tipo, tipo_label: TIPO_LABELS[m.tipo] ?? m.tipo,
        origem, origem_key: key,
        referencia_id: m.referencia_id,
        quantidade: absQty, valor_unitario: custo, valor_total: valorFin,
        usuario_nome: nomeUsuario,
        fluxo: qty >= 0 ? "entrada" : "saida",
        observacao: m.observacao,
        created_at: m.created_at,
      };
      if (busca.trim()) {
        const b = busca.trim().toLowerCase();
        const hay = `${produtoNome} ${salaNome} ${categoriaNome} ${nomeUsuario} ${origem}`.toLowerCase();
        if (!hay.includes(b)) continue;
      }
      out.push(row);
    }
    return out;
  }, [rawMovs, categoriaFilter, busca]);

  // KPIs
  const kpis = useMemo(() => {
    let entradas = 0, saidas = 0;
    const produtosSet = new Set<string>();
    for (const r of rows) {
      if (r.fluxo === "entrada") entradas += r.valor_total;
      else saidas += r.valor_total;
      if (r.produto_id) produtosSet.add(r.produto_id);
    }
    return {
      entradas, saidas, saldo: entradas - saidas,
      count: rows.length, produtos: produtosSet.size,
    };
  }, [rows]);

  // Resumo por sala
  const porSala = useMemo(() => {
    const map = new Map<string, { sala: string; entradas: number; saidas: number }>();
    for (const r of rows) {
      const k = r.sala_nome;
      const cur = map.get(k) ?? { sala: k, entradas: 0, saidas: 0 };
      if (r.fluxo === "entrada") cur.entradas += r.valor_total; else cur.saidas += r.valor_total;
      map.set(k, cur);
    }
    return Array.from(map.values())
      .map((v) => ({ ...v, saldo: v.entradas - v.saidas }))
      .sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas));
  }, [rows]);

  // Top produtos
  const topProdutos = useMemo(() => {
    const map = new Map<string, { produto: string; quantidade: number; valor: number }>();
    for (const r of rows) {
      const k = r.produto_nome;
      const cur = map.get(k) ?? { produto: k, quantidade: 0, valor: 0 };
      cur.quantidade += r.quantidade;
      cur.valor += r.valor_total;
      map.set(k, cur);
    }
    const total = Array.from(map.values()).reduce((a, r) => a + r.valor, 0) || 1;
    return Array.from(map.values())
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 15)
      .map((r) => ({ ...r, participacao: r.valor / total }));
  }, [rows]);

  // Categorias
  const porCategoria = useMemo(() => {
    const map = new Map<string, { categoria: string; entradas: number; saidas: number }>();
    for (const r of rows) {
      const k = r.categoria_nome;
      const cur = map.get(k) ?? { categoria: k, entradas: 0, saidas: 0 };
      if (r.fluxo === "entrada") cur.entradas += r.valor_total; else cur.saidas += r.valor_total;
      map.set(k, cur);
    }
    const arr = Array.from(map.values()).map((v) => ({ ...v, saldo: v.entradas - v.saidas }));
    const total = arr.reduce((a, r) => a + r.entradas + r.saidas, 0) || 1;
    return arr
      .map((r) => ({ ...r, participacao: (r.entradas + r.saidas) / total }))
      .sort((a, b) => (b.entradas + b.saidas) - (a.entradas + a.saidas));
  }, [rows]);

  // Evolução mensal
  const porMes = useMemo(() => {
    const map = new Map<string, { mes: string; entradas: number; saidas: number }>();
    for (const r of rows) {
      const k = monthKey(r.created_at);
      const cur = map.get(k) ?? { mes: k, entradas: 0, saidas: 0 };
      if (r.fluxo === "entrada") cur.entradas += r.valor_total; else cur.saidas += r.valor_total;
      map.set(k, cur);
    }
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes))
      .map((r) => ({ ...r, saldo: r.entradas - r.saidas }));
  }, [rows]);

  // Detalhe
  const [detalhe, setDetalhe] = useState<MovRow | null>(null);

  // Exportação
  const subtitleFiltros = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Período: ${effectiveRange.from} a ${effectiveRange.to}`);
    if (isGlobal && salaFilter !== "all") parts.push(`Sala: ${salas.find((s) => s.id === salaFilter)?.nome ?? "—"}`);
    if (!isGlobal) parts.push(`Sala: ${salas.find((s) => s.id === scopeSalaId)?.nome ?? "—"}`);
    if (categoriaFilter !== "all") parts.push(`Categoria: ${categorias.find((c) => c.id === categoriaFilter)?.nome ?? "—"}`);
    if (produtoFilter !== "all") parts.push(`Produto: ${produtos.find((p) => p.id === produtoFilter)?.nome ?? "—"}`);
    if (tipoFilter !== "all") parts.push(`Tipo: ${TIPO_LABELS[tipoFilter] ?? tipoFilter}`);
    return parts.join(" · ");
  }, [effectiveRange, salaFilter, categoriaFilter, produtoFilter, tipoFilter, scopeSalaId, isGlobal, salas, categorias, produtos]);

  const colunasExport: ExportColumn<MovRow>[] = [
    { header: "Data", key: "data" },
    { header: "Hora", key: "hora" },
    { header: "Sala", key: "sala_nome" },
    { header: "Produto", key: "produto_nome" },
    { header: "Categoria", key: "categoria_nome" },
    { header: "Tipo", key: "tipo_label" },
    { header: "Origem", key: "origem" },
    { header: "Fluxo", key: "fluxo", map: (r) => r.fluxo === "entrada" ? "Entrada" : "Saída" },
    { header: "Quantidade", key: "quantidade" },
    { header: "Valor unitário (R$)", key: "valor_unitario", map: (r) => Number(r.valor_unitario.toFixed(2)) },
    { header: "Valor total (R$)", key: "valor_total", map: (r) => Number(r.valor_total.toFixed(2)) },
    { header: "Usuário", key: "usuario_nome" },
    { header: "Observação", key: "observacao", map: (r) => r.observacao ?? "" },
  ];

  const meta = {
    title: "Movimentação Financeira do Estoque",
    subtitle: subtitleFiltros,
    companyName: undefined as string | undefined,
    logoUrl: logoUrl ?? null,
    user: profile?.nome ?? profile?.email ?? null,
  };

  const exportarXLSX = () => exportToExcel(`movimentacao-financeira_${effectiveRange.from}_a_${effectiveRange.to}.xlsx`, colunasExport, rows);
  const exportarPDF = () => exportReportPdf(`movimentacao-financeira_${effectiveRange.from}_a_${effectiveRange.to}.pdf`, colunasExport, rows, meta);
  const imprimir = () => printReport(colunasExport, rows, meta);

  const limparFiltros = () => {
    setDataInicio(daysAgoISO(30)); setDataFim(todayISO());
    setMes("all"); setAno("all");
    setSalaFilter(scopeSalaId ?? "all");
    setCategoriaFilter("all"); setProdutoFilter("all"); setTipoFilter("all"); setBusca("");
  };

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Data inicial</Label>
            <Input type="date" value={dataInicio} onChange={(e) => { setDataInicio(e.target.value); setMes("all"); setAno("all"); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Data final</Label>
            <Input type="date" value={dataFim} onChange={(e) => { setDataFim(e.target.value); setMes("all"); setAno("all"); }} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Mês</Label>
            <Select value={mes} onValueChange={setMes}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">— Qualquer —</SelectItem>
                {MONTHS.map((m) => <SelectItem key={m.v} value={m.v}>{m.l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ano</Label>
            <Select value={ano} onValueChange={setAno}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">— Qualquer —</SelectItem>
                {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
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
              <SelectContent className="max-h-72">
                <SelectItem value="all">Todos os produtos</SelectItem>
                {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de movimentação</Label>
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(TIPO_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center pt-1">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Buscar produto, sala, categoria, usuário…"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <Button size="sm" variant="ghost" onClick={limparFiltros}>Limpar filtros</Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" onClick={exportarXLSX}><FileSpreadsheet className="size-4 mr-1.5" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={exportarPDF}><FileDown className="size-4 mr-1.5" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={imprimir}><Printer className="size-4 mr-1.5" /> Imprimir</Button>
          </div>
        </div>
      </Card>

      {/* KPIs — Resumo executivo */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiCard icon={ArrowDownCircle} label="Entradas (R$)" value={BRL(kpis.entradas)} accent="text-success" />
        <KpiCard icon={ArrowUpCircle} label="Saídas (R$)" value={BRL(kpis.saidas)} accent="text-destructive" />
        <KpiCard icon={Scale} label="Saldo financeiro"
          value={BRL(kpis.saldo)} accent={kpis.saldo >= 0 ? "text-success" : "text-destructive"} />
        <KpiCard icon={Activity} label="Movimentações" value={NUM(kpis.count)} accent="text-primary" />
        <KpiCard icon={Package} label="Produtos movimentados" value={NUM(kpis.produtos)} accent="text-accent" />
        <KpiCard icon={Wallet} label="Patrimônio atual em estoque" value={BRL(valorEstoqueTotal)} accent="text-primary"
          sub={`Saldo movimentado: ${kpis.saldo >= 0 ? "+" : ""}${BRL(kpis.saldo)}`} />
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-2 gap-4">
        <ChartCard title="Evolução mensal — Entradas × Saídas (R$)">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={porMes}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => BRL(Number(v))} />
              <Legend />
              <Line type="monotone" dataKey="entradas" name="Entradas" stroke="hsl(var(--success))" strokeWidth={2} />
              <Line type="monotone" dataKey="saidas" name="Saídas" stroke="hsl(var(--destructive))" strokeWidth={2} />
              <Line type="monotone" dataKey="saldo" name="Saldo" stroke="hsl(var(--primary))" strokeWidth={2} strokeDasharray="4 3" />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Entradas × Saídas por sala (R$)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={porSala}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="sala" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => BRL(Number(v))} />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill="hsl(var(--success))" />
              <Bar dataKey="saidas" name="Saídas" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Entradas × Saídas por categoria (R$)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={porCategoria} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => BRL(Number(v))} />
              <YAxis dataKey="categoria" type="category" tick={{ fontSize: 11 }} width={120} />
              <Tooltip formatter={(v: any) => BRL(Number(v))} />
              <Legend />
              <Bar dataKey="entradas" name="Entradas" fill="hsl(var(--success))" />
              <Bar dataKey="saidas" name="Saídas" fill="hsl(var(--destructive))" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Top 10 produtos por valor movimentado (R$)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={topProdutos.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => BRL(Number(v))} />
              <YAxis dataKey="produto" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip formatter={(v: any) => BRL(Number(v))} />
              <Bar dataKey="valor" name="Valor" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Demonstrativo (extrato) */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">Demonstrativo Financeiro (extrato)</div>
            <div className="text-xs text-muted-foreground">
              {loading ? "Carregando..." : `${NUM(rows.length)} movimentações · ${subtitleFiltros}`}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px]">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10">
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Hora</TableHead>
                <TableHead>Sala</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Vl. unit.</TableHead>
                <TableHead className="text-right">Vl. total</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead className="w-[40px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 500).map((r) => (
                <TableRow key={r.id} className="table-row-hover cursor-pointer" onClick={() => setDetalhe(r)}>
                  <TableCell className="whitespace-nowrap">{r.data}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.hora}</TableCell>
                  <TableCell>{r.sala_nome}</TableCell>
                  <TableCell className="font-medium">{r.produto_nome}</TableCell>
                  <TableCell className="text-muted-foreground">{r.categoria_nome}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={r.fluxo === "entrada" ? "border-success/40 text-success" : "border-destructive/40 text-destructive"}>
                      {r.tipo_label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{r.origem}</TableCell>
                  <TableCell className="text-right font-mono">{NUM(r.quantidade)}</TableCell>
                  <TableCell className="text-right font-mono">{BRL(r.valor_unitario)}</TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${r.fluxo === "entrada" ? "text-success" : "text-destructive"}`}>
                    {r.fluxo === "entrada" ? "+" : "−"}{BRL(r.valor_total)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.usuario_nome}</TableCell>
                  <TableCell className="text-right"><Info className="size-4 text-muted-foreground" /></TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={12} className="text-center text-muted-foreground py-10">
                  {loading ? "Carregando..." : "Nenhuma movimentação no período/filtros selecionados."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          {rows.length > 500 && (
            <div className="p-3 text-xs text-muted-foreground border-t bg-muted/30">
              Exibindo as primeiras 500 movimentações. Utilize a exportação para o conjunto completo ({NUM(rows.length)}).
            </div>
          )}
        </div>
      </Card>

      {/* Resumo por sala */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b text-sm font-semibold">Resumo por sala</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right">Entradas</TableHead>
              <TableHead className="text-right">Saídas</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {porSala.map((r) => (
              <TableRow key={r.sala}>
                <TableCell className="font-medium">{r.sala}</TableCell>
                <TableCell className="text-right font-mono text-success">{BRL(r.entradas)}</TableCell>
                <TableCell className="text-right font-mono text-destructive">{BRL(r.saidas)}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${r.saldo >= 0 ? "text-success" : "text-destructive"}`}>
                  {r.saldo >= 0 ? "+" : ""}{BRL(r.saldo)}
                </TableCell>
              </TableRow>
            ))}
            {porSala.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Top produtos */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b text-sm font-semibold">Produtos com maior valor movimentado</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Quantidade</TableHead>
              <TableHead className="text-right">Valor movimentado</TableHead>
              <TableHead className="text-right">Participação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {topProdutos.map((r) => (
              <TableRow key={r.produto}>
                <TableCell className="font-medium">{r.produto}</TableCell>
                <TableCell className="text-right font-mono">{NUM(r.quantidade)}</TableCell>
                <TableCell className="text-right font-mono">{BRL(r.valor)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{PCT(r.participacao)}</TableCell>
              </TableRow>
            ))}
            {topProdutos.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Categorias */}
      <Card className="p-0 overflow-hidden">
        <div className="p-3 border-b text-sm font-semibold">Categorias</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">Entradas</TableHead>
              <TableHead className="text-right">Saídas</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Participação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {porCategoria.map((r) => (
              <TableRow key={r.categoria}>
                <TableCell className="font-medium">{r.categoria}</TableCell>
                <TableCell className="text-right font-mono text-success">{BRL(r.entradas)}</TableCell>
                <TableCell className="text-right font-mono text-destructive">{BRL(r.saidas)}</TableCell>
                <TableCell className={`text-right font-mono font-semibold ${r.saldo >= 0 ? "text-success" : "text-destructive"}`}>
                  {r.saldo >= 0 ? "+" : ""}{BRL(r.saldo)}
                </TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{PCT(r.participacao)}</TableCell>
              </TableRow>
            ))}
            {porCategoria.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Sem dados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>

      {/* Detalhe / Auditoria */}
      <Dialog open={!!detalhe} onOpenChange={(v) => !v && setDetalhe(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes da movimentação</DialogTitle>
            <DialogDescription>Vínculo com a movimentação original para auditoria.</DialogDescription>
          </DialogHeader>
          {detalhe && (
            <div className="space-y-2 text-sm">
              <DetailRow label="Data" value={`${detalhe.data} ${detalhe.hora}`} />
              <DetailRow label="Sala" value={detalhe.sala_nome} />
              <DetailRow label="Produto" value={detalhe.produto_nome} />
              <DetailRow label="Categoria" value={detalhe.categoria_nome} />
              <DetailRow label="Tipo" value={detalhe.tipo_label} />
              <DetailRow label="Origem" value={detalhe.origem} />
              <DetailRow label="Quantidade" value={NUM(detalhe.quantidade)} />
              <DetailRow label="Valor unitário" value={BRL(detalhe.valor_unitario)} />
              <DetailRow label="Valor total" value={`${detalhe.fluxo === "entrada" ? "+" : "−"}${BRL(detalhe.valor_total)}`}
                highlight={detalhe.fluxo === "entrada" ? "text-success" : "text-destructive"} />
              <DetailRow label="Usuário" value={detalhe.usuario_nome} />
              <DetailRow label="Documento de origem" value={detalhe.referencia_id ?? "—"} mono />
              <DetailRow label="ID da movimentação" value={detalhe.id} mono />
              {detalhe.observacao && <DetailRow label="Observação" value={detalhe.observacao} />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, accent }: {
  icon: any; label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground uppercase tracking-wide truncate">{label}</div>
          <div className={`text-2xl font-bold mt-1 ${accent ?? ""}`}>{value}</div>
          {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
        </div>
        {Icon && <Icon className={`size-5 ${accent ?? "text-muted-foreground"}`} />}
      </div>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-semibold mb-2">{title}</div>
      {children}
    </Card>
  );
}

function DetailRow({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/50 pb-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-sm text-right ${mono ? "font-mono text-xs break-all" : ""} ${highlight ?? ""}`}>{value}</div>
    </div>
  );
}
