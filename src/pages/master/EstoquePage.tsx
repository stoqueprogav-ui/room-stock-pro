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
import { AlertTriangle, Pencil, Search, ArrowDownToLine, ArrowUpFromLine, Loader2, AlertOctagon, CheckCircle2, Tag, Trash2, X, Calendar, ChevronDown, ChevronRight, TrendingUp, Receipt, Scale as ScaleIcon } from "lucide-react";
import type { Sala, Produto, Categoria } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveSala } from "@/contexts/ActiveSalaContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

type Row = { produto_id: string; sala_id: string; quantidade: number; quantidade_reservada: number; custo_medio: number; valor_total: number; ativo: boolean; produto: Produto; sala: Sala };
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
  const { role } = useAuth();
  const { activeSalaId } = useActiveSala();
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
  const [editProdSala, setEditProdSala] = useState<Sala | null>(null);
  const [editProdForm, setEditProdForm] = useState({ nome: "", categoria_id: "", unidade: "Unidade", estoque_minimo: 0, descricao: "" });
  const [savingProd, setSavingProd] = useState(false);

  // Avaliação patrimonial (dentro do editar produto)
  type ResumoAval = { tem_avaliacao: boolean; tipo: string | null; quantidade_coberta: number; valor_unitario: number; valor_total: number; ultima_atualizacao: string | null; responsavel_nome: string | null; motivo: string | null };
  type HistAval = { id: string; created_at: string; quantidade: number; valor_anterior: number | null; valor_novo: number; tipo_anterior: string | null; tipo_novo: string; motivo: string; responsavel_nome: string | null };
  const [resumoAval, setResumoAval] = useState<ResumoAval | null>(null);
  const [histAval, setHistAval] = useState<HistAval[]>([]);
  const [loadingAval, setLoadingAval] = useState(false);
  const [updAvalOpen, setUpdAvalOpen] = useState(false);
  const MOTIVOS_AVAL = ["Regularização inicial", "Atualização de mercado", "Correção administrativa", "Ajuste patrimonial", "Inventário", "Outro"];
  const [updAvalForm, setUpdAvalForm] = useState<{ valor: string; tipo: "estimado" | "confirmado"; motivo: string; motivoOutro: string }>({ valor: "", tipo: "estimado", motivo: MOTIVOS_AVAL[0], motivoOutro: "" });
  const [savingAval, setSavingAval] = useState(false);


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
  // Avaliação patrimonial por (produto, sala)
  type AvalInfo = { tipo: "confirmado" | "estimado"; qtd: number; valor: number };
  const [avaliacoes, setAvaliacoes] = useState<Map<string, AvalInfo>>(new Map());

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
      supabase.from("estoque").select("produto_id, sala_id, quantidade, quantidade_reservada, custo_medio, valor_total, ativo, produtos!inner(*, categoria:categorias(id, nome)), salas(*)").eq("produtos.ativo", true),
      supabase.from("categorias").select("*").order("nome"),
      supabase.from("entradas_estoque").select("produto_id, sala_id, valor_unitario, fornecedor, data_entrada").order("data_entrada", { ascending: false }).limit(2000),
    ]);
    setSalas((s as Sala[]) ?? []);
    setCategorias((c as Categoria[]) ?? []);
    const mapped: Row[] = (e ?? []).map((r: any) => ({
      produto_id: r.produto_id,
      sala_id: r.sala_id,
      quantidade: r.quantidade,
      quantidade_reservada: Number(r.quantidade_reservada ?? 0),
      custo_medio: Number(r.custo_medio ?? 0),
      valor_total: Number(r.valor_total ?? 0),
      ativo: r.ativo !== false,
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

    // Avaliações patrimoniais ativas (quantidade_restante > 0)
    if (isMaster) {
      const { data: avs } = await (supabase as any)
        .from("avaliacoes_patrimoniais")
        .select("produto_id, sala_id, tipo, quantidade_restante, valor_unitario")
        .gt("quantidade_restante", 0);
      const am = new Map<string, AvalInfo>();
      (avs ?? []).forEach((a: any) => {
        const k = `${a.produto_id}-${a.sala_id}`;
        const cur = am.get(k);
        const val = Number(a.quantidade_restante) * Number(a.valor_unitario);
        if (!cur) {
          am.set(k, { tipo: a.tipo, qtd: Number(a.quantidade_restante), valor: val });
        } else {
          // Se qualquer camada é 'confirmado', considera confirmado
          am.set(k, {
            tipo: cur.tipo === "confirmado" || a.tipo === "confirmado" ? "confirmado" : "estimado",
            qtd: cur.qtd + Number(a.quantidade_restante),
            valor: cur.valor + val,
          });
        }
      });
      setAvaliacoes(am);
    }
  };

  useEffect(() => { load(); }, []);
  useRealtimeSync(["estoque", "produtos", "movimentacoes", "salas", "categorias", "entradas_estoque"], () => { load(); }, { debounceMs: 250 });

  useEffect(() => {
    if (!isMaster && activeSalaId) setSalaFilterUI(activeSalaId);
  }, [isMaster, activeSalaId]);

  const effectiveSalaFilter: string = isMaster
    ? (masterScope.scopeSalaId ?? "all")
    : (activeSalaId ?? "all");

  const filtered = useMemo(() => {
    const base = rows
      .filter((r) => isMaster || r.ativo)
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
    const inScope = rows
      .filter((r) => isMaster || r.ativo)
      .filter((r) => effectiveSalaFilter === "all" || r.sala_id === effectiveSalaFilter);
    let critico = 0, baixo = 0, ok = 0;
    inScope.forEach((r) => {
      const s = getStatus(r.quantidade, r.produto);
      if (s === "critico") critico++;
      else if (s === "baixo") baixo++;
      else ok++;
    });
    return { critico, baixo, ok, total: inScope.length };
  }, [rows, effectiveSalaFilter, isMaster]);

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
  const loadAvalProduto = async (produtoId: string, salaId: string) => {
    setLoadingAval(true);
    try {
      const [{ data: r }, { data: h }] = await Promise.all([
        (supabase as any).rpc("resumo_avaliacao_produto", { _produto: produtoId, _sala: salaId }),
        (supabase as any).rpc("listar_historico_avaliacao_produto", { _produto: produtoId, _sala: salaId }),
      ]);
      setResumoAval((r?.[0] as ResumoAval) ?? null);
      setHistAval((h as HistAval[]) ?? []);
    } finally {
      setLoadingAval(false);
    }
  };

  const openEditProduto = (p: Produto, sala?: Sala) => {
    setEditProd(p);
    setEditProdSala(sala ?? null);
    setEditProdForm({
      nome: p.nome,
      categoria_id: (p as any).categoria_id ?? "",
      unidade: p.unidade ?? "Unidade",
      estoque_minimo: p.estoque_minimo ?? 0,
      descricao: p.descricao ?? "",
    });
    setResumoAval(null);
    setHistAval([]);
    if (sala && isMaster) loadAvalProduto(p.id, sala.id);
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
    setEditProdSala(null);
    load();
  };

  const abrirAtualizarAval = () => {
    setUpdAvalForm({
      valor: resumoAval?.valor_unitario ? String(resumoAval.valor_unitario) : "",
      tipo: (resumoAval?.tipo as any) === "confirmado" ? "confirmado" : "estimado",
      motivo: MOTIVOS_AVAL[0],
      motivoOutro: "",
    });
    setUpdAvalOpen(true);
  };

  const salvarAtualizacaoAval = async () => {
    if (!editProd || !editProdSala) return;
    const valor = parseFloat(String(updAvalForm.valor).replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) return toast.error("Valor unitário inválido");
    const motivoFinal = updAvalForm.motivo === "Outro" ? updAvalForm.motivoOutro.trim() : updAvalForm.motivo;
    if (!motivoFinal) return toast.error("Motivo é obrigatório");
    setSavingAval(true);
    const { error } = await (supabase as any).rpc("atualizar_avaliacao_patrimonial_produto", {
      _produto: editProd.id,
      _sala: editProdSala.id,
      _valor_unitario: valor,
      _tipo: updAvalForm.tipo,
      _motivo: motivoFinal,
    });
    setSavingAval(false);
    if (error) return toast.error(error.message);
    toast.success("Avaliação patrimonial atualizada");
    setUpdAvalOpen(false);
    await loadAvalProduto(editProd.id, editProdSala.id);
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
              <TableHead className="text-right w-[80px]" title="Estoque físico">Físico</TableHead>
              <TableHead className="text-right w-[90px]" title="Comprometido por empréstimos pendentes">Reservado</TableHead>
              <TableHead className="text-right w-[90px]" title="Disponível = Físico − Reservado">Disponível</TableHead>
              <TableHead className="text-right w-[70px]">Mín.</TableHead>
              {isMaster && <TableHead className="text-right w-[110px]">CMP</TableHead>}
              {isMaster && <TableHead className="text-right w-[120px]">V. estoque</TableHead>}
              {isMaster && <TableHead className="w-[150px]">Última compra</TableHead>}
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
                  {isMaster ? (
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
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <span>{r.produto.nome}</span>
                      <span className="text-muted-foreground text-xs">({r.produto.unidade})</span>
                    </span>
                  )}
                  {(() => {
                    const av = avaliacoes.get(`${r.produto_id}-${r.sala_id}`);
                    if (!av) {
                      if (r.quantidade > 0 && r.valor_total <= 0 && isMaster) {
                        return <div className="mt-1"><Badge variant="outline" className="text-[10px] border-warning/50 text-warning">Sem avaliação patrimonial</Badge></div>;
                      }
                      return null;
                    }
                    return (
                      <div className="mt-1">
                        <Badge variant={av.tipo === "confirmado" ? "default" : "secondary"} className="text-[10px]" title={`${av.qtd} un · ${BRL(av.valor)}`}>
                          Aval. {av.tipo === "confirmado" ? "confirmada" : "estimada"}
                        </Badge>
                      </div>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  {(r.produto as any)?.categoria?.nome
                    ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {(r.produto as any).categoria.nome}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{r.sala.nome}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{r.quantidade}</TableCell>
                <TableCell className="text-right font-mono text-warning">{r.quantidade_reservada > 0 ? r.quantidade_reservada : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right font-mono font-semibold text-primary">{Math.max(r.quantidade - r.quantidade_reservada, 0)}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.produto.estoque_minimo}</TableCell>
                {isMaster && <TableCell className="text-right font-mono text-xs">{r.custo_medio > 0 ? BRL(r.custo_medio) : <span className="text-muted-foreground">—</span>}</TableCell>}
                {isMaster && <TableCell className="text-right font-mono text-xs text-success font-semibold">{r.valor_total > 0 ? BRL(r.valor_total) : <span className="text-muted-foreground font-normal">—</span>}</TableCell>}
                {isMaster && (
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
                )}
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <StatusBadgeCell q={r.quantidade} p={r.produto} />
                    {!r.ativo && <Badge className="bg-muted text-muted-foreground border text-[10px]">Inativo nesta sala</Badge>}
                  </div>
                </TableCell>
                {isMaster && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5 flex-wrap">
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
                      <Button
                        variant="ghost"
                        size="icon"
                        title={r.ativo ? "Desativar nesta sala" : "Ativar nesta sala"}
                        onClick={async () => {
                          const novoAtivo = !r.ativo;
                          const { error } = await supabase.rpc("toggle_produto_sala_ativo", { _produto_id: r.produto_id, _sala_id: r.sala_id, _ativo: novoAtivo });
                          if (error) return toast.error(error.message);
                          toast.success(novoAtivo ? `Ativado em ${r.sala.nome}` : `Desativado em ${r.sala.nome}`);
                          load();
                        }}
                      >
                        {r.ativo ? <X className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
                      </Button>
                      <Button variant="ghost" size="icon" title="Editar produto" onClick={() => openEditProduto(r.produto, r.sala)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Excluir produto" onClick={() => { setDelMode("sala"); setConfirmDel({ produto: r.produto, sala: r.sala }); }}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
              {isMaster && expanded.has(`${r.produto_id}-${r.sala_id}`) && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell colSpan={13} className="p-0">
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
            {filtered.length === 0 && <TableRow><TableCell colSpan={isMaster ? 13 : 8} className="text-center text-muted-foreground py-12">Sem resultados.</TableCell></TableRow>}
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
      <Dialog open={!!editProd} onOpenChange={(v) => { if (!v) { setEditProd(null); setEditProdSala(null); } }}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
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

            {/* Seção: Avaliação Patrimonial (Master + sala definida) */}
            {isMaster && editProdSala && (() => {
              const qtdEstoque = rows.find((rr) => rr.produto_id === editProd?.id && rr.sala_id === editProdSala.id)?.quantidade ?? 0;
              const valUnit = Number(resumoAval?.valor_unitario ?? 0);
              const valTot = Number(resumoAval?.valor_total ?? 0);
              return (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2 mt-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold flex items-center gap-1.5">
                      <ScaleIcon className="size-4 text-primary" /> Avaliação Patrimonial
                      <span className="text-xs text-muted-foreground font-normal">· {editProdSala.nome}</span>
                    </div>
                    <Button size="sm" onClick={abrirAtualizarAval} disabled={loadingAval || qtdEstoque <= 0}>
                      Atualizar avaliação
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <div className="rounded border bg-card p-2">
                      <div className="text-muted-foreground text-[10px] uppercase">Qtd atual</div>
                      <div className="font-mono font-semibold">{qtdEstoque}</div>
                    </div>
                    <div className="rounded border bg-card p-2">
                      <div className="text-muted-foreground text-[10px] uppercase">Valor unitário</div>
                      <div className="font-mono font-semibold">{valUnit > 0 ? BRL(valUnit) : "—"}</div>
                    </div>
                    <div className="rounded border bg-card p-2">
                      <div className="text-muted-foreground text-[10px] uppercase">Valor total</div>
                      <div className="font-mono font-semibold text-success">{valTot > 0 ? BRL(valTot) : "—"}</div>
                    </div>
                    <div className="rounded border bg-card p-2">
                      <div className="text-muted-foreground text-[10px] uppercase">Tipo</div>
                      <div>
                        {resumoAval?.tipo
                          ? <Badge variant={resumoAval.tipo === "confirmado" ? "default" : "secondary"} className="text-[10px]">{resumoAval.tipo === "confirmado" ? "Confirmado" : "Estimado"}</Badge>
                          : <span className="text-muted-foreground">Sem avaliação</span>}
                      </div>
                    </div>
                  </div>
                  {resumoAval?.tem_avaliacao && (
                    <div className="text-[11px] text-muted-foreground">
                      Última atualização: {resumoAval.ultima_atualizacao ? new Date(resumoAval.ultima_atualizacao).toLocaleString("pt-BR") : "—"}
                      {resumoAval.responsavel_nome ? ` · por ${resumoAval.responsavel_nome}` : ""}
                      {resumoAval.motivo ? ` · motivo: ${resumoAval.motivo}` : ""}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground italic">
                    Esta edição altera apenas a Avaliação Patrimonial. Não afeta estoque, custo médio, entradas, saídas ou compras.
                  </div>

                  {histAval.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs cursor-pointer text-primary hover:underline">Histórico ({histAval.length})</summary>
                      <div className="mt-2 rounded border bg-card overflow-x-auto max-h-64">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-xs">Data</TableHead>
                              <TableHead className="text-xs">Valor</TableHead>
                              <TableHead className="text-xs">Tipo</TableHead>
                              <TableHead className="text-xs">Responsável</TableHead>
                              <TableHead className="text-xs">Motivo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {histAval.map((h) => (
                              <TableRow key={h.id}>
                                <TableCell className="text-xs">{new Date(h.created_at).toLocaleString("pt-BR")}</TableCell>
                                <TableCell className="text-xs font-mono">
                                  {h.valor_anterior != null && <span className="text-muted-foreground">{BRL(Number(h.valor_anterior))} → </span>}
                                  <span className="font-semibold">{BRL(Number(h.valor_novo))}</span>
                                </TableCell>
                                <TableCell className="text-xs">
                                  {h.tipo_anterior && <span className="text-muted-foreground">{h.tipo_anterior} → </span>}
                                  {h.tipo_novo}
                                </TableCell>
                                <TableCell className="text-xs">{h.responsavel_nome ?? "—"}</TableCell>
                                <TableCell className="text-xs">{h.motivo}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </details>
                  )}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditProd(null); setEditProdSala(null); }}>Cancelar</Button>
            <Button onClick={salvarProduto} disabled={savingProd}>
              {savingProd && <Loader2 className="size-4 animate-spin" />} Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Atualizar Avaliação Patrimonial */}
      <Dialog open={updAvalOpen} onOpenChange={setUpdAvalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ScaleIcon className="size-5 text-primary" /> Atualizar Avaliação Patrimonial</DialogTitle>
            <DialogDescription>
              {editProd?.nome} · {editProdSala?.nome}. Esta alteração <strong>não</strong> altera estoque, custo médio ou movimentações.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Valor unitário (R$) *</Label>
                <Input type="number" step="0.01" min={0} value={updAvalForm.valor}
                  onChange={(e) => setUpdAvalForm({ ...updAvalForm, valor: e.target.value })} autoFocus />
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={updAvalForm.tipo} onValueChange={(v: any) => setUpdAvalForm({ ...updAvalForm, tipo: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="estimado">Estimado</SelectItem>
                    <SelectItem value="confirmado">Confirmado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Motivo da atualização *</Label>
              <Select value={updAvalForm.motivo} onValueChange={(v) => setUpdAvalForm({ ...updAvalForm, motivo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MOTIVOS_AVAL.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              {updAvalForm.motivo === "Outro" && (
                <Input placeholder="Descreva o motivo" value={updAvalForm.motivoOutro}
                  onChange={(e) => setUpdAvalForm({ ...updAvalForm, motivoOutro: e.target.value })} />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdAvalOpen(false)}>Cancelar</Button>
            <Button onClick={salvarAtualizacaoAval} disabled={savingAval}>
              {savingAval && <Loader2 className="size-4 animate-spin" />} Salvar avaliação
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

type EntradaHistRow = { id: string; data_entrada: string; quantidade: number; valor_unitario: number; valor_total: number; fornecedor: string | null; numero_nf: string | null; usuario_responsavel_nome: string | null };

function FichaFinanceira({ row, loading, entradas }: { row: Row; loading: boolean; entradas: EntradaHistRow[] }) {
  // Evolução de preços (asc por data)
  const serie = useMemo(() => [...entradas].reverse(), [entradas]);
  const total = entradas.length;
  const totalQtdComprada = entradas.reduce((s, e) => s + Number(e.quantidade ?? 0), 0);
  const totalInvestido = entradas.reduce((s, e) => s + Number(e.valor_total ?? 0), 0);

  // Sparkline SVG
  const sparkline = useMemo(() => {
    if (serie.length < 2) return null;
    const valores = serie.map((e) => Number(e.valor_unitario));
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const w = 260, h = 50, pad = 4;
    const dx = (w - pad * 2) / (serie.length - 1);
    const range = max - min || 1;
    const pts = valores.map((v, i) => `${pad + i * dx},${h - pad - ((v - min) / range) * (h - pad * 2)}`).join(" ");
    return { w, h, pts, min, max, primeiro: valores[0], ultimo: valores[valores.length - 1] };
  }, [serie]);

  if (loading) {
    return <div className="p-6 text-center text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin inline mr-2" />Carregando ficha financeira…</div>;
  }

  return (
    <div className="p-4 md:p-5 space-y-4 border-t-2 border-primary/30">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Receipt className="size-4 text-primary" />
        Ficha financeira · {row.produto.nome} <span className="text-muted-foreground font-normal">· {row.sala.nome}</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Estoque atual</div>
          <div className="font-display text-lg font-bold">{row.quantidade} <span className="text-xs text-muted-foreground">{row.produto.unidade}</span></div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground flex items-center justify-between gap-1">
            <span>Custo médio</span>
            <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${row.custo_medio > 0 ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
              {row.custo_medio > 0 ? "Valorizado" : "Sem valorização"}
            </span>
          </div>
          <div className="font-display text-lg font-bold">{row.custo_medio > 0 ? BRL(row.custo_medio) : "—"}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Valor em estoque</div>
          <div className="font-display text-lg font-bold text-success">{BRL(row.valor_total)}</div>
        </div>
        <div className="rounded-md border bg-card p-3">
          <div className="text-[10px] uppercase text-muted-foreground">Total investido (histórico)</div>
          <div className="font-display text-lg font-bold">{BRL(totalInvestido)}</div>
          <div className="text-[10px] text-muted-foreground">{totalQtdComprada} unid. em {total} compra(s)</div>
        </div>
      </div>

      {/* Evolução de preços */}
      {sparkline && (
        <div className="rounded-md border bg-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold flex items-center gap-1.5"><TrendingUp className="size-3.5 text-primary" /> Evolução do preço unitário</div>
            <div className="text-xs text-muted-foreground">
              {BRL(sparkline.min)} → {BRL(sparkline.max)}
              <span className={`ml-2 font-mono ${sparkline.ultimo > sparkline.primeiro ? "text-destructive" : "text-success"}`}>
                {sparkline.ultimo > sparkline.primeiro ? "▲" : "▼"} {BRL(sparkline.ultimo)}
              </span>
            </div>
          </div>
          <svg width={sparkline.w} height={sparkline.h} className="overflow-visible">
            <polyline points={sparkline.pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" />
            {serie.map((_e, i) => {
              const [x, y] = sparkline.pts.split(" ")[i].split(",").map(Number);
              return <circle key={i} cx={x} cy={y} r={2.5} fill="hsl(var(--primary))" />;
            })}
          </svg>
        </div>
      )}

      {/* Histórico */}
      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Data</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">V. unit.</TableHead>
              <TableHead className="text-right">V. total</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>NF</TableHead>
              <TableHead>Usuário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entradas.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs">{new Date(e.data_entrada).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right font-mono">{e.quantidade}</TableCell>
                <TableCell className="text-right font-mono">{BRL(Number(e.valor_unitario))}</TableCell>
                <TableCell className="text-right font-mono font-semibold text-success">{BRL(Number(e.valor_total))}</TableCell>
                <TableCell className="text-sm">{e.fornecedor ?? "—"}</TableCell>
                <TableCell className="text-xs">{e.numero_nf ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.usuario_responsavel_nome ?? "—"}</TableCell>
              </TableRow>
            ))}
            {entradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6 text-sm">
                  Nenhuma compra registrada para este produto nesta sala.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
