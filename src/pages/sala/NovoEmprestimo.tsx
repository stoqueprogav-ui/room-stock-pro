import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Send, Trash2, Loader2, Search, Tag, Plus, Minus, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Sala, Categoria } from "@/lib/types";
import { useDraft } from "@/hooks/useDraft";
import DraftStatusBadge from "@/components/DraftStatusBadge";
import RecoverDraftDialog from "@/components/RecoverDraftDialog";
import { useActiveSala } from "@/contexts/ActiveSalaContext";

// Item de catálogo (identidade única)
type Catalogo = {
  id: string;
  nome: string;
  unidade_padrao: string;
  categoria_id: string | null;
  categoria?: { id: string; nome: string } | null;
};

// Disponibilidade de um catálogo em uma sala
type DispRow = {
  sala_id: string;
  sala_nome: string;
  produto_id: string;
  unidade: string;
  custo_unitario: number;
  quantidade_disponivel: number;
  atende_pct: number;
  atende_total: boolean;
};

type Nivel = "verde" | "amarelo" | "vermelho";
const nivelFromRow = (r: DispRow, qtd: number): Nivel => {
  if (r.atende_total) return "verde";
  if (r.quantidade_disponivel > 0) return "amarelo";
  return "vermelho";
};
const nivelEmoji = (n: Nivel) => (n === "verde" ? "🟢" : n === "amarelo" ? "🟡" : "🔴");
const nivelLabel = (n: Nivel) =>
  n === "verde" ? "Atende total" : n === "amarelo" ? "Atende parcial" : "Sem estoque";

export default function NovoEmprestimo() {
  const { profile } = useAuth();
  const { activeSalaId } = useActiveSala();
  const navigate = useNavigate();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [catalogo, setCatalogo] = useState<Catalogo[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catFilter, setCatFilter] = useState<string>("");
  const [busca, setBusca] = useState("");

  // carrinho: catalogo_id -> quantidade
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});

  // Disponibilidade: catalogo_id -> DispRow[]
  const [disp, setDisp] = useState<Record<string, DispRow[]> | null>(null);
  const [buscando, setBuscando] = useState(false);

  const [salaSelecionada, setSalaSelecionada] = useState<string | null>(null);
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);

  const [recoverOpen, setRecoverOpen] = useState(false);
  const [recoverMeta, setRecoverMeta] = useState<{ updatedAt: number; itemCount?: number; payload: any } | null>(null);

  const scope = profile?.id ? `emprestimo:new:${profile.id}` : null;
  const draftValue = useMemo(() => ({ carrinho, obs, catFilter, busca }), [carrinho, obs, catFilter, busca]);
  const carrinhoCount = Object.values(carrinho).filter((q) => q > 0).length;
  const { status: draftStatus, lastSaved, clear: clearDraft, load: loadDraft } = useDraft({
    scope,
    value: draftValue,
    itemCount: carrinhoCount,
    label: "Novo empréstimo",
    isEmpty: (v) => !v || (Object.values(v.carrinho ?? {}).every((q) => !q) && !v.obs),
  });

  useEffect(() => {
    (async () => {
      const [{ data: ss }, { data: cat }, { data: cc }] = await Promise.all([
        supabase.from("salas").select("*").order("nome"),
        supabase.from("produtos_catalogo")
          .select("id, nome, unidade_padrao, categoria_id, categoria:categorias(id, nome)")
          .eq("ativo", true).order("nome"),
        supabase.from("categorias").select("*").order("nome"),
      ]);
      setSalas((ss as Sala[]) ?? []);
      setCatalogo((cat as any) ?? []);
      setCategorias((cc as Categoria[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    (async () => {
      const d = await loadDraft();
      if (cancelled || !d) return;
      const hasContent = Object.values((d.payload?.carrinho ?? {}) as Record<string, number>).some((q) => q > 0) || !!d.payload?.obs;
      if (!hasContent) return;
      setRecoverMeta({ updatedAt: d.updatedAt, itemCount: d.itemCount, payload: d.payload });
      setRecoverOpen(true);
    })();
    return () => { cancelled = true; };
  }, [scope, loadDraft]);

  const aplicarRecuperacao = () => {
    const p = recoverMeta?.payload; if (!p) return;
    if (p.carrinho) setCarrinho(p.carrinho);
    if (typeof p.obs === "string") setObs(p.obs);
    if (typeof p.catFilter === "string") setCatFilter(p.catFilter);
    if (typeof p.busca === "string") setBusca(p.busca);
    setRecoverOpen(false);
    toast.success("Rascunho recuperado");
  };
  const descartarRecuperacao = async () => { await clearDraft(); setRecoverOpen(false); };

  const catalogoFiltrado = useMemo(
    () =>
      catalogo
        .filter((p) => !catFilter || p.categoria_id === catFilter)
        .filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase())),
    [catalogo, catFilter, busca]
  );

  const itensCarrinho = useMemo(
    () =>
      Object.entries(carrinho)
        .map(([id, q]) => ({ item: catalogo.find((p) => p.id === id)!, quantidade: q }))
        .filter((i) => i.item && i.quantidade > 0),
    [carrinho, catalogo]
  );

  const setQtd = (id: string, q: number) => {
    const nv = Math.max(0, Math.floor(q || 0));
    setCarrinho((c) => {
      const next = { ...c };
      if (nv === 0) delete next[id];
      else next[id] = nv;
      return next;
    });
  };

  const buscarDisponibilidade = async () => {
    if (itensCarrinho.length === 0) return toast.error("Adicione produtos ao carrinho");
    setBuscando(true);
    setDisp(null);
    setSalaSelecionada(null);

    const results: Record<string, DispRow[]> = {};
    for (const it of itensCarrinho) {
      const { data, error } = await supabase.rpc("catalogo_disponibilidade" as any, {
        _catalogo: it.item.id,
        _quantidade: it.quantidade,
        _excluir_sala: activeSalaId ?? null,
      });
      if (error) {
        setBuscando(false);
        return toast.error(error.message);
      }
      results[it.item.id] = (data as DispRow[]) ?? [];
    }
    setBuscando(false);
    setDisp(results);
  };

  // Mapa: sala_id -> { catalogo_id -> DispRow }
  const dispMap = useMemo(() => {
    const m: Record<string, Record<string, DispRow>> = {};
    if (!disp) return m;
    Object.entries(disp).forEach(([catId, rows]) => {
      rows.forEach((r) => {
        m[r.sala_id] = m[r.sala_id] || {};
        m[r.sala_id][catId] = r;
      });
    });
    return m;
  }, [disp]);

  // Salas candidatas ordenadas por cobertura
  const salasCandidatas = useMemo(() => {
    if (!disp) return [];
    const lista = Object.entries(dispMap).map(([sala_id, byCat]) => {
      const sala = salas.find((s) => s.id === sala_id);
      const totais = itensCarrinho.map((i) => byCat[i.item.id]);
      const verdes = totais.filter((r) => r?.atende_total).length;
      const parciais = totais.filter((r) => r && !r.atende_total && r.quantidade_disponivel > 0).length;
      const cobre = verdes + parciais;
      return { sala_id, sala_nome: sala?.nome ?? "—", cobre, verdes, total: itensCarrinho.length };
    });
    return lista.sort((a, b) => b.verdes - a.verdes || b.cobre - a.cobre || a.sala_nome.localeCompare(b.sala_nome));
  }, [disp, dispMap, itensCarrinho, salas]);

  const itensParaSala = (sid: string) =>
    itensCarrinho
      .map((i) => {
        const row = dispMap[sid]?.[i.item.id];
        if (!row || row.quantidade_disponivel <= 0) return null;
        return { item: i.item, quantidade: i.quantidade, produto_id: row.produto_id };
      })
      .filter((x): x is { item: Catalogo; quantidade: number; produto_id: string } => !!x);

  const enviarPedidoParaSala = async (sid: string) => {
    const itens = itensParaSala(sid).map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade }));
    if (itens.length === 0) return toast.error("Esta sala não tem itens disponíveis do seu carrinho");
    setEnviando(true);
    const { error } = await supabase.rpc("criar_emprestimo", {
      _sala_origem: sid,
      _itens: itens,
      _observacao: obs || null,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Pedido enviado. Aguardando aprovação da sala de origem.");
    const enviadosCat = new Set(itensParaSala(sid).map((i) => i.item.id));
    setCarrinho((c) => {
      const next = { ...c };
      enviadosCat.forEach((cid) => delete next[cid]);
      return next;
    });
    setSalaSelecionada(null);
    if (Object.keys(carrinho).length - enviadosCat.size === 0) {
      await clearDraft();
      navigate("/app/emprestimos");
    } else {
      setDisp(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pedir empréstimo a outra sala"
        description="Monte seu carrinho, busque a disponibilidade entre as salas e envie o pedido. As quantidades de outras salas não são reveladas — apenas o nível de disponibilidade."
      />
      <div className="flex justify-end"><DraftStatusBadge status={draftStatus} lastSaved={lastSaved} /></div>


      <div className="grid lg:grid-cols-3 gap-4">
        {/* Catálogo */}
        <div className="lg:col-span-2 panel">
          <div className="p-3 border-b border-border grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Buscar produto</Label>
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do produto" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={catFilter || "all"} onValueChange={(v) => setCatFilter(v === "all" ? "" : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as categorias</SelectItem>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[480px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="w-[140px]">Categoria</TableHead>
                  <TableHead className="w-[180px]">Quantidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogoFiltrado.map((p) => {
                  const q = carrinho[p.id] ?? 0;
                  return (
                    <TableRow key={p.id} className="table-row-hover">
                      <TableCell className="font-medium">
                        {p.nome} <span className="text-muted-foreground text-xs">({p.unidade_padrao})</span>
                      </TableCell>
                      <TableCell>
                        {p.categoria?.nome
                          ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" />{p.categoria.nome}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQtd(p.id, q - 1)} disabled={q <= 0}>
                            <Minus className="size-3" />
                          </Button>
                          <Input
                            type="number"
                            min={0}
                            value={q || ""}
                            onChange={(e) => setQtd(p.id, Number(e.target.value))}
                            className="h-8 w-20 text-center"
                          />
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQtd(p.id, q + 1)}>
                            <Plus className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {catalogoFiltrado.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-12">Nenhum produto.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Carrinho */}
        <div className="panel p-4 space-y-3 h-fit">
          <h3 className="font-semibold">Carrinho ({itensCarrinho.length})</h3>
          {itensCarrinho.length === 0 ? (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
              Adicione produtos para buscar disponibilidade entre as salas.
            </div>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {itensCarrinho.map((i) => (
                <div key={i.item.id} className="flex items-center justify-between text-sm rounded border border-border px-2 py-1.5">
                  <div className="truncate">
                    <div className="font-medium truncate">{i.item.nome}</div>
                    <div className="text-xs text-muted-foreground">{i.quantidade} {i.item.unidade_padrao}</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQtd(i.item.id, 0)}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label>Observação (opcional)</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo / detalhes do pedido" />
          </div>

          <Button className="w-full" onClick={buscarDisponibilidade} disabled={buscando || itensCarrinho.length === 0}>
            {buscando ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Buscar salas disponíveis
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => { setCarrinho({}); setDisp(null); setSalaSelecionada(null); }}>
            <Trash2 className="size-4" /> Limpar carrinho
          </Button>
        </div>
      </div>

      {/* Disponibilidade entre salas */}
      {disp && itensCarrinho.length > 0 && (
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold">Salas sugeridas</h3>
              <p className="text-xs text-muted-foreground">
                🟢 atende total · 🟡 atende parcial · 🔴 sem estoque · As quantidades exatas não são exibidas.
              </p>
            </div>
          </div>

          {salasCandidatas.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma sala disponível para os produtos selecionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sala</TableHead>
                    {itensCarrinho.map((i) => (
                      <TableHead key={i.item.id} className="text-center">
                        {i.item.nome}
                        <div className="text-[10px] font-normal text-muted-foreground">qtd: {i.quantidade}</div>
                      </TableHead>
                    ))}
                    <TableHead className="text-center">Cobertura</TableHead>
                    <TableHead className="text-right w-[200px]">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {salasCandidatas.map((s) => {
                    const podeAtender = s.cobre > 0;
                    return (
                      <TableRow key={s.sala_id} className="table-row-hover">
                        <TableCell className="font-medium">{s.sala_nome}</TableCell>
                        {itensCarrinho.map((i) => {
                          const row = dispMap[s.sala_id]?.[i.item.id];
                          const n: Nivel = !row || row.quantidade_disponivel <= 0
                            ? "vermelho"
                            : row.atende_total ? "verde" : "amarelo";
                          return (
                            <TableCell key={i.item.id} className="text-center" title={nivelLabel(n)}>
                              <span className="text-lg">{nivelEmoji(n)}</span>
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {s.cobre}/{s.total}
                        </TableCell>
                        <TableCell className="text-right">
                          {salaSelecionada === s.sala_id ? (
                            <div className="flex justify-end gap-1">
                              <Button size="sm" onClick={() => enviarPedidoParaSala(s.sala_id)} disabled={enviando}>
                                {enviando ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                                Confirmar pedido
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setSalaSelecionada(null)}>Cancelar</Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant={podeAtender ? "default" : "outline"}
                              disabled={!podeAtender}
                              onClick={() => setSalaSelecionada(s.sala_id)}
                            >
                              <CheckCircle2 className="size-3" /> Pedir desta sala
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {salaSelecionada && (
            <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
              <div className="font-medium mb-1">Itens que serão solicitados a <strong>{salas.find((s) => s.id === salaSelecionada)?.nome}</strong>:</div>
              <ul className="list-disc list-inside text-muted-foreground">
                {itensParaSala(salaSelecionada).map((i) => (
                  <li key={i.item.id}>{i.item.nome} — {i.quantidade} {i.item.unidade_padrao}</li>
                ))}
              </ul>
              {itensParaSala(salaSelecionada).length < itensCarrinho.length && (
                <div className="text-xs text-amber-600 mt-2">
                  Itens sem disponibilidade nesta sala ficarão no carrinho para você pedir a outra sala.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <RecoverDraftDialog
        open={recoverOpen}
        onOpenChange={setRecoverOpen}
        updatedAt={recoverMeta?.updatedAt ?? null}
        itemCount={recoverMeta?.itemCount}
        onRecover={aplicarRecuperacao}
        onDiscard={descartarRecuperacao}
      />
    </div>
  );
}
