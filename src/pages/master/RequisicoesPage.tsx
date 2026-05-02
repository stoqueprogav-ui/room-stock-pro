import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, ChevronDown, Archive, Printer, UserCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { formatDateTime } from "@/lib/format";
import ArquivarRetiradaDialog from "@/components/ArquivarRetiradaDialog";
import RevisarPedidoDialog from "@/components/RevisarPedidoDialog";
import { Eye } from "lucide-react";

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
  itens: { quantidade: number; produto: { nome: string; unidade: string } }[];
};

export default function RequisicoesPage() {
  const { role } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado" | "arquivado">("pendente");
  const [rows, setRows] = useState<Requisicao[]>([]);
  const [loading, setLoading] = useState(false);
  const [arquivarId, setArquivarId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em, sala_id, retirado_por, retirado_em,
               sala:salas(nome),
               usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade))`)
      .order("created_at", { ascending: false });
    if (scopeSalaId) q = q.eq("sala_id", scopeSalaId);
    const { data } = await q;
    setRows((data as any) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [scopeSalaId]);

  const decidir = async (id: string, aprovar: boolean) => {
    const { error } = await supabase.rpc("decidir_solicitacao", { _solic: id, _aprovar: aprovar });
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

  const imprimir = (id: string) => {
    window.open(`/app/requisicoes/${id}/imprimir`, "_blank");
  };

  const list = rows.filter((r) => r.status === tab);

  return (
    <div className="space-y-4">
      <PageHeader title="Requisições recebidas" description="Pedidos de produtos enviados pelas salas. A baixa no estoque ocorre apenas após sua aprovação." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="aprovado">Aprovadas</TabsTrigger>
          <TabsTrigger value="rejeitado">Rejeitadas</TabsTrigger>
          <TabsTrigger value="arquivado">Arquivadas</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Sala</TableHead>
                  <TableHead>Solicitante</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead className="w-[170px]">Criada em</TableHead>
                  <TableHead className="w-[160px]">Retirada</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  {role === "master" && <TableHead className="text-right w-[260px]">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <ReqRow key={s.id} s={s} role={role} tab={tab}
                    onDecidir={decidir}
                    onArquivarRejeitada={arquivarRejeitada}
                    onArquivarAprovada={(id) => setArquivarId(id)}
                    onImprimir={imprimir} />
                ))}
                {list.length === 0 && !loading && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-12">Nenhuma requisição.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <ArquivarRetiradaDialog
        open={!!arquivarId}
        onOpenChange={(v) => !v && setArquivarId(null)}
        tipo="requisicao"
        onConfirm={confirmarArquivar}
      />
    </div>
  );
}

function ReqRow({
  s, role, tab, onDecidir, onArquivarRejeitada, onArquivarAprovada, onImprimir,
}: {
  s: Requisicao; role: string | null; tab: string;
  onDecidir: (id: string, ap: boolean) => void;
  onArquivarRejeitada: (id: string) => void;
  onArquivarAprovada: (id: string) => void;
  onImprimir: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="table-row-hover">
        <TableCell>
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7"><ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} /></Button>
            </CollapsibleTrigger>
          </Collapsible>
        </TableCell>
        <TableCell className="font-medium">{s.sala.nome}</TableCell>
        <TableCell>
          <div className="font-medium">{s.usuario?.nome ?? "—"}</div>
          <div className="text-xs text-muted-foreground">{s.usuario?.email}</div>
        </TableCell>
        <TableCell className="text-muted-foreground">{s.itens.length} item(ns)</TableCell>
        <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
        <TableCell className="text-xs">
          {s.retirado_por ? (
            <div>
              <div className="flex items-center gap-1 font-medium text-foreground"><UserCheck className="size-3" /> {s.retirado_por}</div>
              {s.retirado_em && <div className="text-muted-foreground">{formatDateTime(s.retirado_em)}</div>}
            </div>
          ) : <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell><StatusBadge status={s.status} /></TableCell>
        {role === "master" && (
          <TableCell className="text-right whitespace-nowrap">
            {tab === "pendente" && (
              <>
                <Button size="sm" variant="outline" className="mr-2" onClick={() => onDecidir(s.id, false)}><X className="size-4" /> Rejeitar</Button>
                <Button size="sm" onClick={() => onDecidir(s.id, true)}><Check className="size-4" /> Aprovar</Button>
              </>
            )}
            {tab === "aprovado" && (
              <>
                <Button size="sm" variant="outline" className="mr-2" onClick={() => onImprimir(s.id)}><Printer className="size-4" /> Imprimir</Button>
                <Button size="sm" variant="ghost" onClick={() => onArquivarAprovada(s.id)}><Archive className="size-4" /> Arquivar</Button>
              </>
            )}
            {tab === "rejeitado" && (
              <Button size="sm" variant="ghost" onClick={() => onArquivarRejeitada(s.id)}><Archive className="size-4" /> Arquivar</Button>
            )}
            {tab === "arquivado" && (
              <Button size="sm" variant="outline" onClick={() => onImprimir(s.id)}><Printer className="size-4" /> Imprimir</Button>
            )}
          </TableCell>
        )}
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30">
            <div className="p-3 space-y-2">
              {s.observacao && <div className="text-sm"><span className="text-muted-foreground">Observação: </span>{s.observacao}</div>}
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {s.itens.map((it, i) => (
                  <div key={i} className="rounded border border-border bg-card p-2 text-sm flex justify-between">
                    <span>{it.produto.nome}</span>
                    <span className="font-mono">{it.quantidade} {it.produto.unidade}</span>
                  </div>
                ))}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

