import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDateTime } from "@/lib/format";
import { ChevronDown, FileText, Package, FolderTree, Tag } from "lucide-react";

type Item = { quantidade: number; produto: { nome: string; unidade: string; categoria: { nome: string } | null } };
type Req = {
  id: string;
  status: string;
  observacao: string | null;
  created_at: string;
  decidido_em: string | null;
  usuario: { nome: string } | null;
  itens: Item[];
};

export default function MinhasRequisicoes() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<Req[]>([]);

  const load = useCallback(async () => {
    if (!profile?.sala_id) return;
    const { data } = await supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em,
               usuario:profiles!solicitacoes_usuario_id_fkey(nome),
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
      .eq("sala_id", profile.sala_id)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
  }, [profile?.sala_id]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["solicitacoes", "solicitacao_itens"], load, { debounceMs: 300 });

  return (
    <div className="space-y-4">
      <PageHeader title="Minhas requisições" description="Histórico das requisições da sua sala ao Master. Clique para expandir e ver os produtos." />
      {rows.length === 0 ? (
        <div className="panel p-12 text-center text-muted-foreground">Nenhuma requisição ainda.</div>
      ) : (
        <div className="space-y-2">
          {rows.map((s) => <ReqRow key={s.id} s={s} />)}
        </div>
      )}
    </div>
  );
}

function ReqRow({ s }: { s: Req }) {
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

  const shortId = s.id.slice(0, 8).toUpperCase();
  return (
    <div className="panel overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/30 transition text-left">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <FileText className="size-4 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-semibold">#{shortId}</span>
                <StatusBadge status={s.status as any} />
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                <span>{formatDateTime(s.created_at)}</span>
                {s.usuario?.nome && <><span>·</span><span>{s.usuario.nome}</span></>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Badge variant="secondary" className="gap-1"><Package className="size-3" /> {s.itens.length}</Badge>
            <Badge variant="secondary" className="gap-1"><FolderTree className="size-3" /> {grupos.length}</Badge>
            <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
          </div>
        </CollapsibleTrigger>
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
          {s.decidido_em && (
            <div className="px-4 py-2 bg-muted/20 border-t border-border text-xs text-muted-foreground">
              Decidida em {formatDateTime(s.decidido_em)}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
