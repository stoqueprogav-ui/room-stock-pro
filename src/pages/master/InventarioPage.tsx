import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ClipboardList, Loader2, FileDown, FileSpreadsheet, Printer, Eye, Trash2 } from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { formatDateTime, formatDate } from "@/lib/format";
import { exportToExcel, exportToPdf, printElement } from "@/lib/exporters";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string };
type Inv = {
  id: string; codigo: string; created_at: string; data_referencia: string;
  total_itens: number; total_unidades: number; observacao: string | null;
  sala: { nome: string } | null;
  criador: { nome: string } | null;
};
type InvItem = {
  id: string; produto_nome: string; categoria_nome: string | null;
  sala_nome: string; unidade: string | null; quantidade: number;
};

export default function InventarioPage() {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [inventarios, setInventarios] = useState<Inv[]>([]);
  const [loading, setLoading] = useState(false);

  // filtros para geração
  const [gSala, setGSala] = useState("all");
  const [gCat, setGCat] = useState("all");
  const [gProd, setGProd] = useState("all");
  const [obs, setObs] = useState("");

  // visualizar
  const [view, setView] = useState<Inv | null>(null);
  const [viewItens, setViewItens] = useState<InvItem[]>([]);
  const [filtroItens, setFiltroItens] = useState("");

  const reload = useCallback(async () => {
    const [s, c, p, l] = await Promise.all([
      supabase.from("salas").select("id, nome").order("nome"),
      supabase.from("categorias").select("id, nome").order("nome"),
      supabase.from("produtos").select("id, nome").eq("ativo", true).order("nome"),
      supabase.from("inventarios")
        .select("id, codigo, created_at, data_referencia, total_itens, total_unidades, observacao, sala:salas(nome), criador:profiles!inventarios_criado_por_fkey(nome)")
        .order("created_at", { ascending: false }).limit(200),
    ]);
    setSalas((s.data as any) ?? []);
    setCategorias((c.data as any) ?? []);
    setProdutos((p.data as any) ?? []);
    setInventarios((l.data as any) ?? []);
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
    setObs("");
    reload();
    if (data) openInv(data as string);
  }

  async function openInv(id: string) {
    const inv = inventarios.find((i) => i.id === id) ?? null;
    if (!inv) {
      const { data } = await supabase.from("inventarios")
        .select("id, codigo, created_at, data_referencia, total_itens, total_unidades, observacao, sala:salas(nome), criador:profiles!inventarios_criado_por_fkey(nome)")
        .eq("id", id).maybeSingle();
      setView((data as any) ?? null);
    } else setView(inv);
    const { data: itens } = await supabase.from("inventario_itens")
      .select("id, produto_nome, categoria_nome, sala_nome, unidade, quantidade")
      .eq("inventario_id", id).order("sala_nome").order("produto_nome");
    setViewItens((itens as any) ?? []);
  }

  async function excluir(inv: Inv) {
    if (!confirm(`Excluir inventário ${inv.codigo}? Esta ação não pode ser desfeita.`)) return;
    const { error } = await supabase.from("inventarios").delete().eq("id", inv.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Inventário excluído");
    if (view?.id === inv.id) { setView(null); setViewItens([]); }
    reload();
  }

  const itensFiltrados = useMemo(() => {
    const q = filtroItens.trim().toLowerCase();
    if (!q) return viewItens;
    return viewItens.filter((i) =>
      [i.produto_nome, i.categoria_nome, i.sala_nome].some((v) => (v ?? "").toLowerCase().includes(q)));
  }, [viewItens, filtroItens]);

  const itensCols = [
    { header: "Sala", key: "sala_nome" },
    { header: "Categoria", key: "categoria_nome", map: (r: InvItem) => r.categoria_nome ?? "" },
    { header: "Produto", key: "produto_nome" },
    { header: "Unidade", key: "unidade", map: (r: InvItem) => r.unidade ?? "" },
    { header: "Quantidade", key: "quantidade" },
  ];

  const invCols = [
    { header: "Código", key: "codigo" },
    { header: "Data", key: "data", map: (r: Inv) => formatDateTime(r.created_at) },
    { header: "Sala", key: "sala", map: (r: Inv) => r.sala?.nome ?? "Todas" },
    { header: "Itens", key: "total_itens" },
    { header: "Unidades", key: "total_unidades" },
    { header: "Criado por", key: "criador", map: (r: Inv) => r.criador?.nome ?? "" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Inventário" description="Gere snapshots do estoque atual e consulte o histórico de inventários." />

      <Tabs defaultValue="gerar">
        <TabsList>
          <TabsTrigger value="gerar">Gerar inventário</TabsTrigger>
          <TabsTrigger value="historico">Histórico ({inventarios.length})</TabsTrigger>
          {view && <TabsTrigger value="visualizar">Visualizar: {view.codigo}</TabsTrigger>}
        </TabsList>

        <TabsContent value="gerar">
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
                <Input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: inventário mensal de maio" />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleGerar} disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
                Gerar inventário
              </Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="historico">
          <Card className="p-6">
            <div className="flex justify-end gap-2 mb-3">
              <Button variant="outline" size="sm" onClick={() => exportToExcel("inventarios", invCols, inventarios)}>
                <FileSpreadsheet className="size-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportToPdf("inventarios", "Histórico de Inventários", invCols, inventarios)}>
                <FileDown className="size-4" /> PDF
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Código</TableHead><TableHead>Data</TableHead><TableHead>Sala</TableHead>
                    <TableHead>Categoria/Produto</TableHead>
                    <TableHead className="text-right">Itens</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead>Criado por</TableHead>
                    <TableHead>Observação</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventarios.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="font-mono font-semibold">{i.codigo}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatDateTime(i.created_at)}</TableCell>
                      <TableCell>{i.sala?.nome ?? <Badge variant="secondary">Todas</Badge>}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">—</TableCell>
                      <TableCell className="text-right">{i.total_itens}</TableCell>
                      <TableCell className="text-right font-semibold">{i.total_unidades}</TableCell>
                      <TableCell className="text-sm">{i.criador?.nome ?? "—"}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate">{i.observacao ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => openInv(i.id)} aria-label="Visualizar inventário"><Eye className="size-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => excluir(i)} aria-label="Excluir inventário"><Trash2 className="size-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {inventarios.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum inventário ainda.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {view && (
          <TabsContent value="visualizar">
            <Card className="p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-lg font-bold">{view.codigo}</div>
                  <div className="text-sm text-muted-foreground">
                    {formatDate(view.created_at)} · Sala: {view.sala?.nome ?? "Todas"} · {view.total_itens} itens · {view.total_unidades} unidades
                  </div>
                  {view.observacao && <div className="text-sm mt-1">{view.observacao}</div>}
                </div>
                <div className="flex gap-2">
                  <Input value={filtroItens} onChange={(e) => setFiltroItens(e.target.value)} placeholder="Buscar item..." className="w-48" />
                  <Button variant="outline" size="sm" onClick={() => exportToExcel(view.codigo, itensCols, itensFiltrados)}>
                    <FileSpreadsheet className="size-4" /> Excel
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => exportToPdf(view.codigo, `Inventário ${view.codigo}`, itensCols, itensFiltrados, { subtitle: `${formatDate(view.created_at)} · Sala: ${view.sala?.nome ?? "Todas"}` })}>
                    <FileDown className="size-4" /> PDF
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    const rows = itensFiltrados.map((i) =>
                      `<tr><td>${i.sala_nome}</td><td>${i.categoria_nome ?? ""}</td><td>${i.produto_nome}</td><td>${i.unidade ?? ""}</td><td>${i.quantidade}</td></tr>`).join("");
                    printElement(`<h1>Inventário ${view.codigo}</h1><p>${formatDate(view.created_at)} — Sala: ${view.sala?.nome ?? "Todas"}</p><table><thead><tr><th>Sala</th><th>Categoria</th><th>Produto</th><th>Unidade</th><th>Qtd</th></tr></thead><tbody>${rows}</tbody></table>`);
                  }}>
                    <Printer className="size-4" /> Imprimir
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Sala</TableHead><TableHead>Categoria</TableHead><TableHead>Produto</TableHead><TableHead>Unidade</TableHead><TableHead className="text-right">Quantidade</TableHead></TableRow>
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
                  </TableBody>
                </Table>
              </div>
            </Card>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
