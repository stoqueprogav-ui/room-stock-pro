import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, Pencil, Search, ArrowDownToLine, ArrowUpFromLine, Loader2, AlertOctagon, CheckCircle2, Tag, Trash2, X, Calendar, ChevronDown, ChevronRight, TrendingUp, Receipt } from "lucide-react";
import type { Sala, Produto, Categoria } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

type Row = { produto_id: string; sala_id: string; quantidade: number; custo_medio: number; valor_total: number; produto: Produto; sala: Sala };
type UltimaEntrada = { data: string; valor_unitario: number; fornecedor: string | null };
type StatusKind = "ok" | "baixo" | "critico";
type SortKey = "nome" | "quantidade" | "menor";

const BRL = (v: number) => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const MOTIVOS_SAIDA = ["Consumo interno", "Quebra/Avaria", "Vencido", "Uso em evento", "Ajuste de inventário", "Outros"];

const UNIDADES_PRESET = ["Unidade", "Caixa", "Fardo", "Pacote", "Kit", "Litro", "Galão", "Rolo", "Par", "Metro"];

function getStatus(q: number, p: Produto): StatusKind {
  const minimo = p.estoque_minimo ?? 0;
  if (q <= 0) return "critico";
  if (q <= minimo) return "baixo";
  return "ok";
}

export default function EstoquePage() {
  const { role, profile } = useAuth();
  const isMaster = role === "master";
  const masterScope = useMasterScope();

  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [busca, setBusca] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | StatusKind>("todos");
  const [sort, setSort] = useState<SortKey>("nome");
  const [salaFilterUI, setSalaFilterUI] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");

  const [editing, setEditing] = useState<Row | null>(null);
  const [editValue, setEditValue] = useState(0);
  const [editObs, setEditObs] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Edição rápida do PRODUTO
  const [editProd, setEditProd] = useState<Produto | null>(null);
  const [editProdForm, setEditProdForm] = useState({ nome: "", categoria_id: "", unidade: "Unidade", estoque_minimo: 0, descricao: "" });
  const [savingProd, setSavingProd] = useState(false);

  // Exclusão individual e em massa
  const [confirmDel, setConfirmDel] = useState<{ produto: Produto; sala: Sala } | null>(null);
  const [delMode, setDelMode] = useState<"sala" | "todas">("sala");
  const [delLoading, setDelLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Modal de Entrada/Saída
  const [movOpen, setMovOpen] = useState(false);
  const [movTipo, setMovTipo] = useState<"entrada" | "saida">("entrada");
  const [movRow, setMovRow] = useState<Row | null>(null);
  const [movQtd, setMovQtd] = useState<number>(0);
  const [movObs, setMovObs] = useState("");
  const [movSaving, setMovSaving] = useState(false);

  // Entrada (compra) – formulário completo
  const [entradaForm, setEntradaForm] = useState({
    quantidade: 0,
    valor_unitario: 0,
    fornecedor: "",
    numero_nf: "",
    observacao: "",
  });

  // Saída – motivo + observação
  const [saidaMotivo, setSaidaMotivo] = useState<string>("Consumo interno");

  // Última entrada por (produto, sala)
  const [ultimas, setUltimas] = useState<Map<string, UltimaEntrada>>(new Map());

  // Ficha financeira expandida
  type EntradaHist = { id: string; data_entrada: string; quantidade: number; valor_unitario: number; valor_total: number; fornecedor: string | null; numero_nf: string | null; usuario_responsavel_nome: string | null };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<Map<string, EntradaHist[]>>(new Map());
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());

  const toggleExpand = async (r: Row) => {
    const key = `${r.produto_id}-${r.sala_id}`;
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
    if (!history.has(key)) {
      setHistoryLoading((p) => new Set(p).add(key));
      const { data } = await supabase
        .from("entradas_estoque")
        .select("id, data_entrada, quantidade, valor_unitario, valor_total, fornecedor, numero_nf, usuario_responsavel_nome")
        .eq("produto_id", r.produto_id)
        .eq("sala_id", r.sala_id)
        .order("data_entrada", { ascending: false })
        .limit(100);
      setHistory((m) => new Map(m).set(key, (data as EntradaHist[]) ?? []));
      setHistoryLoading((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  };

  const load = async () => {
    const [{ data: s }, { data: e }, { data: c }, { data: ents }] = await Promise.all([
      supabase.from("salas").select("*").order("nome"),
      supabase.from("estoque").select("produto_id, sala_id, quantidade, custo_medio, valor_total, produtos!inner(*, categoria:categorias(id, nome)), salas(*)").eq("produtos.ativo", true),
      supabase.from("categorias").select("*").order("nome"),
      supabase.from("entradas_estoque").select("produto_id, sala_id, valor_unitario, fornecedor, data_entrada").order("data_entrada", { ascending: false }).limit(2000),
    ]);
    setSalas((s as Sala[]) ?? []);
    setCategorias((c as Categoria[]) ?? []);
    const mapped: Row[] = (e ?? []).map((r: any) => ({
      produto_id: r.produto_id,
      sala_id: r.sala_id,
      quantidade: r.quantidade,
      custo_medio: Number(r.custo_medio ?? 0),
      valor_total: Number(r.valor_total ?? 0),
      produto: r.produtos,
      sala: r.salas,
    }));
    setRows(mapped);
    const map = new Map<string, UltimaEntrada>();
    (ents ?? []).forEach((row: any) => {
      const k = `${row.produto_id}-${row.sala_id}`;
      if (!map.has(k)) map.set(k, { data: row.data_entrada, valor_unitario: Number(row.valor_unitario), fornecedor: row.fornecedor });
    });
    setUltimas(map);
  };

  useEffect(() => { load(); }, []);
  useRealtimeSync(["estoque", "produtos", "movimentacoes", "salas", "categorias", "entradas_estoque"], () => { load(); }, { debounceMs: 250 });

  useEffect(() => {
    if (!isMaster && profile?.sala_id) setSalaFilterUI(profile.sala_id);
  }, [isMaster, profile]);

  const effectiveSalaFilter: string = isMaster
    ? (masterScope.scopeSalaId ?? "all")
    : (profile?.sala_id ?? "all");

  const filtered = useMemo(() => {
    const base = rows
      .filter((r) => effectiveSalaFilter === "all" || r.sala_id === effectiveSalaFilter)
      .filter((r) => catFilter === "all" || (r.produto as any)?.categoria_id === catFilter)
      .filter((r) => !busca || r.produto.nome.toLowerCase().includes(busca.toLowerCase()))
      .filter((r) => {
        if (statusFilter === "todos") return true;
        return getStatus(r.quantidade, r.produto) === statusFilter;
      });

    return base.sort((a, b) => {
      if (sort === "quantidade") return b.quantidade - a.quantidade;
      if (sort === "menor") return a.quantidade - b.quantidade;
      return a.produto.nome.localeCompare(b.produto.nome) || a.sala.nome.localeCompare(b.sala.nome);
    });
  }, [rows, effectiveSalaFilter, catFilter, busca, statusFilter, sort]);

  const counts = useMemo(() => {
    const inScope = rows.filter((r) => effectiveSalaFilter === "all" || r.sala_id === effectiveSalaFilter);
    let critico = 0, baixo = 0, ok = 0;
    inScope.forEach((r) => {
      const s = getStatus(r.quantidade, r.produto);
      if (s === "critico") critico++;
      else if (s === "baixo") baixo++;
      else ok++;
    });
    return { critico, baixo, ok, total: inScope.length };
  }, [rows, effectiveSalaFilter]);

  const distinctProdutoIdsFiltered = useMemo(() => {
    const set = new Set<string>();
    filtered.forEach((r) => set.add(r.produto_id));
    return [...set];
  }, [filtered]);

  const allSelected = isMaster && distinctProdutoIdsFiltered.length > 0 && distinctProdutoIdsFiltered.every((id) => selectedIds.has(id));
  const someSelected = selectedIds.size > 0;

  const toggleOne = (produtoId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(produtoId); else next.delete(produtoId);
      return next;
    });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) distinctProdutoIdsFiltered.forEach((id) => next.add(id));
      else distinctProdutoIdsFiltered.forEach((id) => next.delete(id));
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const ajustar = async () => {
    if (!editing) return;
    setSavingEdit(true);
    const { error } = await supabase.rpc("ajustar_estoque", {
      _produto: editing.produto_id, _sala: editing.sala_id,
      _quantidade: Number(editValue), _observacao: editObs || null,
    });
    setSavingEdit(false);
    if (error) return toast.error(error.message);
    toast.success("Estoque ajustado"); setEditing(null); setEditObs(""); load();
  };

  const openMovForRow = (row: Row, tipo: "entrada" | "saida") => {
    setMovTipo(tipo);
    setMovRow(row);
    setMovQtd(0);
    setMovObs("");
    setSaidaMotivo("Consumo interno");
    setEntradaForm({ quantidade: 0, valor_unitario: Number(row.custo_medio || 0), fornecedor: "", numero_nf: "", observacao: "" });
    setMovOpen(true);
  };

  const confirmarMov = async () => {
    if (!movRow) return;

    if (movTipo === "entrada") {
      const qtd = Number(entradaForm.quantidade);
      const vu = Number(entradaForm.valor_unitario);
      if (!qtd || qtd <= 0) return toast.error("Quantidade inválida");
      if (vu < 0) return toast.error("Valor unitário inválido");
      setMovSaving(true);
      const { error } = await supabase.rpc("registrar_entrada_estoque", {
        _produto: movRow.produto_id,
        _sala: movRow.sala_id,
        _quantidade: qtd,
        _valor_unitario: vu,
        _fornecedor: entradaForm.fornecedor || null,
        _numero_nf: entradaForm.numero_nf || null,
        _data_entrada: new Date().toISOString(),
        _observacao: entradaForm.observacao || null,
      });
      setMovSaving(false);
      if (error) return toast.error(error.message);
      toast.success(`Entrada de ${qtd} ${movRow.produto.unidade} registrada · CMP recalculado`);
      setMovOpen(false);
      load();
      return;
    }

    // Saída
    if (!movQtd || movQtd <= 0) return toast.error("Quantidade inválida");
    const novoSaldo = movRow.quantidade - movQtd;
    if (novoSaldo < 0) return toast.error("Estoque insuficiente para esta saída");
    setMovSaving(true);
    const { error } = await supabase.rpc("ajustar_estoque", {
      _produto: movRow.produto_id,
      _sala: movRow.sala_id,
      _quantidade: novoSaldo,
      _observacao: `Saída · ${saidaMotivo}${movObs ? ` — ${movObs}` : ""}`,
    });
    setMovSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Saída de ${movQtd} ${movRow.produto.unidade} registrada`);
    setMovOpen(false);
    load();
  };

  // -------- Edição rápida do PRODUTO --------
  const openEditProduto = (p: Produto) => {
    setEditProd(p);
    setEditProdForm({
      nome: p.nome,
      categoria_id: (p as any).categoria_id ?? "",
      unidade: p.unidade ?? "Unidade",
      estoque_minimo: p.estoque_minimo ?? 0,
      descricao: p.descricao ?? "",
    });
  };
  const salvarProduto = async () => {
    if (!editProd) return;
    if (!editProdForm.nome.trim()) return toast.error("Nome obrigatório");
    if (!editProdForm.categoria_id) return toast.error("Categoria obrigatória");
    setSavingProd(true);
    const { error } = await supabase.from("produtos").update({
      nome: editProdForm.nome.trim(),
      categoria_id: editProdForm.categoria_id,
      unidade: (editProdForm.unidade || "Unidade").trim(),
      estoque_minimo: Number(editProdForm.estoque_minimo) || 0,
      descricao: editProdForm.descricao || null,
    }).eq("id", editProd.id);
    setSavingProd(false);
    if (error) return toast.error(error.message);
    toast.success("Produto atualizado");
    setEditProd(null);
    load();
  };

  // -------- Exclusão --------
  const confirmarExclusao = async () => {
    if (!confirmDel) return;
    setDelLoading(true);
    let resp;
    if (delMode === "sala") {
      resp = await supabase.rpc("excluir_produto_sala", { _produto: confirmDel.produto.id, _sala: confirmDel.sala.id });
    } else {
      resp = await supabase.rpc("excluir_produto", { _produto: confirmDel.produto.id });
    }
    setDelLoading(false);
    const { data, error } = resp;
    if (error) return toast.error(error.message ?? "Não foi possível excluir");
    const res = (data as any) ?? {};
    if (res.modo === "desativado") toast.warning(res.mensagem ?? "Produto desativado (possui histórico ou estoque).");
    else toast.success(res.mensagem ?? "Operação concluída");
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(confirmDel.produto.id); return n; });
    setConfirmDel(null);
    setDelMode("sala");
    load();
  };

  const confirmarBulk = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBulkLoading(true);
    let excl = 0, desat = 0, erros = 0;
    for (const id of ids) {
      const { data, error } = await supabase.rpc("excluir_produto", { _produto: id });
      if (error) { erros++; continue; }
      const r = (data as any) ?? {};
      if (r.modo === "desativado") desat++;
      else excl++;
    }
    setBulkLoading(false);
    setConfirmBulk(false);
    clearSelection();
    if (erros > 0) toast.error(`${erros} falha(s) na exclusão.`);
    if (excl > 0) toast.success(`${excl} produto(s) excluído(s) permanentemente.`);
    if (desat > 0) toast.warning(`${desat} produto(s) desativado(s) (possuíam histórico/estoque).`);
    load();
  };

  const StatusBadgeCell = ({ q, p }: { q: number; p: Produto }) => {
    const s = getStatus(q, p);
    if (s === "critico") return <Badge className="bg-destructive/15 text-destructive border border-destructive/30 gap-1"><AlertOctagon className="size-3" /> Crítico</Badge>;
    if (s === "baixo") return <Badge className="bg-warning/15 text-warning border border-warning/30 gap-1"><AlertTriangle className="size-3" /> Baixo</Badge>;
    return <Badge className="bg-success/15 text-success border border-success/30 gap-1"><CheckCircle2 className="size-3" /> Normal</Badge>;
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Controle de estoque"
        description={
          isMaster
            ? (masterScope.scopeSalaId
                ? `Sala em foco: ${salas.find(s => s.id === masterScope.scopeSalaId)?.nome ?? "—"}`
                : "Modo global · todas as salas")
            : "Quantidades por produto na sua sala."
        }
        actions={undefined}
      />

      {/* Abas de categoria */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground mr-1">Categoria:</span>
        <Button size="sm" variant={catFilter === "all" ? "default" : "outline"} onClick={() => setCatFilter("all")}>
          Todas
        </Button>
        {categorias.map((c) => (
          <Button key={c.id} size="sm" variant={catFilter === c.id ? "default" : "outline"} onClick={() => setCatFilter(c.id)}>
            <Tag className="size-3" /> {c.nome}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="panel p-3">
          <div className="text-xs text-muted-foreground">Total de itens</div>
          <div className="font-display text-2xl font-bold">{counts.total}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="size-3.5 text-success" /> Normais</div>
          <div className="font-display text-2xl font-bold text-success">{counts.ok}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><AlertTriangle className="size-3.5 text-warning" /> Baixos</div>
          <div className="font-display text-2xl font-bold text-warning">{counts.baixo}</div>
        </div>
        <div className="panel p-3">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><AlertOctagon className="size-3.5 text-destructive" /> Críticos</div>
          <div className="font-display text-2xl font-bold text-destructive">{counts.critico}</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        {!isMaster && (
          <div className="space-y-1.5">
            <Label className="text-xs">Sala</Label>
            <Select value={salaFilterUI} onValueChange={setSalaFilterUI} disabled>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5 flex-1 min-w-60">
          <Label className="text-xs">Buscar produto</Label>
          <div className="relative">
            <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do produto…" className="pl-9" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              <SelectItem value="critico">Críticos</SelectItem>
              <SelectItem value="baixo">Baixos</SelectItem>
              <SelectItem value="ok">Normais</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Ordenar</Label>
          <Select value={sort} onValueChange={(v: any) => setSort(v)}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="nome">Nome (A→Z)</SelectItem>
              <SelectItem value="menor">Menor estoque primeiro</SelectItem>
              <SelectItem value="quantidade">Maior estoque primeiro</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Barra de ações em massa */}
      {isMaster && someSelected && (
        <div className="panel p-3 flex flex-wrap items-center gap-3 border-primary/40 bg-primary/5">
          <span className="text-sm font-medium">
            {selectedIds.size} produto(s) selecionado(s)
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="size-4" /> Limpar
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirmBulk(true)}>
              <Trash2 className="size-4" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {isMaster && (
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => toggleAll(!!v)}
                    aria-label="Selecionar todos"
                  />
                </TableHead>
              )}
              <TableHead>Produto</TableHead>
              <TableHead className="w-[120px]">Categoria</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right w-[90px]">Qtd</TableHead>
              <TableHead className="text-right w-[70px]">Mín.</TableHead>
              <TableHead className="text-right w-[110px]">CMP</TableHead>
              <TableHead className="text-right w-[120px]">V. estoque</TableHead>
              <TableHead className="w-[150px]">Última compra</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              {isMaster && <TableHead className="w-[320px] text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <React.Fragment key={`${r.produto_id}-${r.sala_id}`}>
              <TableRow className="table-row-hover">
                {isMaster && (
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(r.produto_id)}
                      onCheckedChange={(v) => toggleOne(r.produto_id, !!v)}
                      aria-label={`Selecionar ${r.produto.nome}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">
                  <button
                    type="button"
                    onClick={() => toggleExpand(r)}
                    className="inline-flex items-center gap-1.5 text-left hover:text-primary transition-colors"
                    title="Ficha financeira"
                  >
                    {expanded.has(`${r.produto_id}-${r.sala_id}`)
                      ? <ChevronDown className="size-4 text-muted-foreground" />
                      : <ChevronRight className="size-4 text-muted-foreground" />}
                    <span>{r.produto.nome}</span>
                    <span className="text-muted-foreground text-xs">({r.produto.unidade})</span>
                  </button>
                </TableCell>
                <TableCell>
                  {(r.produto as any)?.categoria?.nome
                    ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {(r.produto as any).categoria.nome}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{r.sala.nome}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{r.quantidade}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.produto.estoque_minimo}</TableCell>
                <TableCell className="text-right font-mono text-xs">{r.custo_medio > 0 ? BRL(r.custo_medio) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right font-mono text-xs text-success font-semibold">{r.valor_total > 0 ? BRL(r.valor_total) : <span className="text-muted-foreground font-normal">—</span>}</TableCell>
                <TableCell className="text-xs">
                  {(() => {
                    const u = ultimas.get(`${r.produto_id}-${r.sala_id}`);
                    if (!u) return <span className="text-muted-foreground">Sem compras</span>;
                    return (
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1 text-muted-foreground"><Calendar className="size-3" />{new Date(u.data).toLocaleDateString("pt-BR")}</div>
                        <div className="font-mono">{BRL(u.valor_unitario)}{u.fornecedor ? ` · ${u.fornecedor}` : ""}</div>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell><StatusBadgeCell q={r.quantidade} p={r.produto} /></TableCell>
                {isMaster && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-success/40 text-success hover:bg-success/10 hover:text-success"
                        onClick={() => openMovForRow(r, "entrada")}
                      >
                        <ArrowDownToLine className="size-3.5" /> Entrada
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => openMovForRow(r, "saida")}
                      >
                        <ArrowUpFromLine className="size-3.5" /> Saída
                      </Button>
                      <Button variant="ghost" size="icon" title="Editar produto" onClick={() => openEditProduto(r.produto)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Excluir produto" onClick={() => { setDelMode("sala"); setConfirmDel({ produto: r.produto, sala: r.sala }); }}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
              {expanded.has(`${r.produto_id}-${r.sala_id}`) && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={isMaster ? 11 : 9} className="p-0">
                    <FichaFinanceira
                      row={r}
                      loading={historyLoading.has(`${r.produto_id}-${r.sala_id}`)}
                      entradas={history.get(`${r.produto_id}-${r.sala_id}`) ?? []}
                    />
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={isMaster ? 11 : 9} className="text-center text-muted-foreground py-12">Sem resultados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {/* Modal: Ajustar quantidade exata */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar estoque · {editing?.produto.nome}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Sala: <span className="text-foreground font-medium">{editing?.sala.nome}</span></div>
            <div className="space-y-2"><Label>Nova quantidade</Label><Input type="number" min={0} value={editValue} onChange={(e) => setEditValue(Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Observação (opcional)</Label><Input value={editObs} onChange={(e) => setEditObs(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={ajustar} disabled={savingEdit}>
              {savingEdit && <Loader2 className="size-4 animate-spin" />} Salvar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Entrada/Saída rápida */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {movTipo === "entrada"
                ? <><ArrowDownToLine className="size-5 text-success" /> Entrada de estoque (compra)</>
                : <><ArrowUpFromLine className="size-5 text-destructive" /> Saída de produto</>}
            </DialogTitle>
            <DialogDescription>
              {movRow && (
                <>
                  <span className="font-medium text-foreground">{movRow.produto.nome}</span>
                  {" · "}{movRow.sala.nome}
                  {" · saldo atual: "}
                  <span className="font-mono text-foreground">{movRow.quantidade} {movRow.produto.unidade}</span>
                  {movTipo === "entrada" && movRow.custo_medio > 0 && (
                    <> · CMP atual: <span className="font-mono text-foreground">{BRL(movRow.custo_medio)}</span></>
                  )}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          {movTipo === "entrada" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Quantidade *</Label>
                  <Input type="number" min={1} autoFocus value={entradaForm.quantidade || ""}
                    onChange={(e) => setEntradaForm({ ...entradaForm, quantidade: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Valor unitário (R$) *</Label>
                  <Input type="number" min={0} step="0.01" value={entradaForm.valor_unitario || ""}
                    onChange={(e) => setEntradaForm({ ...entradaForm, valor_unitario: Number(e.target.value) })} />
                </div>
              </div>
              <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2 text-sm flex items-center justify-between">
                <span className="text-muted-foreground">Valor total da compra</span>
                <span className="font-display font-bold text-lg text-success">
                  {BRL(Number(entradaForm.quantidade || 0) * Number(entradaForm.valor_unitario || 0))}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Fornecedor</Label>
                  <Input value={entradaForm.fornecedor} onChange={(e) => setEntradaForm({ ...entradaForm, fornecedor: e.target.value })} placeholder="Ex: Atacadão" />
                </div>
                <div className="space-y-2">
                  <Label>Número da NF</Label>
                  <Input value={entradaForm.numero_nf} onChange={(e) => setEntradaForm({ ...entradaForm, numero_nf: e.target.value })} placeholder="Ex: 000123456" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Observação</Label>
                <Textarea value={entradaForm.observacao} onChange={(e) => setEntradaForm({ ...entradaForm, observacao: e.target.value })} rows={2} />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Quantidade *</Label>
                <Input type="number" min={1} autoFocus value={movQtd || ""}
                  onChange={(e) => setMovQtd(Number(e.target.value))}
                  onKeyDown={(e) => { if (e.key === "Enter" && movQtd > 0) confirmarMov(); }} />
                {movRow && movQtd > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Novo saldo: <span className="font-mono text-foreground font-semibold">{movRow.quantidade - movQtd}</span>
                    {movRow.custo_medio > 0 && (
                      <> · valor da saída: <span className="font-mono text-foreground">{BRL(movQtd * movRow.custo_medio)}</span></>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Motivo *</Label>
                <Select value={saidaMotivo} onValueChange={setSaidaMotivo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MOTIVOS_SAIDA.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Observação</Label>
                <Textarea value={movObs} onChange={(e) => setMovObs(e.target.value)} placeholder="Detalhes opcionais" rows={2} />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setMovOpen(false)}>Cancelar</Button>
            <Button
              onClick={confirmarMov}
              disabled={movSaving || (movTipo === "entrada" ? entradaForm.quantidade <= 0 : movQtd <= 0)}
              className={movTipo === "saida"
                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : "bg-success hover:bg-success/90 text-success-foreground"}
            >
              {movSaving && <Loader2 className="size-4 animate-spin" />}
              {movTipo === "entrada" ? "Registrar entrada" : "Confirmar saída"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Edição rápida do PRODUTO */}
      <Dialog open={!!editProd} onOpenChange={(v) => !v && setEditProd(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="size-5 text-primary" /> Editar produto</DialogTitle>
            <DialogDescription>Atualize os dados do produto. Estas alterações se aplicam a todas as salas.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Nome *</Label><Input value={editProdForm.nome} onChange={(e) => setEditProdForm({ ...editProdForm, nome: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Categoria *</Label>
              <Select value={editProdForm.categoria_id} onValueChange={(v) => setEditProdForm({ ...editProdForm, categoria_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Select
                  value={UNIDADES_PRESET.includes(editProdForm.unidade) ? editProdForm.unidade : "__custom"}
                  onValueChange={(v) => {
                    if (v === "__custom") setEditProdForm({ ...editProdForm, unidade: "" });
                    else setEditProdForm({ ...editProdForm, unidade: v });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {UNIDADES_PRESET.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    <SelectItem value="__custom">Outros (personalizado)</SelectItem>
                  </SelectContent>
                </Select>
                {!UNIDADES_PRESET.includes(editProdForm.unidade) && (
                  <Input
                    value={editProdForm.unidade}
                    onChange={(e) => setEditProdForm({ ...editProdForm, unidade: e.target.value })}
                    placeholder="Digite a unidade"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Estoque mínimo</Label>
                <Input type="number" min={0} value={editProdForm.estoque_minimo} onChange={(e) => setEditProdForm({ ...editProdForm, estoque_minimo: Number(e.target.value) })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Observações / descrição</Label>
              <Textarea value={editProdForm.descricao} onChange={(e) => setEditProdForm({ ...editProdForm, descricao: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditProd(null)}>Cancelar</Button>
            <Button onClick={salvarProduto} disabled={savingProd}>
              {savingProd && <Loader2 className="size-4 animate-spin" />} Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmar exclusão individual */}
      <Dialog open={!!confirmDel} onOpenChange={(v) => { if (!v) { setConfirmDel(null); setDelMode("sala"); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" /> Como deseja excluir este produto?
            </DialogTitle>
            <DialogDescription>
              Escolha o escopo da exclusão. Os estoques de cada sala são independentes.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 space-y-1">
            <div className="font-display font-bold text-base">{confirmDel?.produto.nome}</div>
            <div className="text-xs text-muted-foreground">Sala atual: <strong>{confirmDel?.sala.nome}</strong></div>
          </div>
          <div className="space-y-2">
            <label className="flex items-start gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/40">
              <input type="radio" name="delmode" className="mt-1" checked={delMode === "sala"} onChange={() => setDelMode("sala")} />
              <div>
                <div className="font-medium text-sm">Apenas desta sala ({confirmDel?.sala.nome})</div>
                <div className="text-xs text-muted-foreground">
                  Remove o produto somente do estoque desta sala. As demais salas não são afetadas. Histórico, requisições e empréstimos preservados.
                </div>
              </div>
            </label>
            {isMaster && (
              <label className="flex items-start gap-2 p-3 rounded-md border cursor-pointer hover:bg-muted/40">
                <input type="radio" name="delmode" className="mt-1" checked={delMode === "todas"} onChange={() => setDelMode("todas")} />
                <div>
                  <div className="font-medium text-sm">De todas as salas <span className="text-xs text-muted-foreground">(somente Master)</span></div>
                  <div className="text-xs text-muted-foreground">
                    Remove o produto de todos os estoques. Se houver histórico ou saldo, o produto é desativado em vez de apagado.
                  </div>
                </div>
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmDel(null); setDelMode("sala"); }}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={delLoading}>
              {delLoading && <Loader2 className="size-4 animate-spin" />}
              <Trash2 className="size-4" /> Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmar exclusão em massa */}
      <Dialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="size-5" /> Excluir produtos selecionados
            </DialogTitle>
            <DialogDescription>
              Você está prestes a excluir <strong>{selectedIds.size}</strong> produto(s).
              Produtos com histórico ou estoque serão automaticamente desativados (não removidos).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmBulk(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarBulk} disabled={bulkLoading}>
              {bulkLoading && <Loader2 className="size-4 animate-spin" />}
              <Trash2 className="size-4" /> Excluir {selectedIds.size} produto(s)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
