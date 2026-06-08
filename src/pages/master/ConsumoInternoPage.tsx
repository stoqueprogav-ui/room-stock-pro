import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Trash2, Search, FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { formatDateTime } from "@/lib/format";
import { exportToExcel, exportToPdf, printElement } from "@/lib/exporters";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string; unidade: string; categoria_id: string | null };
type Consumo = {
  id: string; created_at: string; quantidade: number; motivo: string; observacao: string | null;
  sala: { nome: string } | null;
  produto: { nome: string; unidade: string } | null;
  usuario: { nome: string } | null;
};

const MOTIVOS: { value: string; label: string }[] = [
  { value: "consumo_interno", label: "Consumo Interno" },
  { value: "evento", label: "Evento" },
  { value: "uso_administrativo", label: "Uso Administrativo" },
  { value: "uso_operacional", label: "Uso Operacional" },
  { value: "perda", label: "Perda" },
  { value: "avaria", label: "Avaria" },
  { value: "descarte", label: "Descarte" },
  { value: "outro", label: "Outro" },
];
const motivoLabel = (m: string) => MOTIVOS.find((x) => x.value === m)?.label ?? m;

export default function ConsumoInternoPage() {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [consumos, setConsumos] = useState<Consumo[]>([]);

  const [salaId, setSalaId] = useState("");
  const [categoriaId, setCategoriaId] = useState("all");
  const [produtoId, setProdutoId] = useState("");
  const [quantidade, setQuantidade] = useState("");
  const [motivo, setMotivo] = useState("consumo_interno");
  const [observacao, setObservacao] = useState("");
  const [saving, setSaving] = useState(false);

  // filtros listagem
  const [busca, setBusca] = useState("");
  const [filtroSala, setFiltroSala] = useState("all");
  const [filtroMotivo, setFiltroMotivo] = useState("all");

  const reload = useCallback(async () => {
    const [s, c, p, l] = await Promise.all([
      supabase.from("salas").select("id, nome").order("nome"),
      supabase.from("categorias").select("id, nome").order("nome"),
      supabase.from("produtos").select("id, nome, unidade, categoria_id").eq("ativo", true).order("nome"),
      supabase.from("consumos_internos")
        .select("id, created_at, quantidade, motivo, observacao, sala:salas(nome), produto:produtos(nome, unidade), usuario:profiles(nome)")
        .order("created_at", { ascending: false }).limit(500),
    ]);
    setSalas((s.data as any) ?? []);
    setCategorias((c.data as any) ?? []);
    setProdutos((p.data as any) ?? []);
    setConsumos((l.data as any) ?? []);
  }, []);

  useEffect(() => { reload(); }, [reload]);
  useRealtimeSync(["consumos_internos", "estoque", "produtos"], reload, { debounceMs: 300 });

  const produtosFiltrados = useMemo(() => {
    if (categoriaId === "all") return produtos;
    return produtos.filter((p) => p.categoria_id === categoriaId);
  }, [produtos, categoriaId]);

  const consumosFiltrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return consumos.filter((c) => {
      if (filtroSala !== "all" && c.sala?.nome !== salas.find((s) => s.id === filtroSala)?.nome) return false;
      if (filtroMotivo !== "all" && c.motivo !== filtroMotivo) return false;
      if (!q) return true;
      return [c.produto?.nome, c.sala?.nome, c.observacao, motivoLabel(c.motivo), c.usuario?.nome]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [consumos, busca, filtroSala, filtroMotivo, salas]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!salaId || !produtoId || !quantidade || !motivo) {
      toast.error("Preencha sala, produto, quantidade e motivo");
      return;
    }
    const qtd = parseInt(quantidade, 10);
    if (!qtd || qtd <= 0) { toast.error("Quantidade inválida"); return; }
    setSaving(true);
    const { error } = await supabase.rpc("registrar_consumo_interno" as any, {
      _sala: salaId, _produto: produtoId, _quantidade: qtd,
      _motivo: motivo, _observacao: observacao || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Consumo interno registrado");
    setQuantidade(""); setObservacao(""); setProdutoId("");
    reload();
  }

  const exportCols = [
    { header: "Data", key: "data", map: (r: Consumo) => formatDateTime(r.created_at) },
    { header: "Sala", key: "sala", map: (r: Consumo) => r.sala?.nome ?? "" },
    { header: "Produto", key: "produto", map: (r: Consumo) => r.produto?.nome ?? "" },
    { header: "Quantidade", key: "qtd", map: (r: Consumo) => r.quantidade },
    { header: "Unidade", key: "unidade", map: (r: Consumo) => r.produto?.unidade ?? "" },
    { header: "Motivo", key: "motivo", map: (r: Consumo) => motivoLabel(r.motivo) },
    { header: "Observação", key: "obs", map: (r: Consumo) => r.observacao ?? "" },
    { header: "Usuário", key: "user", map: (r: Consumo) => r.usuario?.nome ?? "" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Consumo Interno" description="Registre baixas de estoque por consumo interno, eventos, perdas, avarias ou descarte." />

      <Card className="p-6">
        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Sala de origem</Label>
            <Select value={salaId} onValueChange={setSalaId}>
              <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
              <SelectContent>{salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria (filtro)</Label>
            <Select value={categoriaId} onValueChange={(v) => { setCategoriaId(v); setProdutoId(""); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Produto</Label>
            <Select value={produtoId} onValueChange={setProdutoId}>
              <SelectTrigger><SelectValue placeholder="Selecione o produto" /></SelectTrigger>
              <SelectContent className="max-h-64">
                {produtosFiltrados.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Quantidade</Label>
            <Input type="number" min={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
          </div>
          <div>
            <Label>Motivo</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{MOTIVOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="md:col-span-3">
            <Label>Observação (opcional)</Label>
            <Textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Detalhes do consumo, ex.: evento de aniversário, sala 12, etc." />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Registrar consumo
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-6">
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex-1 min-w-[220px]">
            <Label>Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto, sala, motivo, observação..." className="pl-8" />
            </div>
          </div>
          <div>
            <Label>Sala</Label>
            <Select value={filtroSala} onValueChange={setFiltroSala}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Motivo</Label>
            <Select value={filtroMotivo} onValueChange={setFiltroMotivo}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {MOTIVOS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportToExcel("consumos-internos", exportCols, consumosFiltrados)}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportToPdf("consumos-internos", "Consumos Internos", exportCols, consumosFiltrados)}>
              <FileDown className="size-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              const rows = consumosFiltrados.map((c) =>
                `<tr><td>${formatDateTime(c.created_at)}</td><td>${c.sala?.nome ?? ""}</td><td>${c.produto?.nome ?? ""}</td><td>${c.quantidade}</td><td>${motivoLabel(c.motivo)}</td><td>${c.observacao ?? ""}</td></tr>`).join("");
              printElement(`<h1>Consumos Internos</h1><table><thead><tr><th>Data</th><th>Sala</th><th>Produto</th><th>Qtd</th><th>Motivo</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table>`);
            }}>
              <Printer className="size-4" /> Imprimir
            </Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead><TableHead>Sala</TableHead><TableHead>Produto</TableHead>
                <TableHead className="text-right">Qtd</TableHead><TableHead>Motivo</TableHead>
                <TableHead>Observação</TableHead><TableHead>Usuário</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {consumosFiltrados.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="whitespace-nowrap text-sm">{formatDateTime(c.created_at)}</TableCell>
                  <TableCell>{c.sala?.nome ?? "—"}</TableCell>
                  <TableCell className="font-medium">{c.produto?.nome ?? "—"}</TableCell>
                  <TableCell className="text-right">{c.quantidade} {c.produto?.unidade}</TableCell>
                  <TableCell><Badge variant="outline">{motivoLabel(c.motivo)}</Badge></TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-muted-foreground">{c.observacao ?? "—"}</TableCell>
                  <TableCell className="text-sm">{c.usuario?.nome ?? "—"}</TableCell>
                </TableRow>
              ))}
              {consumosFiltrados.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum consumo registrado.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
