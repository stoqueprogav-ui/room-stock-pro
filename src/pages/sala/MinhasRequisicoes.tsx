import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveSala } from "@/contexts/ActiveSalaContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatDateTime } from "@/lib/format";
import { ChevronDown, FileText, Package, FolderTree, Tag, Search, Filter, Calendar, X } from "lucide-react";
import { toast } from "sonner";

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
  const { activeSalaId } = useActiveSala();
  const [rows, setRows] = useState<Req[]>([]);
  const [busca, setBusca] = useState("");
  const [statusF, setStatusF] = useState<string>("todos");
  const [dataIni, setDataIni] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    if (!activeSalaId) return;
    const { data } = await supabase
      .from("solicitacoes")
      .select(`id, status, observacao, created_at, decidido_em,
               usuario:profiles!solicitacoes_usuario_id_fkey(nome),
               itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
      .eq("sala_id", activeSalaId)
      .order("created_at", { ascending: false });
    setRows((data as any) ?? []);
  }, [activeSalaId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["solicitacoes", "solicitacao_itens"], load, { debounceMs: 300 });

  const list = useMemo(() => {
    return rows.filter((s) => {
      if (statusF !== "todos" && s.status !== statusF) return false;
      if (dataIni && s.created_at < dataIni) return false;
      if (dataFim && s.created_at > dataFim + "T23:59:59") return false;
      const t = busca.trim().toLowerCase();
      if (!t) return true;
      return (
        s.id.toLowerCase().includes(t) ||
        (s.observacao ?? "").toLowerCase().includes(t) ||
        (s.usuario?.nome ?? "").toLowerCase().includes(t) ||
        s.itens.some((it) => it.produto.nome.toLowerCase().includes(t))
      );
    });
  }, [rows, busca, statusF, dataIni, dataFim]);

  const filtrosAtivos = statusF !== "todos" || !!dataIni || !!dataFim;

  return (
    <div className="space-y-4">
      <PageHeader title="Minhas requisições" description="Histórico das requisições da sua sala ao Master. Clique para expandir e ver os produtos." />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] sm:w-80 sm:flex-none">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input placeholder="Buscar número, produto, observação..." value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-8" />
        </div>
        <Button variant={filtrosAtivos ? "default" : "outline"} size="sm" onClick={() => setShowFilters((v) => !v)}>
          <Filter className="size-4" /> Filtros {filtrosAtivos && <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">ativo</Badge>}
        </Button>
      </div>

      {showFilters && (
        <div className="panel p-3 flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={statusF} onValueChange={setStatusF}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="pendente">Pendentes</SelectItem>
                <SelectItem value="aprovado">Aprovadas</SelectItem>
                <SelectItem value="rejeitado">Rejeitadas</SelectItem>
                <SelectItem value="arquivado">Arquivadas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="size-3" /> De</label>
            <Input type="date" value={dataIni} onChange={(e) => setDataIni(e.target.value)} className="w-44" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="size-3" /> Até</label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="w-44" />
          </div>
          {filtrosAtivos && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusF("todos"); setDataIni(""); setDataFim(""); }}>
              <X className="size-4" /> Limpar
            </Button>
          )}
          <div className="ml-auto text-xs text-muted-foreground">{list.length} resultado(s)</div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="panel p-12 text-center text-muted-foreground">Nenhuma requisição encontrada.</div>
      ) : (
        <div className="space-y-2">
          {list.map((s) => <ReqRow key={s.id} s={s} />)}
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
            <ChevronDown className={`size-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : "-rotate-90"}`} />
            <FileText className="size-4 text-primary shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-display font-semibold">REQ-#{shortId}</span>
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
