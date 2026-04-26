import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/StatusBadge";
import { toast } from "sonner";
import { Check, X, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateTime } from "@/lib/format";

type Solicitacao = {
  id: string;
  status: "pendente" | "aprovado" | "rejeitado";
  observacao: string | null;
  created_at: string;
  decidido_em: string | null;
  sala: { nome: string };
  usuario: { nome: string; email: string } | null;
  itens: { quantidade: number; produto: { nome: string; unidade: string } }[];
};

export default function SolicitacoesPage() {
  const { role } = useAuth();
  const [tab, setTab] = useState<"pendente" | "aprovado" | "rejeitado">("pendente");
  const [rows, setRows] = useState<Solicitacao[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em,
               sala:salas(nome),
               usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade))`)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
  };
  useEffect(() => { load(); }, []);

  const decidir = async (id: string, aprovar: boolean) => {
    const { error } = await supabase.rpc("decidir_solicitacao", { _solic: id, _aprovar: aprovar });
    if (error) return toast.error(error.message);
    toast.success(aprovar ? "Solicitação aprovada" : "Solicitação rejeitada (estoque estornado)");
    load();
  };

  const list = rows.filter((r) => r.status === tab);

  return (
    <div className="space-y-4">
      <PageHeader title="Solicitações ao Master" description="Pedidos de retirada feitos por administradores e analistas." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="aprovado">Aprovadas</TabsTrigger>
          <TabsTrigger value="rejeitado">Rejeitadas</TabsTrigger>
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
                  <TableHead className="w-[120px]">Status</TableHead>
                  {role === "master" && tab === "pendente" && <TableHead className="text-right w-[180px]">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <SolicRow key={s.id} s={s} role={role} tab={tab} onDecidir={decidir} />
                ))}
                {list.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">Nenhuma solicitação.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SolicRow({ s, role, tab, onDecidir }: { s: Solicitacao; role: string | null; tab: string; onDecidir: (id: string, ap: boolean) => void }) {
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
        <TableCell><StatusBadge status={s.status} /></TableCell>
        {role === "master" && tab === "pendente" && (
          <TableCell className="text-right">
            <Button size="sm" variant="outline" className="mr-2" onClick={() => onDecidir(s.id, false)}><X className="size-4" /> Rejeitar</Button>
            <Button size="sm" onClick={() => onDecidir(s.id, true)}><Check className="size-4" /> Aprovar</Button>
          </TableCell>
        )}
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30">
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
