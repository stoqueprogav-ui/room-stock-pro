import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, Archive, Printer, UserCheck, MessageCircle, Search, Package, FolderTree, FileText, Tag, Loader2, Eye, ChevronDown, Filter, Calendar } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { formatDateTime } from "@/lib/format";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

import ArquivarRetiradaDialog from "@/components/ArquivarRetiradaDialog";
import RevisarPedidoDialog from "@/components/RevisarPedidoDialog";

type Item = {
  quantidade: number;
  produto: { nome: string; unidade: string; categoria: { nome: string } | null };
};

type Requisicao = {
  id: string;
  status: "pendente" | "aprovado" | "rejeitado" | "arquivado";
  observacao: string | null;
  created_at: string;
  decidido_em: string | null;
  retirado_por: string | null;
  retirado_em: string | null;
  sala: { nome: string };
  usuario: { nome: string; email: string } | null;
  itens: Item[];
};

export default function RequisicoesPage() {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { scopeSalaId } = useMasterScope();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado" | "arquivado">("pendente");
  const [rows, setRows] = useState<Requisicao[]>([]);
  const [loading, setLoading] = useState(false);
  const [busca, setBusca] = useState("");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [arquivarId, setArquivarId] = useState<string | null>(null);
  const [revisarId, setRevisarId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em, sala_id, retirado_por, retirado_em,
               sala:salas(nome),
               usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
      .order("created_at", { ascending: false });
    if (scopeSalaId) q = q.eq("sala_id", scopeSalaId);
    const { data } = await q;
    setRows((data as any) ?? []);
    setLoading(false);
  }, [scopeSalaId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["solicitacoes", "solicitacao_itens", "estoque"], load, { debounceMs: 300 });

  const decidir = async (id: string, aprovar: boolean) => {
    setActing(id);
    const { error } = await supabase.rpc("decidir_solicitacao", { _solic: id, _aprovar: aprovar });
    setActing(null);
    if (error) return toast.error(error.message);
    toast.success(aprovar ? "Requisição aprovada · estoque atualizado" : "Requisição rejeitada");
    load();
  };

  const arquivarRejeitada = async (id: string) => {
    const { error } = await supabase.rpc("arquivar_solicitacao", { _solic: id });
    if (error) return toast.error(error.message);
    toast.success("Requisição arquivada");
    load();
  };

  const confirmarArquivar = async (data: { retirado_por: string; retirado_em: string }) => {
    if (!arquivarId) return;
    const { error } = await supabase.rpc("arquivar_solicitacao", {
      _solic: arquivarId,
      _retirado_por: data.retirado_por,
      _retirado_em: data.retirado_em,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Requisição arquivada com retirada registrada");
    setArquivarId(null);
    load();
  };

  const imprimir = (id: string) => window.open(`/app/requisicoes/${id}/imprimir`, "_blank");

  const abrirChat = async (id: string) => {
    const { data, error } = await supabase.rpc("get_or_create_pedido_conversation", { _kind: "requisicao", _id: id });
    if (error) return toast.error(error.message);
    navigate(`/app/chat?c=${data}`);
  };

  const list = useMemo(() => {
    return rows
      .filter((r) => r.status === tab)
      .filter((s) => {
        if (dataIni && s.created_at < dataIni) return false;
        if (dataFim && s.created_at > dataFim + "T23:59:59") return false;
        const t = busca.trim().toLowerCase();
        if (!t) return true;
        return (
          s.sala.nome.toLowerCase().includes(t) ||
          (s.usuario?.nome ?? "").toLowerCase().includes(t) ||
          (s.usuario?.email ?? "").toLowerCase().includes(t) ||
          (s.observacao ?? "").toLowerCase().includes(t) ||
          (s.retirado_por ?? "").toLowerCase().includes(t) ||
          s.id.toLowerCase().includes(t) ||
          s.itens.some((it) => it.produto.nome.toLowerCase().includes(t))
        );
      });
  }, [rows, tab, busca, dataIni, dataFim]);

  const filtrosAtivos = !!(dataIni || dataFim);

  return (
    <div className="space-y-4">
      <PageHeader title="Requisições recebidas" description="Pedidos de produtos enviados pelas salas. A baixa no estoque ocorre apenas após sua aprovação." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="pendente">Pendentes</TabsTrigger>
            <TabsTrigger value="aprovado">Aprovadas</TabsTrigger>
            <TabsTrigger value="rejeitado">Rejeitadas</TabsTrigger>
            <TabsTrigger value="arquivado">Arquivadas</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-80">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar sala, produto, ID, retirado por..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
            </div>
            <Button variant={filtrosAtivos ? "default" : "outline"} size="sm" onClick={() => setShowFilters((v) => !v)}>
              <Filter className="size-4" /> Filtros {filtrosAtivos && <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">ativo</Badge>}
            </Button>
          </div>
        </div>

        {showFilters && (
          <div className="panel p-3 mt-2 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="size-3" /> Data inicial</label>
              <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} className="w-44" />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="size-3" /> Data final</label>
              <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-44" />
            </div>
            {filtrosAtivos && (
              <Button variant="ghost" size="sm" onClick={() => { setDataIni(""); setDataFim(""); }}>
                <X className="size-4" /> Limpar
              </Button>
            )}
            <div className="ml-auto text-xs text-muted-foreground">{list.length} resultado(s)</div>
          </div>
        )}

        <TabsContent value={tab} className="mt-4 space-y-2">
          {loading && <div className="grid place-items-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>}
          {!loading && list.length === 0 && (
            <div className="panel p-12 text-center text-muted-foreground">Nenhuma requisição.</div>
          )}
          {!loading && list.map((s) => (
            <RequisicaoCard
              key={s.id}
              s={s}
              role={role}
              tab={tab}
              acting={acting === s.id}
              onRevisar={() => setRevisarId(s.id)}
              onAprovar={() => decidir(s.id, true)}
              onRejeitar={() => decidir(s.id, false)}
              onArquivarRejeitada={() => arquivarRejeitada(s.id)}
              onArquivarAprovada={() => setArquivarId(s.id)}
              onImprimir={() => imprimir(s.id)}
              onChat={() => abrirChat(s.id)}
            />
          ))}
        </TabsContent>
      </Tabs>

      <ArquivarRetiradaDialog
        open={!!arquivarId}
        onOpenChange={(v) => !v && setArquivarId(null)}
        tipo="requisicao"
        onConfirm={confirmarArquivar}
      />

      <RevisarPedidoDialog
        open={!!revisarId}
        onOpenChange={(v) => !v && setRevisarId(null)}
        kind="requisicao"
        id={revisarId}
        canDecide={role === "master" && tab === "pendente"}
        onDecidir={async (id, ap) => { await decidir(id, ap); }}
      />
    </div>
  );
}

function RequisicaoCard({
  s, role, tab, acting,
  onRevisar, onAprovar, onRejeitar, onArquivarRejeitada, onArquivarAprovada, onImprimir, onChat,
}: {
  s: Requisicao; role: string | null; tab: string; acting: boolean;
  onRevisar: () => void; onAprovar: () => void; onRejeitar: () => void;
  onArquivarRejeitada: () => void; onArquivarAprovada: () => void;
  onImprimir: () => void; onChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of s.itens) {
      const k = it.produto.categoria?.nome ?? "Sem categoria";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [s.itens]);

  const totalProdutos = s.itens.length;
  const totalCategorias = grupos.length;
  const shortId = s.id.slice(0, 8).toUpperCase();

  return (
    <div className="panel overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/* Cabeçalho compacto (sempre visível) */}
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-muted/20 transition">
          <CollapsibleTrigger className="flex items-center gap-3 min-w-0 flex-1 text-left">
            <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : "-rotate-90"}`} />
            <FileText className="size-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-sm">REQ-#{shortId}</span>
                <StatusBadge status={s.status} />
                <Badge variant="secondary" className="gap-1 h-5"><Package className="size-3" /> {totalProdutos}</Badge>
                <Badge variant="secondary" className="gap-1 h-5"><FolderTree className="size-3" /> {totalCategorias}</Badge>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span><span className="text-foreground font-medium">{s.sala.nome}</span></span>
                <span>·</span>
                <span>{s.usuario?.nome ?? "—"}</span>
                <span>·</span>
                <span>{formatDateTime(s.created_at)}</span>
                {s.retirado_por && <><span>·</span><span className="text-success inline-flex items-center gap-1"><UserCheck className="size-3" /> {s.retirado_por}</span></>}
              </div>
            </div>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={onChat} title="Chat"><MessageCircle className="size-4" /></Button>
            {role === "master" && tab === "pendente" && (
              <Button size="sm" onClick={onRevisar}><Eye className="size-4" /> Revisar</Button>
            )}
            {role === "master" && (tab === "aprovado" || tab === "arquivado") && (
              <Button size="sm" variant="outline" onClick={onImprimir}><Printer className="size-4" /> PDF</Button>
            )}
          </div>
        </div>

        {/* Conteúdo expansível */}
        <CollapsibleContent className="border-t border-border">
          <div className="divide-y divide-border">
            {grupos.map(([cat, itens]) => (
              <div key={cat}>
                <div className="px-4 py-1.5 bg-muted/20 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <Tag className="size-3 text-primary" /> {cat}
                  <Badge variant="outline" className="h-4 text-[10px] px-1.5">{itens.length}</Badge>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {itens.map((it, i) => (
                      <tr key={i} className="border-b border-border/30 last:border-b-0">
                        <td className="px-4 py-1.5">{it.produto.nome}</td>
                        <td className="px-4 py-1.5 text-right font-mono font-semibold w-32">{it.quantidade} <span className="text-muted-foreground text-xs">{it.produto.unidade}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {s.observacao && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-sm">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Observação: </span>
              <span className="italic">"{s.observacao}"</span>
            </div>
          )}

          {s.retirado_por && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-xs flex items-center gap-2">
              <UserCheck className="size-3.5 text-success" />
              <span><span className="font-semibold">Retirada:</span> {s.retirado_por}</span>
              {s.retirado_em && <span className="text-muted-foreground">· {formatDateTime(s.retirado_em)}</span>}
            </div>
          )}

          {/* Ações completas */}
          <div className="px-4 py-3 border-t border-border bg-background flex flex-wrap items-center justify-end gap-2">
            {role === "master" && tab === "pendente" && (
              <>
                <Button size="sm" variant="outline" onClick={onRejeitar} disabled={acting}>
                  <X className="size-4" /> Rejeitar
                </Button>
                <Button size="sm" onClick={onAprovar} disabled={acting}>
                  {acting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Aprovar
                </Button>
              </>
            )}
            {role === "master" && tab === "aprovado" && (
              <Button size="sm" variant="ghost" onClick={onArquivarAprovada}><Archive className="size-4" /> Arquivar</Button>
            )}
            {role === "master" && tab === "rejeitado" && (
              <Button size="sm" variant="ghost" onClick={onArquivarRejeitada}><Archive className="size-4" /> Arquivar</Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
