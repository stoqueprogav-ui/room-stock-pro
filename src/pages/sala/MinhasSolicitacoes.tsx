import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";

export default function MinhasSolicitacoes() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    if (!profile?.sala_id) return;
    (async () => {
      const { data } = await supabase
        .from("solicitacoes")
        .select(`id, status, observacao, created_at, decidido_em,
                 itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade))`)
        .eq("sala_id", profile.sala_id)
        .order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, [profile]);

  return (
    <div className="space-y-4">
      <PageHeader title="Minhas solicitações" description="Histórico das solicitações da sua sala." />
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Criada</TableHead>
              <TableHead>Itens</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              <TableHead className="w-[170px]">Decidida</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => (
              <TableRow key={s.id} className="table-row-hover align-top">
                <TableCell className="text-muted-foreground">{formatDateTime(s.created_at)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {s.itens.map((it: any, i: number) => (
                      <span key={i} className="rounded bg-muted px-2 py-0.5 text-xs font-mono">{it.produto.nome} · {it.quantidade}{it.produto.unidade}</span>
                    ))}
                  </div>
                  {s.observacao && <div className="text-xs text-muted-foreground mt-1">“{s.observacao}”</div>}
                </TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="text-muted-foreground">{s.decidido_em ? formatDateTime(s.decidido_em) : "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">Nenhuma solicitação ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
