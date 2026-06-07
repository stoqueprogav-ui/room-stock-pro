import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { formatDateTime } from "@/lib/format";
import type { Sala } from "@/lib/types";

type Mov = {
  id: string; created_at: string; tipo: string; quantidade: number; saldo_apos: number;
  observacao: string | null;
  sala_id: string;
  referencia_tipo: string | null;
  referencia_id: string | null;
  produto: { nome: string; unidade: string };
  sala: { nome: string };
  usuario: { nome: string } | null;
  originador?: { nome: string } | null;
};


const TIPO_LABEL: Record<string, { label: string; cls: string }> = {
  solicitacao: { label: "Requisição", cls: "bg-warning/15 text-warning border-warning/30" },
  estorno: { label: "Estorno", cls: "bg-secondary text-secondary-foreground" },
  ajuste: { label: "Ajuste", cls: "bg-accent/15 text-accent border-accent/30" },
  emprestimo_saida: { label: "Empréstimo (saída)", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  emprestimo_entrada: { label: "Empréstimo (entrada)", cls: "bg-success/15 text-success border-success/30" },
  entrada: { label: "Entrada", cls: "bg-success/15 text-success border-success/30" },
  saida: { label: "Saída", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  devolucao: { label: "Devolução", cls: "bg-success/15 text-success border-success/30" },
};

const TIPO_OPTIONS = [
  { value: "all", label: "Todos os tipos" },
  { value: "entrada", label: "Entradas" },
  { value: "saida", label: "Saídas" },
  { value: "solicitacao", label: "Requisições" },
  { value: "emprestimo_saida", label: "Empréstimo (saída)" },
  { value: "emprestimo_entrada", label: "Empréstimo (entrada)" },
  { value: "devolucao", label: "Devoluções" },
  { value: "ajuste", label: "Ajustes" },
  { value: "estorno", label: "Estornos" },
];

export default function MovimentacoesPage() {
  const { role, profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const PAGE_SIZE = 100;
  const [rows, setRows] = useState<Mov[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaFilter, setSalaFilter] = useState("all");
  const [tipoFilter, setTipoFilter] = useState("all");
  const [busca, setBusca] = useState("");
  const [buscaUsuario, setBuscaUsuario] = useState("");
  const [dataInicial, setDataInicial] = useState("");
  const [dataFinal, setDataFinal] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(false);

  const buildQuery = useCallback((before?: string) => {
    let q = supabase
      .from("movimentacoes")
      .select(`id, created_at, tipo, quantidade, saldo_apos, observacao, sala_id,
               produto:produtos(nome, unidade), sala:salas(nome),
               usuario:profiles!movimentacoes_usuario_id_fkey(nome)`)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (before) q = q.lt("created_at", before);
    if (salaFilter !== "all") q = q.eq("sala_id", salaFilter);
    if (tipoFilter !== "all") q = q.eq("tipo", tipoFilter as any);
    if (dataInicial) q = q.gte("created_at", `${dataInicial}T00:00:00`);
    if (dataFinal) q = q.lte("created_at", `${dataFinal}T23:59:59`);
    return q;
  }, [salaFilter, tipoFilter, dataInicial, dataFinal]);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: ss }] = await Promise.all([
      buildQuery(),
      supabase.from("salas").select("*").order("nome"),
    ]);
    const page = (data as any[]) ?? [];
    setRows(page as Mov[]);
    setSalas((ss as Sala[]) ?? []);
    setHasMore(page.length === PAGE_SIZE);
    setLoading(false);
  }, [buildQuery]);

  const loadMore = useCallback(async () => {
    if (!rows.length || loadingMore) return;
    setLoadingMore(true);
    const last = rows[rows.length - 1];
    const { data } = await buildQuery(last.created_at);
    const more = (data as any[]) ?? [];
    setRows((prev) => [...prev, ...(more as Mov[])]);
    setHasMore(more.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [rows, loadingMore, buildQuery]);

  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["movimentacoes", "estoque", "salas"], load, { debounceMs: 400 });

  // Sincroniza filtro com escopo do master / sala do user
  useEffect(() => {
    if (role === "master") {
      setSalaFilter(scopeSalaId ?? "all");
    } else if (profile?.sala_id) {
      setSalaFilter(profile.sala_id);
    }
  }, [role, profile, scopeSalaId]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => !busca || r.produto.nome.toLowerCase().includes(busca.toLowerCase()))
      .filter((r) => !buscaUsuario || (r.usuario?.nome ?? "").toLowerCase().includes(buscaUsuario.toLowerCase()));
  }, [rows, busca, buscaUsuario]);

  const limparFiltros = () => {
    setTipoFilter("all");
    setBusca("");
    setBuscaUsuario("");
    setDataInicial("");
    setDataFinal("");
  };

  const filtrosAtivos = (tipoFilter !== "all" ? 1 : 0) + (busca ? 1 : 0) + (buscaUsuario ? 1 : 0) + (dataInicial ? 1 : 0) + (dataFinal ? 1 : 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Movimentações" description="Log completo de toda alteração de estoque (rastreabilidade)." />

      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-2">
            Filtros
            {filtrosAtivos > 0 && <Badge variant="secondary">{filtrosAtivos} ativo(s)</Badge>}
          </div>
          {filtrosAtivos > 0 && (
            <Button size="sm" variant="ghost" onClick={limparFiltros}>
              <X className="size-3.5" /> Limpar filtros
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Data inicial</Label>
            <Input type="date" value={dataInicial} onChange={(e) => setDataInicial(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Data final</Label>
            <Input type="date" value={dataFinal} onChange={(e) => setDataFinal(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Sala</Label>
            <Select value={salaFilter} onValueChange={setSalaFilter} disabled={role !== "master"}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {role === "master" && <SelectItem value="all">Todas as salas</SelectItem>}
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipoFilter} onValueChange={setTipoFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPO_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Produto</Label>
            <Input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Usuário</Label>
            <Input placeholder="Ex: Grasiela…" value={buscaUsuario} onChange={(e) => setBuscaUsuario(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Quando</TableHead>
              <TableHead className="w-[160px]">Usuário</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="w-[170px]">Operação</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right w-[100px]">Qtd.</TableHead>
              <TableHead className="text-right w-[100px]">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="py-12 text-center"><Loader2 className="size-5 animate-spin mx-auto text-primary" /></TableCell></TableRow>
            )}
            {filtered.map((m) => {
              const tipoCfg = TIPO_LABEL[m.tipo] ?? { label: m.tipo, cls: "" };
              return (
                <TableRow key={m.id} className="table-row-hover">
                  <TableCell className="text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                  <TableCell className="font-medium">{m.usuario?.nome ?? "—"}</TableCell>
                  <TableCell>{m.sala.nome}</TableCell>
                  <TableCell><Badge variant="outline" className={tipoCfg.cls}>{tipoCfg.label}</Badge></TableCell>
                  <TableCell>{m.produto.nome}</TableCell>
                  <TableCell className={`text-right font-mono ${m.quantidade < 0 ? "text-destructive" : "text-success"}`}>{m.quantidade > 0 ? "+" : ""}{m.quantidade}</TableCell>
                  <TableCell className="text-right font-mono">{m.saldo_apos}</TableCell>
                </TableRow>
              );
            })}
            {!loading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">Nenhuma movimentação encontrada com os filtros aplicados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <><Loader2 className="size-4 mr-2 animate-spin" />Carregando…</> : "Carregar mais"}
          </Button>
        </div>
      )}
    </div>
  );
}
