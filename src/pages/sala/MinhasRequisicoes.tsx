import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDateTime } from "@/lib/format";

export default function MinhasRequisicoes() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!profile?.sala_id) return;
    const { data } = await supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em,
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade))`)
      .eq("sala_id", profile.sala_id)
      .order("created_at", { ascending: false });
    setRows(data ?? []);
  }, [profile?.sala_id]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["solicitacoes", "solicitacao_itens"], load, { debounceMs: 300 });


  return (
    <div className="space-y-4">
      <PageHeader title="Minhas requisições" description="Histórico das requisições da sua sala ao Master." />
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
                  {s.observacao && <div className="text-xs text-muted-foreground mt-1">"{s.observacao}"</div>}
                </TableCell>
                <TableCell><StatusBadge status={s.status} /></TableCell>
                <TableCell className="text-muted-foreground">{s.decidido_em ? formatDateTime(s.decidido_em) : "—"}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">Nenhuma requisição ainda.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
