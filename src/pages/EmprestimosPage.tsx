import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, ArrowRight, Archive, Printer, UserCheck, Eye, Undo2, MessageCircle, Search, ChevronDown, Package, Repeat, Filter, Calendar, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveSala } from "@/contexts/ActiveSalaContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { formatDateTime } from "@/lib/format";
import ArquivarRetiradaDialog from "@/components/ArquivarRetiradaDialog";
import RevisarPedidoDialog from "@/components/RevisarPedidoDialog";
import DevolverEmprestimoDialog from "@/components/DevolverEmprestimoDialog";
import EditarEmprestimoDialog from "@/components/EditarEmprestimoDialog";
import { Pencil } from "lucide-react";


type Emp = {
  id: string;
  status: "pendente" | "aprovado" | "rejeitado" | "arquivado";
  observacao: string | null;
  created_at: string;
  sala_origem_id: string;
  sala_destino_id: string;
  solicitante_id: string | null;
  retirado_por: string | null;
  retirado_em: string | null;
  origem: { nome: string };
  destino: { nome: string };
  solicitante: { nome: string } | null;
  itens: { quantidade: number; quantidade_devolvida: number; produto: { nome: string; unidade: string } }[];
};

export default function EmprestimosPage({ approveOnly = false }: { approveOnly?: boolean }) {
  const { role, profile } = useAuth();
  const { activeSalaId } = useActiveSala();
  const navigate = useNavigate();
  const { scopeSalaId } = useMasterScope();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado" | "arquivado">("pendente");
  const [rows, setRows] = useState<Emp[]>([]);
  const [busca, setBusca] = useState("");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [arquivarId, setArquivarId] = useState<string | null>(null);
  const [revisarId, setRevisarId] = useState<string | null>(null);
  const [devolverId, setDevolverId] = useState<string | null>(null);
  const [editarId, setEditarId] = useState<string | null>(null);

  const load = useCallback(async () => {
    let q = supabase
      .from("emprestimos")
      .select(`id, status, observacao, created_at, sala_origem_id, sala_destino_id, solicitante_id, retirado_por, retirado_em,
               origem:salas!emprestimos_sala_origem_id_fkey(nome),
               destino:salas!emprestimos_sala_destino_id_fkey(nome),
               solicitante:profiles!emprestimos_solicitante_id_fkey(nome),
               itens:emprestimo_itens(quantidade, quantidade_devolvida, produto:produtos(nome, unidade))`)
      .order("created_at", { ascending: false });
    if (role === "master" && scopeSalaId) {
      q = q.or(`sala_origem_id.eq.${scopeSalaId},sala_destino_id.eq.${scopeSalaId}`);
    }
    const { data } = await q;
    setRows((data as any) ?? []);
  }, [role, scopeSalaId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["emprestimos", "emprestimo_itens", "devolucoes", "estoque", "dividas"], load, { debounceMs: 300 });


  const decidir = async (id: string, ap: boolean) => {
    const { error } = await supabase.rpc("decidir_emprestimo", { _emp: id, _aprovar: ap });
    if (error) return toast.error(error.message);
    toast.success(ap ? "Empréstimo aprovado: estoque transferido e dívida registrada" : "Empréstimo rejeitado");
    load();
  };

  const arquivarRejeitado = async (id: string) => {
    const { error } = await supabase.rpc("arquivar_emprestimo", { _emp: id } as any);
    if (error) return toast.error(error.message);
    toast.success("Empréstimo arquivado");
    load();
  };

  const confirmarArquivar = async (data: { retirado_por: string; retirado_em: string }) => {
    if (!arquivarId) return;
    const { error } = await supabase.rpc("arquivar_emprestimo", {
      _emp: arquivarId,
      _retirado_por: data.retirado_por,
      _retirado_em: data.retirado_em,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Empréstimo arquivado com retirada registrada");
    setArquivarId(null);
    load();
  };

  const abrirChat = async (id: string) => {
    const { data, error } = await supabase.rpc("get_or_create_pedido_conversation", { _kind: "emprestimo", _id: id });
    if (error) return toast.error(error.message);
    navigate(`/app/chat?c=${data}`);
  };

  const podeDecidir = (e: Emp) =>
    role === "admin" && activeSalaId === e.sala_origem_id;

  // Apenas o criador da solicitação OU usuários da mesma sala devedora (destino) podem editar.
  // A sala credora (origem) NUNCA pode editar — apenas aprovar/rejeitar.
  const podeEditar = (e: Emp) =>
    e.status === "pendente" && (
      role === "master" ||
      (!!profile?.id && profile.id === e.solicitante_id) ||
      (!!activeSalaId && activeSalaId === e.sala_destino_id)
    );

  const pendenteTotal = (e: Emp) =>
    (e.itens ?? []).reduce((s, it) => s + (it.quantidade - (it.quantidade_devolvida ?? 0)), 0);

  const list = useMemo(() => {
    let l = rows.filter((r) => r.status === tab);
    if (approveOnly) l = l.filter((r) => r.sala_origem_id === activeSalaId);
    if (dataIni) l = l.filter((e) => e.created_at >= dataIni);
    if (dataFim) l = l.filter((e) => e.created_at <= dataFim + "T23:59:59");
    if (busca.trim()) {
      const t = busca.trim().toLowerCase();
      l = l.filter((e) =>
        e.origem.nome.toLowerCase().includes(t) ||
        e.destino.nome.toLowerCase().includes(t) ||
        (e.solicitante?.nome ?? "").toLowerCase().includes(t) ||
        (e.observacao ?? "").toLowerCase().includes(t) ||
        (e.retirado_por ?? "").toLowerCase().includes(t) ||
        e.id.toLowerCase().includes(t) ||
        e.itens.some((it) => it.produto.nome.toLowerCase().includes(t)),
      );
    }
    return l;
  }, [rows, tab, approveOnly, activeSalaId, busca, dataIni, dataFim]);

  const filtrosAtivos = !!(dataIni || dataFim);

  return (
    <div className="space-y-4">
      <PageHeader
        title={approveOnly ? "Pedidos de empréstimo recebidos" : (role === "master" ? "Controle de empréstimos" : "Empréstimos entre salas")}
        description={
          approveOnly
            ? "Outras salas pediram emprestado da sua sala. Aprove para transferir o estoque."
            : role === "master"
              ? "Visualização de todos os empréstimos. A aprovação é feita pelo administrador da sala que empresta."
              : "Histórico completo de transferências entre salas."
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="pendente">Pendentes</TabsTrigger>
            <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
            <TabsTrigger value="rejeitado">Rejeitados</TabsTrigger>
            <TabsTrigger value="arquivado">Arquivados</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input placeholder="Buscar sala, produto, ID..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
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
          {list.length === 0 && (
            <div className="panel p-12 text-center text-muted-foreground">Nenhum empréstimo.</div>
          )}
          {list.map((e) => (
            <EmprestimoCard
              key={e.id}
              e={e}
              tab={tab}
              role={role}
              podeDecidir={podeDecidir(e)}
              podeEditar={podeEditar(e)}
              pendente={pendenteTotal(e)}
              onRevisar={() => setRevisarId(e.id)}
              onEditar={() => setEditarId(e.id)}
              onAprovar={() => decidir(e.id, true)}
              onRejeitar={() => decidir(e.id, false)}
              onDevolver={() => setDevolverId(e.id)}
              onArquivarAprovado={() => setArquivarId(e.id)}
              onArquivarRejeitado={() => arquivarRejeitado(e.id)}
              onImprimir={() => window.open(`/app/emprestimos/${e.id}/imprimir`, "_blank")}
              onChat={() => abrirChat(e.id)}
            />
          ))}
        </TabsContent>
      </Tabs>

      <ArquivarRetiradaDialog
        open={!!arquivarId}
        onOpenChange={(v) => !v && setArquivarId(null)}
        tipo="emprestimo"
        onConfirm={confirmarArquivar}
      />

      <RevisarPedidoDialog
        open={!!revisarId}
        onOpenChange={(v) => !v && setRevisarId(null)}
        kind="emprestimo"
        id={revisarId}
        canDecide={!!revisarId && (rows.find((r) => r.id === revisarId)?.status === "pendente") && (() => {
          const e = rows.find((r) => r.id === revisarId);
          return !!e && role === "admin" && activeSalaId === e.sala_origem_id;
        })()}
        onDecidir={async (id, ap) => { await decidir(id, ap); }}
      />

      <DevolverEmprestimoDialog
        open={!!devolverId}
        onOpenChange={(v) => !v && setDevolverId(null)}
        emprestimoId={devolverId}
        onDone={load}
      />

      <EditarEmprestimoDialog
        open={!!editarId}
        onOpenChange={(v) => !v && setEditarId(null)}
        emprestimoId={editarId}
        onSaved={load}
      />
    </div>
  );
}

function EmprestimoCard({
  e, tab, role, podeDecidir, podeEditar, pendente,
  onRevisar, onEditar, onAprovar, onRejeitar, onDevolver, onArquivarAprovado, onArquivarRejeitado, onImprimir, onChat,
}: {
  e: Emp; tab: string; role: string | null; podeDecidir: boolean; podeEditar: boolean; pendente: number;
  onRevisar: () => void; onEditar: () => void; onAprovar: () => void; onRejeitar: () => void;
  onDevolver: () => void; onArquivarAprovado: () => void; onArquivarRejeitado: () => void;
  onImprimir: () => void; onChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const shortId = e.id.slice(0, 8).toUpperCase();
  const totalItens = e.itens.length;

  return (
    <div className="panel overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-muted/20 transition">
          <CollapsibleTrigger className="flex items-center gap-3 min-w-0 flex-1 text-left">
            <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : "-rotate-90"}`} />
            <Repeat className="size-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-bold text-sm">EMP-#{shortId}</span>
                <StatusBadge status={e.status} />
                <Badge variant="secondary" className="gap-1 h-5"><Package className="size-3" /> {totalItens}</Badge>
                {e.status === "aprovado" && pendente > 0 && (
                  <Badge variant="outline" className="gap-1 h-5 border-amber-500/40 text-amber-600 dark:text-amber-400">
                    {pendente} pendente(s)
                  </Badge>
                )}
                {e.status === "aprovado" && pendente === 0 && (
                  <Badge variant="outline" className="gap-1 h-5 border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                    devolvido
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                <span className="inline-flex items-center gap-1 text-foreground font-medium">
                  {e.origem.nome} <ArrowRight className="size-3 text-muted-foreground" /> {e.destino.nome}
                </span>
                <span>·</span>
                <span>{e.solicitante?.nome ?? "—"}</span>
                <span>·</span>
                <span>{formatDateTime(e.created_at)}</span>
                {e.retirado_por && <><span>·</span><span className="text-success inline-flex items-center gap-1"><UserCheck className="size-3" /> {e.retirado_por}</span></>}
              </div>
            </div>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="ghost" onClick={onChat} title="Chat"><MessageCircle className="size-4" /></Button>
            {tab === "pendente" && (
              <>
                {podeDecidir ? (
                  <Button size="sm" onClick={onRevisar}><Eye className="size-4" /> Revisar</Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={onRevisar}><Eye className="size-4" /> Ver</Button>
                )}
                {podeEditar && (
                  <Button size="sm" variant="outline" onClick={onEditar} title="Editar solicitação"><Pencil className="size-4" /> Editar</Button>
                )}
              </>
            )}
            {(tab === "aprovado" || tab === "arquivado") && (
              <Button size="sm" variant="outline" onClick={onImprimir}><Printer className="size-4" /> PDF</Button>
            )}
          </div>
        </div>

        <CollapsibleContent className="border-t border-border">
          {/* Itens */}
          <div className="px-4 py-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border/60">
                  <th className="text-left py-1 font-normal">Produto</th>
                  <th className="text-right py-1 font-normal w-32">Quantidade</th>
                  {e.status === "aprovado" && <th className="text-right py-1 font-normal w-32">Devolvido</th>}
                  {e.status === "aprovado" && <th className="text-right py-1 font-normal w-32">Pendente</th>}
                </tr>
              </thead>
              <tbody>
                {e.itens.map((it, i) => {
                  const pend = it.quantidade - (it.quantidade_devolvida ?? 0);
                  return (
                    <tr key={i} className="border-b border-border/30 last:border-b-0">
                      <td className="py-1.5">{it.produto.nome}</td>
                      <td className="py-1.5 text-right font-mono">{it.quantidade} <span className="text-muted-foreground text-xs">{it.produto.unidade}</span></td>
                      {e.status === "aprovado" && <td className="py-1.5 text-right font-mono text-emerald-600 dark:text-emerald-400">{it.quantidade_devolvida ?? 0}</td>}
                      {e.status === "aprovado" && <td className={`py-1.5 text-right font-mono font-semibold ${pend === 0 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}`}>{pend}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {e.observacao && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-sm">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">Observação: </span>
              <span className="italic">"{e.observacao}"</span>
            </div>
          )}

          {e.retirado_por && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-xs flex items-center gap-2">
              <UserCheck className="size-3.5 text-success" />
              <span><span className="font-semibold">Retirada:</span> {e.retirado_por}</span>
              {e.retirado_em && <span className="text-muted-foreground">· {formatDateTime(e.retirado_em)}</span>}
            </div>
          )}

          <div className="px-4 py-3 border-t border-border bg-background flex flex-wrap items-center justify-end gap-2">
            {tab === "pendente" && podeDecidir && (
              <>
                <Button size="sm" variant="outline" onClick={onRejeitar}><X className="size-4" /> Rejeitar</Button>
                <Button size="sm" onClick={onAprovar}><Check className="size-4" /> Aprovar</Button>
              </>
            )}
            {tab === "pendente" && !podeDecidir && (
              <span className="text-xs text-muted-foreground">Aguardando admin da sala de origem.</span>
            )}
            {tab === "aprovado" && role === "master" && pendente > 0 && (
              <Button size="sm" variant="secondary" onClick={onDevolver}>
                <Undo2 className="size-4" /> Devolver ({pendente})
              </Button>
            )}
            {tab === "aprovado" && role === "master" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pendente > 0}
                title={pendente > 0 ? `Devolva todos os itens antes de arquivar (${pendente} pendente(s))` : "Arquivar"}
                onClick={onArquivarAprovado}
              >
                <Archive className="size-4" /> Arquivar
              </Button>
            )}
            {tab === "rejeitado" && role === "master" && (
              <Button size="sm" variant="ghost" onClick={onArquivarRejeitado}><Archive className="size-4" /> Arquivar</Button>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
