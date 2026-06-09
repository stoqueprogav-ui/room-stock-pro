import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ClipboardList, Loader2, FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { exportToExcel, exportReportPdf, printReport } from "@/lib/exporters";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

type Sala = { id: string; nome: string };
type Categoria = { id: string; nome: string };
type Produto = { id: string; nome: string; categoria_id: string | null };
type Linha = {
  produto_id: string;
  produto: string;
  categoria: string;
  unidade: string;
  sala: string;
  quantidade: number;
};

export default function InventarioPage() {
  const { profile } = useAuth();
  const { logoUrl } = useCompanyLogo();

  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  const [fSala, setFSala] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fProd, setFProd] = useState("all");

  const [loading, setLoading] = useState(false);
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [geradoEm, setGeradoEm] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [s, c, p] = await Promise.all([
        supabase.from("salas").select("id, nome").order("nome"),
        supabase.from("categorias").select("id, nome").order("nome"),
        supabase.from("produtos").select("id, nome, categoria_id").eq("ativo", true).order("nome"),
      ]);
      setSalas((s.data as any) ?? []);
      setCategorias((c.data as any) ?? []);
      setProdutos((p.data as any) ?? []);
    })();
  }, []);

  const produtosFiltrados = useMemo(
    () => (fCat === "all" ? produtos : produtos.filter((p) => p.categoria_id === fCat)),
    [produtos, fCat]
  );

  async function handleGerar() {
    setLoading(true);
    let query = supabase
      .from("estoque")
      .select("quantidade, produto:produtos!inner(id, nome, unidade, ativo, categoria_id, categoria:categorias(nome)), sala:salas!inner(id, nome)")
      .eq("produto.ativo", true);
    if (fSala !== "all") query = query.eq("sala_id", fSala);
    if (fProd !== "all") query = query.eq("produto_id", fProd);
    if (fCat !== "all") query = query.eq("produto.categoria_id", fCat);

    const { data, error } = await query;
    setLoading(false);
    if (error) { toast.error(error.message); return; }

    const rows: Linha[] = ((data as any[]) ?? []).map((r) => ({
      produto_id: r.produto?.id,
      produto: r.produto?.nome ?? "",
      categoria: r.produto?.categoria?.nome ?? "—",
      unidade: r.produto?.unidade ?? "",
      sala: r.sala?.nome ?? "",
      quantidade: Number(r.quantidade ?? 0),
    }));
    rows.sort((a, b) => a.sala.localeCompare(b.sala) || a.produto.localeCompare(b.produto));
    setLinhas(rows);
    setGeradoEm(new Date().toISOString());
  }

  const cols = [
    { header: "Sala", key: "sala" },
    { header: "Categoria", key: "categoria" },
    { header: "Produto", key: "produto" },
    { header: "Unidade", key: "unidade" },
    { header: "Quantidade", key: "quantidade" },
  ];

  const totalUnidades = linhas?.reduce((acc, l) => acc + l.quantidade, 0) ?? 0;
  const salaLabel = fSala === "all" ? "Todas as salas" : salas.find((s) => s.id === fSala)?.nome ?? "—";
  const catLabel = fCat === "all" ? "Todas as categorias" : categorias.find((c) => c.id === fCat)?.nome ?? "—";
  const prodLabel = fProd === "all" ? "Todos os produtos" : produtos.find((p) => p.id === fProd)?.nome ?? "—";
  const titulo = "Relatório de Inventário";
  const subtitulo = geradoEm
    ? `${formatDateTime(geradoEm)} · ${salaLabel} · ${catLabel} · ${linhas?.length ?? 0} itens · ${totalUnidades} un`
    : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório de Inventário"
        description="Fotografia em tempo real do estoque atual. Nada é salvo — gere quantas vezes precisar."
      />

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Sala</Label>
            <Select value={fSala} onValueChange={setFSala}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as salas</SelectItem>
                {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Categoria</Label>
            <Select value={fCat} onValueChange={(v) => { setFCat(v); setFProd("all"); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as categorias</SelectItem>
                {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Produto (opcional)</Label>
            <Select value={fProd} onValueChange={setFProd}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="all">Todos os produtos</SelectItem>
                {produtosFiltrados.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={handleGerar} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ClipboardList className="size-4" />}
            Gerar inventário
          </Button>
        </div>
      </Card>

      {linhas && (
        <Card className="overflow-hidden">
          <div className="p-4 flex flex-wrap items-center gap-3 border-b bg-muted/30">
            <div className="flex flex-col">
              <div className="font-semibold">{titulo}</div>
              <div className="text-xs text-muted-foreground">{subtitulo}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{linhas.length} itens</Badge>
              <Badge variant="secondary">{totalUnidades} unidades</Badge>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => exportToExcel(titulo, cols, linhas)}>
                <FileSpreadsheet className="size-4" /> Excel
              </Button>
              <Button variant="outline" size="sm" onClick={() => exportReportPdf(titulo, cols, linhas, {
                title: titulo, subtitle: subtitulo, logoUrl, user: profile?.nome ?? null,
              })}>
                <FileDown className="size-4" /> PDF
              </Button>
              <Button variant="outline" size="sm" onClick={() => printReport(cols, linhas, {
                title: titulo, subtitle: subtitulo, logoUrl, user: profile?.nome ?? null,
              })}>
                <Printer className="size-4" /> Imprimir
              </Button>
            </div>
          </div>

          {linhas.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              Nenhum produto encontrado para os filtros selecionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
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
                  {linhas.map((l, idx) => (
                    <TableRow key={`${l.produto_id}-${l.sala}-${idx}`}>
                      <TableCell>{l.sala}</TableCell>
                      <TableCell>{l.categoria}</TableCell>
                      <TableCell className="font-medium">{l.produto}</TableCell>
                      <TableCell>{l.unidade}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.quantidade}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {!linhas && (
        <Card className="p-10 text-center text-muted-foreground text-sm">
          Selecione os filtros acima e clique em <strong className="text-foreground mx-1">Gerar inventário</strong>
          para visualizar a fotografia atual do estoque.
        </Card>
      )}
    </div>
  );
}
