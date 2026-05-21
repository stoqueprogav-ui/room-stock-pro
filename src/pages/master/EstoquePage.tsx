import { useEffect, useMemo, useState } from "react";
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
import { toast } from "sonner";
import { AlertTriangle, Pencil, Search, ArrowDownToLine, ArrowUpFromLine, Loader2, AlertOctagon, CheckCircle2, Tag } from "lucide-react";
import type { Sala, Produto, Categoria } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

type Row = { produto_id: string; sala_id: string; quantidade: number; produto: Produto; sala: Sala };
type StatusKind = "ok" | "baixo" | "critico";
type SortKey = "nome" | "quantidade" | "menor";

function getStatus(q: number, p: Produto): StatusKind {
  const minimo = p.estoque_minimo ?? 0;
  if (q <= 0) return "critico";
  if (q <= minimo) return "baixo";
  return "ok";
}

export default function EstoquePage() {
  const { role, profile } = useAuth();
  const isMaster = role === "master";
  // Hook chamado sempre — só consumimos o valor quando o role for master
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

  // Modal de Entrada/Saída rápida (a partir da linha do produto)
  const [movOpen, setMovOpen] = useState(false);
  const [movTipo, setMovTipo] = useState<"entrada" | "saida">("entrada");
  const [movRow, setMovRow] = useState<Row | null>(null);
  const [movQtd, setMovQtd] = useState<number>(0);
  const [movObs, setMovObs] = useState("");
  const [movSaving, setMovSaving] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: e }, { data: c }] = await Promise.all([
      supabase.from("salas").select("*").order("nome"),
      supabase.from("estoque").select("produto_id, sala_id, quantidade, produtos!inner(*, categoria:categorias(id, nome)), salas(*)").eq("produtos.ativo", true),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    setSalas((s as Sala[]) ?? []);
    setCategorias((c as Categoria[]) ?? []);
    const mapped: Row[] = (e ?? []).map((r: any) => ({
      produto_id: r.produto_id,
      sala_id: r.sala_id,
      quantidade: r.quantidade,
      produto: r.produtos,
      sala: r.salas,
    }));
    setRows(mapped);
  };

  useEffect(() => { load(); }, []);

  // Sincronização em tempo real — fonte única de verdade (estoque/produtos/movimentações)
  useRealtimeSync(["estoque", "produtos", "movimentacoes", "salas", "categorias"], () => { load(); }, { debounceMs: 250 });

  // Para admin/analista, fixa o filtro na própria sala
  useEffect(() => {
    if (!isMaster && profile?.sala_id) setSalaFilterUI(profile.sala_id);
  }, [isMaster, profile]);

  // Sala efetiva considerando o escopo do master
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

  // (lista de produtos não é mais necessária — modal opera sobre uma linha específica)

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
    setMovOpen(true);
  };

  const confirmarMov = async () => {
    if (!movRow) return;
    if (!movQtd || movQtd <= 0) return toast.error("Quantidade inválida");

    const atual = movRow.quantidade;
    const novoSaldo = movTipo === "entrada" ? atual + movQtd : atual - movQtd;
    if (novoSaldo < 0) return toast.error("Estoque insuficiente para esta saída");

    setMovSaving(true);
    const { error } = await supabase.rpc("ajustar_estoque", {
      _produto: movRow.produto_id,
      _sala: movRow.sala_id,
      _quantidade: novoSaldo,
      _observacao: `${movTipo === "entrada" ? "Entrada" : "Saída"} rápida${movObs ? ` — ${movObs}` : ""}`,
    });
    setMovSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${movTipo === "entrada" ? "Entrada" : "Saída"} de ${movQtd} ${movRow.produto.unidade} registrada`);
    setMovOpen(false);
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

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="w-[130px]">Categoria</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right w-[110px]">Quantidade</TableHead>
              <TableHead className="text-right w-[80px]">Mín.</TableHead>
              <TableHead className="w-[130px]">Status</TableHead>
              {isMaster && <TableHead className="w-[260px] text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={`${r.produto_id}-${r.sala_id}`} className="table-row-hover">
                <TableCell className="font-medium">{r.produto.nome} <span className="text-muted-foreground text-xs">({r.produto.unidade})</span></TableCell>
                <TableCell>
                  {(r.produto as any)?.categoria?.nome
                    ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {(r.produto as any).categoria.nome}</Badge>
                    : <span className="text-xs text-muted-foreground">—</span>}
                </TableCell>
                <TableCell>{r.sala.nome}</TableCell>
                <TableCell className="text-right font-mono font-semibold">{r.quantidade}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{r.produto.estoque_minimo}</TableCell>
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
                      <Button variant="ghost" size="icon" title="Ajustar quantidade exata" onClick={() => { setEditing(r); setEditValue(r.quantidade); setEditObs(""); }}>
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {filtered.length === 0 && <TableRow><TableCell colSpan={isMaster ? 8 : 7} className="text-center text-muted-foreground py-12">Sem resultados.</TableCell></TableRow>}
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

      {/* Modal: Entrada/Saída rápida (a partir de uma linha) */}
      <Dialog open={movOpen} onOpenChange={setMovOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {movTipo === "entrada"
                ? <><ArrowDownToLine className="size-5 text-success" /> Entrada de produto</>
                : <><ArrowUpFromLine className="size-5 text-destructive" /> Saída de produto</>}
            </DialogTitle>
            <DialogDescription>
              {movRow && (
                <>
                  <span className="font-medium text-foreground">{movRow.produto.nome}</span>
                  {" · "}{movRow.sala.nome}
                  {" · estoque atual: "}
                  <span className="font-mono text-foreground">{movRow.quantidade} {movRow.produto.unidade}</span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Quantidade</Label>
              <Input
                type="number"
                min={1}
                autoFocus
                value={movQtd || ""}
                onChange={(e) => setMovQtd(Number(e.target.value))}
                onKeyDown={(e) => { if (e.key === "Enter" && movQtd > 0) confirmarMov(); }}
              />
              {movRow && movQtd > 0 && (
                <div className="text-xs text-muted-foreground">
                  Novo saldo: <span className="font-mono text-foreground font-semibold">
                    {movTipo === "entrada" ? movRow.quantidade + movQtd : movRow.quantidade - movQtd}
                  </span>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Textarea value={movObs} onChange={(e) => setMovObs(e.target.value)} placeholder="Ex: Compra NF 1234 / Uso evento X" rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovOpen(false)}>Cancelar</Button>
            <Button
              onClick={confirmarMov}
              disabled={movSaving || movQtd <= 0}
              className={movTipo === "saida"
                ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                : "bg-success hover:bg-success/90 text-success-foreground"}
            >
              {movSaving && <Loader2 className="size-4 animate-spin" />}
              {movTipo === "entrada" ? "Confirmar entrada" : "Confirmar saída"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
