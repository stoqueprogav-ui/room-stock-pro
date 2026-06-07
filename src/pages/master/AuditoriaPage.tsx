import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, ShieldCheck, ChevronDown } from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { toast } from "sonner";

type LogRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_nome: string | null;
  actor_email: string | null;
  event_type: string;
  event_category: string;
  sala_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  description: string;
  metadata: Record<string, unknown>;
  solicitante_nome?: string | null;
};

const PAGE_SIZE = 50;

const CATEGORIAS = [
  { value: "__all__", label: "Todas as categorias" },
  { value: "requisicoes", label: "Requisições" },
  { value: "emprestimos", label: "Empréstimos" },
  { value: "estoque", label: "Estoque" },
  { value: "catalogo", label: "Catálogo" },
  { value: "dividas", label: "Dívidas" },
  { value: "estrutura", label: "Estrutura (salas)" },
  { value: "sistema", label: "Sistema" },
  { value: "geral", label: "Geral" },
];

function categoriaColor(cat: string) {
  switch (cat) {
    case "sistema": return "bg-destructive/15 text-destructive border-destructive/30";
    case "estrutura": return "bg-warning/15 text-warning border-warning/30";
    case "estoque":
    case "catalogo": return "bg-primary/15 text-primary border-primary/30";
    case "emprestimos":
    case "requisicoes":
    case "dividas": return "bg-accent/15 text-accent border-accent/30";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export default function AuditoriaPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [salas, setSalas] = useState<Array<{ id: string; nome: string }>>([]);

  // filtros
  const [search, setSearch] = useState("");
  const [categoria, setCategoria] = useState<string>("__all__");
  const [salaId, setSalaId] = useState<string>("__all__");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  useEffect(() => {
    supabase.from("salas").select("id, nome").order("nome").then(({ data }) => {
      setSalas((data ?? []) as any);
    });
  }, []);

  const fetchPage = useCallback(async (reset: boolean) => {
    setLoading(true);
    const params: any = {
      _event_category: categoria === "__all__" ? null : categoria,
      _sala: salaId === "__all__" ? null : salaId,
      _from: from ? new Date(from).toISOString() : null,
      _to: to ? new Date(to + "T23:59:59").toISOString() : null,
      _search: search || null,
      _cursor: reset ? null : cursor,
      _limit: PAGE_SIZE,
    };
    const { data, error } = await supabase.rpc("listar_system_logs" as any, params);
    if (error) {
      toast.error("Falha ao carregar auditoria: " + error.message);
      setLoading(false);
      return;
    }
    const list = (data ?? []) as LogRow[];
    const enriched = await enrichSolicitantes(list);
    setRows((prev) => (reset ? enriched : [...prev, ...enriched]));
    setHasMore(list.length === PAGE_SIZE);
    if (list.length > 0) setCursor(list[list.length - 1].created_at);
    setLoading(false);
  }, [categoria, salaId, from, to, search, cursor]);

  useEffect(() => {
    setCursor(null);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoria, salaId, from, to]);

  // Realtime: novos logs aparecem no topo
  useRealtimeSync(["system_logs"], () => {
    setCursor(null);
    fetchPage(true);
  }, { debounceMs: 600 });

  const salaMap = useMemo(() => new Map(salas.map((s) => [s.id, s.nome])), [salas]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria do Sistema"
        description="Histórico imutável de todas as ações importantes — visível apenas para o Master."
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Buscar</label>
            <div className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Descrição, nome ou e-mail do ator…"
                onKeyDown={(e) => { if (e.key === "Enter") { setCursor(null); fetchPage(true); } }}
              />
              <Button variant="secondary" size="icon" onClick={() => { setCursor(null); fetchPage(true); }} disabled={loading}>
                <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
              </Button>
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Categoria</label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIAS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Sala</label>
            <Select value={salaId} onValueChange={setSalaId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas as salas</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b text-sm text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" />
          <span>{rows.length} registro(s) carregado(s)</span>
        </div>
        <div className="divide-y">
          {rows.length === 0 && !loading && (
            <div className="px-4 py-10 text-center text-muted-foreground text-sm">
              Nenhum evento registrado com esses filtros.
            </div>
          )}
          {rows.map((r) => (
            <LogItem key={r.id} row={r} salaNome={r.sala_id ? salaMap.get(r.sala_id) ?? null : null} />
          ))}
        </div>
        <div className="px-4 py-3 border-t flex justify-center">
          {hasMore ? (
            <Button variant="outline" onClick={() => fetchPage(false)} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ChevronDown className="size-4 mr-2" />}
              Carregar mais
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">Fim do histórico</span>
          )}
        </div>
      </Card>
    </div>
  );
}

function LogItem({ row, salaNome }: { row: LogRow; salaNome: string | null }) {
  const [open, setOpen] = useState(false);
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const hasMeta = Object.keys(meta).length > 0;
  return (
    <div className="px-4 py-3 hover:bg-muted/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={categoriaColor(row.event_category)}>
              {row.event_category}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{row.event_type}</span>
            {salaNome && <Badge variant="secondary" className="text-xs">📍 {salaNome}</Badge>}
          </div>
          <div className="mt-1 font-medium">{row.description}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {row.actor_nome ?? row.actor_email ?? "Sistema"}
            {" · "}
            {new Date(row.created_at).toLocaleString("pt-BR")}
          </div>
          {hasMeta && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-xs text-primary hover:underline mt-1"
            >
              {open ? "Ocultar detalhes" : "Ver detalhes"}
            </button>
          )}
          {open && hasMeta && (
            <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-x-auto">
{JSON.stringify(meta, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
