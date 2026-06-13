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
import type { Sala, Produto, Categoria } from "@/lib/types";
import { useDraft } from "@/hooks/useDraft";
import DraftStatusBadge from "@/components/DraftStatusBadge";
import RecoverDraftDialog from "@/components/RecoverDraftDialog";

type Nivel = "verde" | "amarelo" | "vermelho";
type DispRow = { sala_id: string; sala_nome: string; produto_id: string; nivel: Nivel };

const nivelEmoji = (n: Nivel) => (n === "verde" ? "🟢" : n === "amarelo" ? "🟡" : "🔴");
const nivelLabel = (n: Nivel) =>
  n === "verde" ? "Disponível" : n === "amarelo" ? "Estoque baixo" : "Sem estoque";

export default function NovoEmprestimo() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catFilter, setCatFilter] = useState<string>("");
  const [busca, setBusca] = useState("");

  // carrinho: produto_id -> quantidade
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  // disponibilidade por sala (resultado da busca)
  const [disp, setDisp] = useState<DispRow[] | null>(null);
  const [buscando, setBuscando] = useState(false);

  // pedido por sala (após selecionar uma sala como origem)
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
      const [{ data: ss }, { data: pp }, { data: cc }] = await Promise.all([
        supabase.from("salas").select("*").order("nome"),
        supabase.from("produtos").select("*, categoria:categorias(id, nome)").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("*").order("nome"),
      ]);
      setSalas((ss as Sala[]) ?? []);
      setProdutos((pp as any) ?? []);
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

  const produtosFiltrados = useMemo(
    () =>
      produtos
        .filter((p) => !catFilter || p.categoria_id === catFilter)
        .filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase())),
    [produtos, catFilter, busca]
  );

  const itensCarrinho = useMemo(
    () =>
      Object.entries(carrinho)
        .map(([id, q]) => ({ produto: produtos.find((p) => p.id === id)!, quantidade: q }))
        .filter((i) => i.produto && i.quantidade > 0),
    [carrinho, produtos]
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
    const ids = itensCarrinho.map((i) => i.produto.id);
    const { data, error } = await supabase.rpc("disponibilidade_produtos", { _produto_ids: ids });
    setBuscando(false);
    if (error) return toast.error(error.message);
    setDisp((data as DispRow[]) ?? []);
  };

  // Mapa: sala_id -> { produto_id -> nivel }
  const dispMap = useMemo(() => {
    const m: Record<string, Record<string, Nivel>> = {};
    (disp ?? []).forEach((r) => {
      m[r.sala_id] = m[r.sala_id] || {};
      m[r.sala_id][r.produto_id] = r.nivel;
    });
    return m;
  }, [disp]);

  // Salas candidatas: aquelas presentes no resultado, ordenadas por "completude" (mais itens verde/amarelo)
  const salasCandidatas = useMemo(() => {
    if (!disp) return [];
    const ids = itensCarrinho.map((i) => i.produto.id);
    const lista = Object.entries(dispMap).map(([sala_id, prods]) => {
      const sala = salas.find((s) => s.id === sala_id);
      const cobre = ids.filter((pid) => prods[pid] === "verde" || prods[pid] === "amarelo").length;
      const verdes = ids.filter((pid) => prods[pid] === "verde").length;
      return { sala_id, sala_nome: sala?.nome ?? "—", cobre, verdes, total: ids.length };
    });
    return lista.sort((a, b) => b.verdes - a.verdes || b.cobre - a.cobre || a.sala_nome.localeCompare(b.sala_nome));
  }, [disp, dispMap, itensCarrinho, salas]);

  const itensParaSala = (sid: string) =>
    itensCarrinho.filter((i) => {
      const n = dispMap[sid]?.[i.produto.id];
      return n === "verde" || n === "amarelo";
    });

  const enviarPedidoParaSala = async (sid: string) => {
    const itens = itensParaSala(sid).map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade }));
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
    // remove os itens já solicitados do carrinho
    setCarrinho((c) => {
      const next = { ...c };
      itens.forEach((i) => delete next[i.produto_id]);
      return next;
    });
    setSalaSelecionada(null);
    if (Object.keys(carrinho).length - itens.length === 0) {
      await clearDraft();
      navigate("/app/emprestimos");
    } else {
      // re-buscar disponibilidade dos restantes
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
                {produtosFiltrados.map((p) => {
                  const q = carrinho[p.id] ?? 0;
                  return (
                    <TableRow key={p.id} className="table-row-hover">
                      <TableCell className="font-medium">
                        {p.nome} <span className="text-muted-foreground text-xs">({p.unidade})</span>
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
                {produtosFiltrados.length === 0 && (
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
                <div key={i.produto.id} className="flex items-center justify-between text-sm rounded border border-border px-2 py-1.5">
                  <div className="truncate">
                    <div className="font-medium truncate">{i.produto.nome}</div>
                    <div className="text-xs text-muted-foreground">{i.quantidade} {i.produto.unidade}</div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQtd(i.produto.id, 0)}>
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
                🟢 disponível · 🟡 estoque baixo · 🔴 sem estoque · As quantidades exatas não são exibidas.
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
                      <TableHead key={i.produto.id} className="text-center">
                        {i.produto.nome}
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
                          const n = dispMap[s.sala_id]?.[i.produto.id] ?? "vermelho";
                          return (
                            <TableCell key={i.produto.id} className="text-center" title={nivelLabel(n)}>
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
                  <li key={i.produto.id}>{i.produto.nome} — {i.quantidade} {i.produto.unidade}</li>
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
    </div>
  );
}
