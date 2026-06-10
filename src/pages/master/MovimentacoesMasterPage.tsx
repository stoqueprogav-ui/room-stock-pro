import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, RefreshCw, ChevronDown, ChevronUp, Search, X,
  FileDown, FileSpreadsheet, Printer, Clock,
} from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { exportToExcel, exportReportPdf, printReport, type ExportColumn } from "@/lib/exporters";

type LogRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_nome: string | null;
  actor_email: string | null;
  event_type: string;
  event_category: string;
  sala_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  metadata: Record<string, any>;
};

type ItemDetalhe = { produto: string; quantidade?: number | string; extra?: string };

const PAGE_SIZE = 50;

// Mapeia event_type -> rótulo, cor e categoria visual
type EventCfg = { label: string; color: string; group: string };
const EVENT_MAP: Record<string, EventCfg> = {
  "requisicao.aprovada":   { label: "Requisição aprovada",   color: "bg-blue-500/15 text-blue-600 border-blue-500/30",          group: "requisicao" },
  "requisicao.rejeitada":  { label: "Requisição rejeitada",  color: "bg-blue-500/10 text-blue-500/80 border-blue-500/20",       group: "requisicao" },
  "requisicao.arquivada":  { label: "Requisição arquivada",  color: "bg-blue-500/10 text-blue-500/70 border-blue-500/20",       group: "requisicao" },
  "emprestimo.criado":     { label: "Empréstimo solicitado", color: "bg-orange-500/15 text-orange-600 border-orange-500/30",    group: "emprestimo" },
  "emprestimo.aprovado":   { label: "Empréstimo aprovado",   color: "bg-orange-500/15 text-orange-600 border-orange-500/30",    group: "emprestimo" },
  "emprestimo.rejeitado":  { label: "Empréstimo rejeitado",  color: "bg-orange-500/10 text-orange-500/80 border-orange-500/20", group: "emprestimo" },
  "emprestimo.arquivado":  { label: "Empréstimo arquivado",  color: "bg-orange-500/10 text-orange-500/70 border-orange-500/20", group: "emprestimo" },
  "devolucao.registrada":  { label: "Devolução registrada",  color: "bg-purple-500/15 text-purple-600 border-purple-500/30",    group: "devolucao" },
  "consumo.interno":       { label: "Consumo interno",       color: "bg-gray-500/15 text-gray-600 border-gray-500/30",          group: "consumo" },
  "estoque.ajustado":      { label: "Ajuste de estoque",     color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", group: "estoque" },
  "produto.desativado":    { label: "Produto desativado",    color: "bg-red-700/15 text-red-700 border-red-700/30",             group: "catalogo" },
  "produto.excluido":      { label: "Produto excluído",      color: "bg-red-700/15 text-red-700 border-red-700/30",             group: "catalogo" },
  "produto.removido_da_sala": { label: "Produto removido da sala", color: "bg-red-700/10 text-red-700/80 border-red-700/20",    group: "catalogo" },
  "sala.excluida":         { label: "Sala excluída",         color: "bg-red-700/15 text-red-700 border-red-700/30",             group: "estrutura" },
  "sala.excluida_force":   { label: "Sala excluída (forçado)", color: "bg-red-700/20 text-red-700 border-red-700/40",           group: "estrutura" },
  "divida.quitada":        { label: "Dívida quitada",        color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", group: "divida" },
  "inventario.gerado":     { label: "Inventário gerado",     color: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",          group: "inventario" },
  "sistema.reset.iniciado":{ label: "Reset do sistema iniciado", color: "bg-red-700/15 text-red-700 border-red-700/30",         group: "sistema" },
  "sistema.reset.concluido":{ label: "Reset concluído",      color: "bg-red-700/15 text-red-700 border-red-700/30",             group: "sistema" },
  "sistema.reset.erro":    { label: "Erro no reset",         color: "bg-red-700/20 text-red-700 border-red-700/40",             group: "sistema" },
};
const DEFAULT_CFG: EventCfg = { label: "Evento", color: "bg-muted text-muted-foreground border-border", group: "geral" };
const cfgOf = (et: string) => EVENT_MAP[et] ?? { ...DEFAULT_CFG, label: et };

const TIPO_OPTIONS: { value: string; label: string }[] = [
  { value: "__all__", label: "Todos os tipos" },
  { value: "requisicao.aprovada", label: "Requisição aprovada" },
  { value: "requisicao.rejeitada", label: "Requisição rejeitada" },
  { value: "requisicao.arquivada", label: "Requisição arquivada" },
  { value: "emprestimo.criado", label: "Empréstimo solicitado" },
  { value: "emprestimo.aprovado", label: "Empréstimo aprovado" },
  { value: "emprestimo.rejeitado", label: "Empréstimo rejeitado" },
  { value: "emprestimo.arquivado", label: "Empréstimo arquivado" },
  { value: "devolucao.registrada", label: "Devolução registrada" },
  { value: "consumo.interno", label: "Consumo interno" },
  { value: "estoque.ajustado", label: "Ajuste de estoque" },
  { value: "produto.desativado", label: "Produto desativado" },
  { value: "produto.excluido", label: "Produto excluído" },
  { value: "produto.removido_da_sala", label: "Produto removido da sala" },
  { value: "sala.excluida", label: "Sala excluída" },
  { value: "divida.quitada", label: "Dívida quitada" },
  { value: "inventario.gerado", label: "Inventário gerado" },
];

function dayLabel(iso: string) {
  const d = new Date(iso); d.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export default function MovimentacoesMasterPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [salas, setSalas] = useState<Array<{ id: string; nome: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [kpis, setKpis] = useState({ hoje: 0, semana: 0, reqApr: 0, empApr: 0, entradas: 0, saidas: 0 });

  // filtros
  const [search, setSearch] = useState("");
  const [tipo, setTipo] = useState("__all__");
  const [salaId, setSalaId] = useState("__all__");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    supabase.from("salas").select("id, nome").order("nome").then(({ data }) => setSalas((data ?? []) as any));
  }, []);

  const carregarKpis = useCallback(async () => {
    const now = new Date();
    const startDay = new Date(now); startDay.setHours(0,0,0,0);
    const startWeek = new Date(now); startWeek.setDate(now.getDate() - 7);
    const [allWeek, ajustes] = await Promise.all([
      supabase.from("system_logs")
        .select("event_type, created_at")
        .gte("created_at", startWeek.toISOString())
        .limit(5000),
      supabase.from("movimentacoes")
        .select("quantidade")
        .gte("created_at", startWeek.toISOString())
        .eq("tipo", "ajuste"),
    ]);
    const logs = (allWeek.data ?? []) as any[];
    const hoje = logs.filter(l => new Date(l.created_at) >= startDay).length;
    const semana = logs.length;
    const reqApr = logs.filter(l => l.event_type === "requisicao.aprovada").length;
    const empApr = logs.filter(l => l.event_type === "emprestimo.aprovado").length;
    const ajs = (ajustes.data ?? []) as any[];
    const entradas = ajs.filter(a => a.quantidade > 0).length;
    const saidas = ajs.filter(a => a.quantidade < 0).length;
    setKpis({ hoje, semana, reqApr, empApr, entradas, saidas });
  }, []);

  const fetchPage = useCallback(async (reset: boolean) => {
    setLoading(true);
    const params: any = {
      _event_type: tipo === "__all__" ? null : tipo,
      _sala: salaId === "__all__" ? null : salaId,
      _from: from ? new Date(from).toISOString() : null,
      _to: to ? new Date(to + "T23:59:59").toISOString() : null,
      _search: search || null,
      _cursor: reset ? null : cursor,
      _limit: PAGE_SIZE,
    };
    const { data, error } = await supabase.rpc("listar_system_logs" as any, params);
    if (error) {
      toast.error("Falha ao carregar movimentações: " + error.message);
      setLoading(false); return;
    }
    const list = (data ?? []) as LogRow[];
    setRows(prev => reset ? list : [...prev, ...list]);
    setHasMore(list.length === PAGE_SIZE);
    if (list.length > 0) setCursor(list[list.length - 1].created_at);
    setLoading(false);
  }, [tipo, salaId, from, to, search, cursor]);

  useEffect(() => { setCursor(null); fetchPage(true); carregarKpis(); /* eslint-disable-next-line */ }, [tipo, salaId, from, to]);
  useRealtimeSync(["system_logs"], () => { setCursor(null); fetchPage(true); carregarKpis(); }, { debounceMs: 600 });

  const salaMap = useMemo(() => new Map(salas.map(s => [s.id, s.nome])), [salas]);

  const limparFiltros = () => { setSearch(""); setTipo("__all__"); setSalaId("__all__"); setFrom(""); setTo(""); };
  const filtrosAtivos = (search?1:0)+(tipo!=="__all__"?1:0)+(salaId!=="__all__"?1:0)+(from?1:0)+(to?1:0);

  // agrupar por dia
  const grouped = useMemo(() => {
    const map = new Map<string, LogRow[]>();
    for (const r of rows) {
      const k = new Date(r.created_at).toDateString();
      const arr = map.get(k) ?? [];
      arr.push(r); map.set(k, arr);
    }
    return Array.from(map.entries()).map(([k, list]) => ({
      key: k, label: dayLabel(list[0].created_at), items: list,
    }));
  }, [rows]);

  // export
  const { logoUrl } = useCompanyLogo();
  const { profile } = useAuth();
  const exportar = async (formato: "xlsx" | "pdf" | "print") => {
    const cols: ExportColumn<LogRow & { sala_nome?: string | null }>[] = [
      { header: "Data/Hora", key: "created_at", map: (r) => new Date(r.created_at).toLocaleString("pt-BR") },
      { header: "Usuário", key: "actor_nome", map: (r) => r.actor_nome ?? r.actor_email ?? "Sistema" },
      { header: "Sala", key: "sala_nome", map: (r) => r.sala_id ? (salaMap.get(r.sala_id) ?? "—") : "—" },
      { header: "Evento", key: "event_type", map: (r) => cfgOf(r.event_type).label },
      { header: "Descrição", key: "description" },
    ];
    const filename = "movimentacoes_" + new Date().toISOString().slice(0,10);
    const meta = { title: "Histórico de Movimentações", subtitle: `${rows.length} registros`, companyName: "Estoque Pro", logoUrl, user: profile?.nome ?? null };
    if (formato === "xlsx") exportToExcel(filename, cols as any, rows as any);
    else if (formato === "pdf") await exportReportPdf(filename, cols as any, rows as any, meta);
    else printReport(cols as any, rows as any, meta);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Movimentações" description="Histórico unificado de todas as ações do sistema." />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Hoje" value={kpis.hoje} />
        <KpiCard label="Últimos 7 dias" value={kpis.semana} />
        <KpiCard label="Requisições aprovadas" value={kpis.reqApr} accent="text-blue-600" />
        <KpiCard label="Empréstimos aprovados" value={kpis.empApr} accent="text-orange-600" />
        <KpiCard label="Entradas de estoque" value={kpis.entradas} accent="text-success" />
        <KpiCard label="Saídas de estoque" value={kpis.saidas} accent="text-destructive" />
      </div>

      {/* Filtros */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold flex items-center gap-2">
            Filtros
            {filtrosAtivos > 0 && <Badge variant="secondary">{filtrosAtivos} ativo(s)</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {filtrosAtivos > 0 && (
              <Button size="sm" variant="ghost" onClick={limparFiltros}><X className="size-3.5 mr-1" /> Limpar</Button>
            )}
            <Button size="sm" variant="outline" onClick={() => exportar("xlsx")}><FileSpreadsheet className="size-4 mr-1.5" /> Excel</Button>
            <Button size="sm" variant="outline" onClick={() => exportar("pdf")}><FileDown className="size-4 mr-1.5" /> PDF</Button>
            <Button size="sm" variant="outline" onClick={() => exportar("print")}><Printer className="size-4 mr-1.5" /> Imprimir</Button>
            <Button size="icon" variant="secondary" onClick={() => { setCursor(null); fetchPage(true); carregarKpis(); }} disabled={loading} title="Atualizar">
              <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2 space-y-1.5">
            <Label className="text-xs">Pesquisar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Produto, sala, usuário, descrição…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setCursor(null); fetchPage(true); } }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-72">
                {TIPO_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sala</Label>
            <Select value={salaId} onValueChange={setSalaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {salas.map(s => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      {/* Timeline */}
      <Card className="p-0 overflow-hidden">
        {rows.length === 0 && !loading && (
          <div className="px-4 py-16 text-center text-muted-foreground text-sm">
            Nenhuma movimentação encontrada com os filtros aplicados.
          </div>
        )}
        {loading && rows.length === 0 && (
          <div className="px-4 py-16 text-center"><Loader2 className="size-6 animate-spin mx-auto text-primary" /></div>
        )}
        <div className="divide-y">
          {grouped.map(g => (
            <div key={g.key} className="px-4 py-3">
              <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm py-2 mb-2 flex items-center gap-2 border-b">
                <Clock className="size-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</span>
                <span className="text-xs text-muted-foreground">· {g.items.length} evento(s)</span>
              </div>
              <ol className="relative border-l border-border ml-3 space-y-3">
                {g.items.map(r => (
                  <TimelineItem key={r.id} row={r} salaNome={r.sala_id ? salaMap.get(r.sala_id) ?? null : null} />
                ))}
              </ol>
            </div>
          ))}
        </div>
        <div className="px-4 py-3 border-t flex justify-center">
          {hasMore ? (
            <Button variant="outline" onClick={() => fetchPage(false)} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ChevronDown className="size-4 mr-2" />}
              Carregar mais
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Fim do histórico</span>
          )}
        </div>
      </Card>
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent ?? "text-foreground"}`}>{value}</div>
    </Card>
  );
}

function TimelineItem({ row, salaNome }: { row: LogRow; salaNome: string | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ItemDetalhe[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);
  const cfg = cfgOf(row.event_type);
  const meta = row.metadata || {};

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && items === null) await carregarItens();
  };

  const carregarItens = async () => {
    if (!row.entity_type || !row.entity_id) { setItems([]); return; }
    setLoadingItems(true);
    try {
      let result: ItemDetalhe[] = [];
      if (row.entity_type === "solicitacao") {
        const { data } = await supabase.from("solicitacao_itens")
          .select("quantidade, produto:produtos(nome, unidade)")
          .eq("solicitacao_id", row.entity_id);
        result = (data ?? []).map((i: any) => ({ produto: i.produto?.nome ?? "?", quantidade: `${i.quantidade} ${i.produto?.unidade ?? ""}`.trim() }));
      } else if (row.entity_type === "emprestimo") {
        const { data } = await supabase.from("emprestimo_itens")
          .select("quantidade, quantidade_devolvida, produto:produtos(nome, unidade)")
          .eq("emprestimo_id", row.entity_id);
        result = (data ?? []).map((i: any) => ({
          produto: i.produto?.nome ?? "?",
          quantidade: `${i.quantidade} ${i.produto?.unidade ?? ""}`.trim(),
          extra: i.quantidade_devolvida ? `devolvido: ${i.quantidade_devolvida}` : undefined,
        }));
      } else if (row.entity_type === "devolucao") {
        const { data } = await supabase.from("devolucao_itens")
          .select("quantidade, produto:produtos(nome, unidade)")
          .eq("devolucao_id", row.entity_id);
        result = (data ?? []).map((i: any) => ({ produto: i.produto?.nome ?? "?", quantidade: `${i.quantidade} ${i.produto?.unidade ?? ""}`.trim() }));
      } else if (row.entity_type === "consumo_interno") {
        const { data } = await supabase.from("consumos_internos")
          .select("quantidade, motivo, observacao, produto:produtos(nome, unidade)")
          .eq("id", row.entity_id).maybeSingle();
        if (data) result = [{ produto: (data as any).produto?.nome ?? "?", quantidade: `${(data as any).quantidade} ${(data as any).produto?.unidade ?? ""}`.trim(), extra: (data as any).motivo }];
      } else if (row.entity_type === "produto" && (meta.diferenca !== undefined || meta.saldo_final !== undefined)) {
        // estoque.ajustado
        const { data } = await supabase.from("produtos").select("nome, unidade").eq("id", row.entity_id).maybeSingle();
        const d = Number(meta.diferenca ?? 0);
        result = [{ produto: (data as any)?.nome ?? "?", quantidade: `${d >= 0 ? "+" : ""}${d} ${(data as any)?.unidade ?? ""}`.trim(), extra: `saldo final: ${meta.saldo_final}` }];
      }
      setItems(result);
    } finally { setLoadingItems(false); }
  };

  return (
    <li className="ml-4 pb-2">
      <span className="absolute -left-1.5 mt-1.5 size-3 rounded-full bg-primary ring-4 ring-background" />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground tabular-nums">{timeOf(row.created_at)}</span>
        <span className="font-medium text-foreground">{row.actor_nome ?? row.actor_email ?? "Sistema"}</span>
        {salaNome && <Badge variant="secondary" className="text-[10px]">📍 {salaNome}</Badge>}
        <Badge variant="outline" className={cfg.color + " uppercase text-[10px]"}>{cfg.label}</Badge>
      </div>
      <div className="mt-1 text-sm">{row.description}</div>
      <button onClick={toggle} className="text-xs text-primary hover:underline mt-1 inline-flex items-center gap-1">
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {open ? "Ocultar detalhes" : "Ver detalhes"}
      </button>
      {open && (
        <div className="mt-2 rounded-md bg-muted/40 border border-border p-3 space-y-2 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4">
            <div><span className="text-muted-foreground">Quem: </span><span className="font-medium">{row.actor_nome ?? "—"}{row.actor_email ? ` (${row.actor_email})` : ""}</span></div>
            <div><span className="text-muted-foreground">Quando: </span>{new Date(row.created_at).toLocaleString("pt-BR")}</div>
            <div><span className="text-muted-foreground">Sala: </span>{salaNome ?? "—"}</div>
            <div><span className="text-muted-foreground">Categoria: </span>{row.event_category}</div>
            <div className="sm:col-span-2"><span className="text-muted-foreground">Tipo técnico: </span><code>{row.event_type}</code></div>
          </div>

          {loadingItems && <div className="text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Carregando produtos…</div>}
          {!loadingItems && items && items.length > 0 && (
            <div>
              <div className="text-muted-foreground mb-1">Produtos envolvidos:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {items.map((it, i) => (
                  <li key={i}>
                    <span className="font-medium">{it.produto}</span>
                    {it.quantidade !== undefined && <span> — {it.quantidade}</span>}
                    {it.extra && <span className="text-muted-foreground"> ({it.extra})</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {meta.observacao && (
            <div><span className="text-muted-foreground">Motivo/Observação: </span>{String(meta.observacao)}</div>
          )}
          {meta.sala_destino && (
            <div><span className="text-muted-foreground">Sala destino: </span>{String(meta.sala_destino)}</div>
          )}
          {meta.retirado_por && (
            <div><span className="text-muted-foreground">Retirado por: </span>{String(meta.retirado_por)}</div>
          )}
        </div>
      )}
    </li>
  );
}
