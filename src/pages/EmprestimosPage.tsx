import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";

type Emp = {
  id: string;
  status: "pendente" | "aprovado" | "rejeitado";
  observacao: string | null;
  created_at: string;
  sala_origem_id: string;
  sala_destino_id: string;
  origem: { nome: string };
  destino: { nome: string };
  solicitante: { nome: string } | null;
  itens: { quantidade: number; produto: { nome: string; unidade: string } }[];
};

export default function EmprestimosPage({ approveOnly = false }: { approveOnly?: boolean }) {
  const { role, profile } = useAuth();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado">("pendente");
  const [rows, setRows] = useState<Emp[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("emprestimos")
      .select(`id, status, observacao, created_at, sala_origem_id, sala_destino_id,
               origem:salas!emprestimos_sala_origem_id_fkey(nome),
               destino:salas!emprestimos_sala_destino_id_fkey(nome),
               solicitante:profiles!emprestimos_solicitante_id_fkey(nome),
               itens:emprestimo_itens(quantidade, produto:produtos(nome, unidade))`)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const decidir = async (id: string, ap: boolean) => {
    const { error } = await supabase.rpc("decidir_emprestimo", { _emp: id, _aprovar: ap });
    if (error) return toast.error(error.message);
    toast.success(ap ? "Empréstimo aprovado: estoque transferido e dívida registrada" : "Empréstimo rejeitado");
    load();
  };

  const podeDecidir = (e: Emp) =>
    role === "master" || (role === "admin" && profile?.sala_id === e.sala_origem_id);

  let list = rows.filter((r) => r.status === tab);
  if (approveOnly) list = list.filter((r) => r.sala_origem_id === profile?.sala_id);

  return (
    <div className="space-y-4">
      <PageHeader
        title={approveOnly ? "Aprovar empréstimos recebidos" : "Empréstimos entre salas"}
        description={approveOnly ? "Pedidos feitos a você por outras salas." : "Histórico completo de transferências entre salas."}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
          <TabsTrigger value="rejeitado">Rejeitados</TabsTrigger>
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
                  {tab === "pendente" && <TableHead className="text-right w-[200px]">Ações</TableHead>}
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
                      {e.observacao && <div className="text-xs text-muted-foreground mt-1">“{e.observacao}”</div>}
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
                    {tab === "pendente" && (
                      <TableCell className="text-right">
                        {podeDecidir(e) ? (
                          <>
                            <Button size="sm" variant="outline" className="mr-2" onClick={() => decidir(e.id, false)}><X className="size-4" /> Rejeitar</Button>
                            <Button size="sm" onClick={() => decidir(e.id, true)}><Check className="size-4" /> Aprovar</Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">Aguardando origem</span>
                        )}
                      </TableCell>
                    )}
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
