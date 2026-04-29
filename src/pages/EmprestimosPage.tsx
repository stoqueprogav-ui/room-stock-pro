import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, ArrowRight, Archive, Printer, UserCheck } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { formatDateTime } from "@/lib/format";
import ArquivarRetiradaDialog from "@/components/ArquivarRetiradaDialog";

type Emp = {
  id: string;
  status: "pendente" | "aprovado" | "rejeitado" | "arquivado";
  observacao: string | null;
  created_at: string;
  sala_origem_id: string;
  sala_destino_id: string;
  retirado_por: string | null;
  retirado_em: string | null;
  origem: { nome: string };
  destino: { nome: string };
  solicitante: { nome: string } | null;
  itens: { quantidade: number; produto: { nome: string; unidade: string } }[];
};

export default function EmprestimosPage({ approveOnly = false }: { approveOnly?: boolean }) {
  const { role, profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado" | "arquivado">("pendente");
  const [rows, setRows] = useState<Emp[]>([]);
  const [arquivarId, setArquivarId] = useState<string | null>(null);

  const load = async () => {
    let q = supabase
      .from("emprestimos")
      .select(`id, status, observacao, created_at, sala_origem_id, sala_destino_id, retirado_por, retirado_em,
               origem:salas!emprestimos_sala_origem_id_fkey(nome),
               destino:salas!emprestimos_sala_destino_id_fkey(nome),
               solicitante:profiles!emprestimos_solicitante_id_fkey(nome),
               itens:emprestimo_itens(quantidade, produto:produtos(nome, unidade))`)
      .order("created_at", { ascending: false });
    if (role === "master" && scopeSalaId) {
      q = q.or(`sala_origem_id.eq.${scopeSalaId},sala_destino_id.eq.${scopeSalaId}`);
    }
    const { data } = await q;
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, [scopeSalaId, role]);

  const decidir = async (id: string, ap: boolean) => {
    const { error } = await supabase.rpc("decidir_emprestimo", { _emp: id, _aprovar: ap });
    if (error) return toast.error(error.message);
    toast.success(ap ? "Empréstimo aprovado: estoque transferido e dívida registrada" : "Empréstimo rejeitado");
    load();
  };

  const arquivarRejeitado = async (id: string) => {
    const { error } = await supabase.rpc("arquivar_emprestimo", { _emp: id });
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

  // Apenas admin da sala ORIGEM aprova
  const podeDecidir = (e: Emp) =>
    role === "admin" && profile?.sala_id === e.sala_origem_id;

  let list = rows.filter((r) => r.status === tab);
  if (approveOnly) list = list.filter((r) => r.sala_origem_id === profile?.sala_id);

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
        <TabsList>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
          <TabsTrigger value="rejeitado">Rejeitados</TabsTrigger>
          <TabsTrigger value="arquivado">Arquivados</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          <div className="panel overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Solicitante</TableHead>
                  <TableHead>Origem → Destino</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead className="w-[170px]">Criado em</TableHead>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead className="text-right w-[220px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((e) => (
                  <TableRow key={e.id} className="table-row-hover align-top">
                    <TableCell>{e.solicitante?.nome ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 font-medium">
                        {e.origem.nome} <ArrowRight className="size-3 text-muted-foreground" /> {e.destino.nome}
                      </div>
                      {e.observacao && <div className="text-xs text-muted-foreground mt-1">"{e.observacao}"</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {e.itens.map((it, i) => (
                          <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs font-mono">
                            {it.produto.nome} · {it.quantidade}{it.produto.unidade}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(e.created_at)}</TableCell>
                    <TableCell><StatusBadge status={e.status} /></TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {tab === "pendente" && (
                        podeDecidir(e) ? (
                          <>
                            <Button size="sm" variant="outline" className="mr-2" onClick={() => decidir(e.id, false)}><X className="size-4" /> Rejeitar</Button>
                            <Button size="sm" onClick={() => decidir(e.id, true)}><Check className="size-4" /> Aprovar</Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Aguardando admin da origem</span>
                        )
                      )}
                      {tab === "aprovado" && (
                        <>
                          <Button size="sm" variant="outline" className="mr-2" onClick={() => window.open(`/app/emprestimos/${e.id}/imprimir`, "_blank")}>
                            <Printer className="size-4" /> Imprimir
                          </Button>
                          {role === "master" && (
                            <Button size="sm" variant="ghost" onClick={() => setArquivarId(e.id)}><Archive className="size-4" /> Arquivar</Button>
                          )}
                        </>
                      )}
                      {tab === "rejeitado" && role === "master" && (
                        <Button size="sm" variant="ghost" onClick={() => arquivarRejeitado(e.id)}><Archive className="size-4" /> Arquivar</Button>
                      )}
                      {tab === "arquivado" && (
                        <Button size="sm" variant="outline" onClick={() => window.open(`/app/emprestimos/${e.id}/imprimir`, "_blank")}>
                          <Printer className="size-4" /> Imprimir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {list.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-12">Nenhum empréstimo.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
