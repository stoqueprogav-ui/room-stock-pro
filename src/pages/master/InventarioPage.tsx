import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ClipboardList, Loader2, FileDown, FileSpreadsheet, Printer, Trash2, Plus, X,
  ChevronDown, ChevronUp, Search, Package, Calendar, User, Building2,
} from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { formatDateTime, formatDate } from "@/lib/format";
import { exportToExcel, exportReportPdf, printReport } from "@/lib/exporters";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string };
type Inv = {
  id: string; codigo: string; created_at: string; data_referencia: string;
  total_itens: number; total_unidades: number; observacao: string | null;
  criado_por: string | null;
  sala: { nome: string } | null;
  criador: { nome: string } | null;
};
type InvItem = {
  id: string; produto_nome: string; categoria_nome: string | null;
  sala_nome: string; unidade: string | null; quantidade: number;
};

export default function InventarioPage() {
  const { profile } = useAuth();
  const { logoUrl } = useCompanyLogo();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [inventarios, setInventarios] = useState<Inv[]>([]);
  const [responsaveis, setResponsaveis] = useState<Map<string, string>>(new Map());

  // form gerar
  const [openForm, setOpenForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gSala, setGSala] = useState("all");
  const [gCat, setGCat] = useState("all");
  const [gProd, setGProd] = useState("all");
  const [obs, setObs] = useState("");

  // filtros lista
  const [busca, setBusca] = useState("");
  const [fDataIni, setFDataIni] = useState("");
  const [fDataFim, setFDataFim] = useState("");
  const [fSala, setFSala] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fProd, setFProd] = useState("all");
  const [fResp, setFResp] = useState("all");

  // expansão por card
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [itensCache, setItensCache] = useState<Record<string, InvItem[]>>({});

  const reload = useCallback(async () => {
    const [s, c, p, l] = await Promise.all([
      supabase.from("salas").select("id, nome").order("nome"),
      supabase.from("categorias").select("id, nome").order("nome"),
      supabase.from("produtos").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("inventarios")
        .select("id, codigo, created_at, data_referencia, total_itens, total_unidades, observacao, criado_por, sala:salas(nome), criador:profiles!inventarios_criado_por_fkey(nome)")
        .order("created_at", { ascending: false }).limit(500),
    ]);
    setSalas((s.data as any) ?? []);
    setCategorias((c.data as any) ?? []);
    setProdutos((p.data as any) ?? []);
    const invs = (l.data as any[]) ?? [];
    setInventarios(invs as Inv[]);
    const mapResp = new Map<string, string>();
    invs.forEach((i: any) => { if (i.criado_por && i.criador?.nome) mapResp.set(i.criado_por, i.criador.nome); });
    setResponsaveis(mapResp);
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useRealtimeSync(["inventarios"], reload, { debounceMs: 300 });

  async function handleGerar() {
    setLoading(true);
    const { data, error } = await supabase.rpc("gerar_inventario" as any, {
      _sala: gSala === "all" ? null : gSala,
      _categoria: gCat === "all" ? null : gCat,
      _produto: gProd === "all" ? null : gProd,
      _observacao: obs || null,
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário gerado");
    setObs(""); setOpenForm(false);
    reload();
    if (data) { setExpanded((e) => ({ ...e, [data as string]: true })); loadItens(data as string); }
  }

  const loadItens = useCallback(async (id: string) => {
    if (itensCache[id]) return;
    const { data } = await supabase.from("inventario_itens")
      .select("id, produto_nome, categoria_nome, sala_nome, unidade, quantidade")
      .eq("inventario_id", id).order("sala_nome").order("produto_nome");
    setItensCache((c) => ({ ...c, [id]: (data as any) ?? [] }));
  }, [itensCache]);

  function toggle(id: string) {
    setExpanded((e) => {
      const next = !e[id];
      if (next) loadItens(id);
      return { ...e, [id]: next };
    });
  }

  async function excluir(inv: Inv) {
    if (!confirm(`Excluir inventário ${inv.codigo}?`)) return;
    const { error } = await supabase.from("inventarios").delete().eq("id", inv.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário excluído");
    reload();
  }

  // Inventários filtrados (filtros básicos sobre o resumo)
  const inventariosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const ini = fDataIni ? new Date(fDataIni + "T00:00:00").getTime() : null;
    const fim = fDataFim ? new Date(fDataFim + "T23:59:59").getTime() : null;
    return inventarios.filter((i) => {
      const t = new Date(i.created_at).getTime();
      if (ini && t < ini) return false;
      if (fim && t > fim) return false;
      if (fSala !== "all") {
        const salaNome = salas.find((s) => s.id === fSala)?.nome;
        if (i.sala?.nome !== salaNome) return false;
      }
      if (fResp !== "all" && i.criado_por !== fResp) return false;
      if (q) {
        const hay = [i.codigo, i.sala?.nome, i.criador?.nome, i.observacao].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      // filtros por categoria/produto requerem itens; aproximação: deixar passar e filtrar ao expandir
      return true;
    });
  }, [inventarios, busca, fDataIni, fDataFim, fSala, fResp, salas]);

  const itensCols = [
    { header: "Sala", key: "sala_nome" },
    { header: "Categoria", key: "categoria_nome", map: (r: InvItem) => r.categoria_nome ?? "" },
    { header: "Produto", key: "produto_nome" },
    { header: "Unidade", key: "unidade", map: (r: InvItem) => r.unidade ?? "" },
    { header: "Quantidade", key: "quantidade" },
  ];

  function filterItens(id: string, items: InvItem[]) {
    const catNome = categorias.find((c) => c.id === fCat)?.nome;
    const prodNome = produtos.find((p) => p.id === fProd)?.nome;
    return items.filter((it) => {
      if (fCat !== "all" && it.categoria_nome !== catNome) return false;
      if (fProd !== "all" && it.produto_nome !== prodNome) return false;
      return true;
    });
  }

  const filtrosAtivos =
    (busca ? 1 : 0) + (fDataIni ? 1 : 0) + (fDataFim ? 1 : 0) +
    (fSala !== "all" ? 1 : 0) + (fCat !== "all" ? 1 : 0) +
    (fProd !== "all" ? 1 : 0) + (fResp !== "all" ? 1 : 0);

  function limparFiltros() {
    setBusca(""); setFDataIni(""); setFDataFim("");
    setFSala("all"); setFCat("all"); setFProd("all"); setFResp("all");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventário"
        description="Histórico de snapshots de estoque. Expanda um inventário para ver os itens, exportar ou imprimir."
        actions={
          <Button onClick={() => setOpenForm((o) => !o)}>
            {openForm ? <X className="size-4" /> : <Plus className="size-4" />}
            {openForm ? "Fechar" : "Gerar inventário"}
          </Button>
        }
      />

      {openForm && (
        <Card className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Sala</Label>
              <Select value={gSala} onValueChange={setGSala}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as salas</SelectItem>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Categoria</Label>
              <Select value={gCat} onValueChange={setGCat}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Produto</Label>
              <Select value={gProd} onValueChange={setGProd}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="all">Todos</SelectItem>
                  {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-3">
              <Label>Observação</Label>
              <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: inventário mensal" />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleGerar} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
              Gerar agora
            </Button>
          </div>
        </Card>
      )}

      {/* Filtros */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center gap-2">
            Filtros {filtrosAtivos > 0 && <Badge variant="secondary">{filtrosAtivos} ativo(s)</Badge>}
          </div>
          {filtrosAtivos > 0 && (
            <Button size="sm" variant="ghost" onClick={limparFiltros}><X className="size-3.5" /> Limpar</Button>
          )}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <Label className="text-xs">Busca</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input className="pl-8" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Código, sala, observação..." />
            </div>
          </div>
          <div>
            <Label className="text-xs">Data inicial</Label>
            <Input type="date" value={fDataIni} onChange={(e) => setFDataIni(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Data final</Label>
            <Input type="date" value={fDataFim} onChange={(e) => setFDataFim(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Sala</Label>
            <Select value={fSala} onValueChange={setFSala}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={fCat} onValueChange={setFCat}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Produto</Label>
            <Select value={fProd} onValueChange={setFProd}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">Todos</SelectItem>
                {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Responsável</Label>
            <Select value={fResp} onValueChange={setFResp}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {[...responsaveis.entries()].map(([id, nome]) => (
                  <SelectItem key={id} value={id}>{nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Lista de cards */}
      <div className="space-y-3">
        {inventariosFiltrados.length === 0 && (
          <Card className="p-10 text-center text-muted-foreground">Nenhum inventário encontrado.</Card>
        )}
        {inventariosFiltrados.map((inv) => {
          const isOpen = !!expanded[inv.id];
          const items = itensCache[inv.id] ?? [];
          const itensFiltrados = filterItens(inv.id, items);
          const categoriasNoInv = new Set(items.map((i) => i.categoria_nome).filter(Boolean)).size;
          return (
            <Card key={inv.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(inv.id)}
                className="w-full text-left px-5 py-4 hover:bg-muted/40 transition-colors flex flex-wrap items-center gap-4"
              >
                <div className="flex items-center gap-2 min-w-[180px]">
                  <ClipboardList className="size-5 text-primary" />
                  <div>
                    <div className="font-mono font-bold">{inv.codigo}</div>
                    <div className="text-[11px] text-muted-foreground">{formatDateTime(inv.created_at)}</div>
                  </div>
                </div>
                <Resumo icon={Building2} label="Sala" value={inv.sala?.nome ?? "Todas"} />
                <Resumo icon={Calendar} label="Data" value={formatDate(inv.created_at)} />
                <Resumo icon={Package} label="Categorias" value={(categoriasNoInv || "—").toString()} />
                <Resumo icon={Package} label="Produtos" value={inv.total_itens.toString()} extra={`${inv.total_unidades} un`} />
                <Resumo icon={User} label="Responsável" value={inv.criador?.nome ?? "—"} />
                <div className="ml-auto flex items-center gap-1 text-xs text-primary font-medium">
                  {isOpen ? "Ocultar" : "Ver detalhes"}
                  {isOpen ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t bg-muted/20 p-4 space-y-3">
                  {inv.observacao && (
                    <div className="text-sm"><span className="text-muted-foreground">Observação:</span> {inv.observacao}</div>
                  )}
                  <div className="flex flex-wrap gap-2 justify-end">
                    <Button variant="outline" size="sm" onClick={() =>
                      exportToExcel(inv.codigo, itensCols, itensFiltrados)}>
                      <FileSpreadsheet className="size-4" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={() =>
                      exportReportPdf(inv.codigo, itensCols, itensFiltrados, {
                        title: `Inventário ${inv.codigo}`,
                        subtitle: `${formatDate(inv.created_at)} · Sala: ${inv.sala?.nome ?? "Todas"} · ${inv.total_itens} itens · ${inv.total_unidades} un`,
                        logoUrl, user: profile?.nome ?? null,
                      })}>
                      <FileDown className="size-4" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={() =>
                      printReport(itensCols, itensFiltrados, {
                        title: `Inventário ${inv.codigo}`,
                        subtitle: `${formatDate(inv.created_at)} · Sala: ${inv.sala?.nome ?? "Todas"} · ${inv.total_itens} itens · ${inv.total_unidades} un`,
                        logoUrl, user: profile?.nome ?? null,
                      })}>
                      <Printer className="size-4" /> Imprimir
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => excluir(inv)}>
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="overflow-x-auto rounded-md border bg-card">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sala</TableHead>
                          <TableHead>Categoria</TableHead>
                          <TableHead>Produto</TableHead>
                          <TableHead>Unidade</TableHead>
                          <TableHead className="text-right">Quantidade</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {itensFiltrados.map((i) => (
                          <TableRow key={i.id}>
                            <TableCell>{i.sala_nome}</TableCell>
                            <TableCell>{i.categoria_nome ?? "—"}</TableCell>
                            <TableCell className="font-medium">{i.produto_nome}</TableCell>
                            <TableCell>{i.unidade ?? "—"}</TableCell>
                            <TableCell className="text-right font-semibold">{i.quantidade}</TableCell>
                          </TableRow>
                        ))}
                        {!items.length && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8"><Loader2 className="size-4 animate-spin inline mr-2" /> Carregando itens…</TableCell></TableRow>
                        )}
                        {items.length > 0 && itensFiltrados.length === 0 && (
                          <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhum item corresponde aos filtros.</TableCell></TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Resumo({ icon: Icon, label, value, extra }: { icon: any; label: string; value: string; extra?: string }) {
  return (
    <div className="flex items-start gap-2 min-w-[120px]">
      <Icon className="size-4 text-muted-foreground mt-0.5" />
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-sm font-medium leading-tight">{value}</div>
        {extra && <div className="text-[11px] text-muted-foreground">{extra}</div>}
      </div>
    </div>
  );
}
