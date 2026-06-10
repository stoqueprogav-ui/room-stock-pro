import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, FileSpreadsheet, FileText, Printer, PackagePlus, ShoppingCart, Receipt } from "lucide-react";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { exportToExcel, exportReportPdf, type ExportColumn } from "@/lib/exporters";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";
import { useAuth } from "@/contexts/AuthContext";

type Sala = { id: string; nome: string };
type Produto = { id: string; nome: string; unidade: string; sala_id: string | null };
type Entrada = {
  id: string;
  produto_id: string;
  sala_id: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  fornecedor: string | null;
  numero_nf: string | null;
  data_entrada: string;
  observacao: string | null;
  usuario_responsavel_nome: string | null;
  created_at: string;
  produto?: { nome: string; unidade: string } | null;
  sala?: { nome: string } | null;
};

const BRL = (v: number) =>
  Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default function EntradasEstoquePage() {
  const { scopeSalaId } = useMasterScope();
  const { profile } = useAuth();
  const { logoUrl } = useCompanyLogo();

  const [entradas, setEntradas] = useState<Entrada[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  const [filtroSala, setFiltroSala] = useState<string>("all");
  const [filtroProduto, setFiltroProduto] = useState<string>("all");
  const [filtroFornecedor, setFiltroFornecedor] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    produto_id: "",
    sala_id: "",
    quantidade: 0,
    valor_unitario: 0,
    fornecedor: "",
    numero_nf: "",
    data_entrada: new Date().toISOString().slice(0, 16),
    observacao: "",
  });

  const load = useCallback(async () => {
    const [{ data: e }, { data: s }, { data: p }] = await Promise.all([
      supabase
        .from("entradas_estoque")
        .select("*, produto:produtos(nome, unidade), sala:salas(nome)")
        .order("data_entrada", { ascending: false })
        .limit(500),
      supabase.from("salas").select("id, nome").order("nome"),
      supabase.from("produtos").select("id, nome, unidade, sala_id").eq("ativo", true).order("nome"),
    ]);
    setEntradas((e as any) ?? []);
    setSalas((s as Sala[]) ?? []);
    setProdutos((p as Produto[]) ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useRealtimeSync(["entradas_estoque", "estoque", "produtos"], load, { debounceMs: 300 });

  useEffect(() => {
    if (scopeSalaId) setForm((f) => ({ ...f, sala_id: scopeSalaId }));
  }, [scopeSalaId]);

  const filtradas = useMemo(() => {
    return entradas.filter((e) => {
      if (filtroSala !== "all" && e.sala_id !== filtroSala) return false;
      if (filtroProduto !== "all" && e.produto_id !== filtroProduto) return false;
      if (filtroFornecedor.trim() && !(e.fornecedor ?? "").toLowerCase().includes(filtroFornecedor.toLowerCase()))
        return false;
      if (from && new Date(e.data_entrada) < new Date(from)) return false;
      if (to && new Date(e.data_entrada) > new Date(to + "T23:59:59")) return false;
      return true;
    });
  }, [entradas, filtroSala, filtroProduto, filtroFornecedor, from, to]);

  const totais = useMemo(() => {
    const qtd = filtradas.reduce((s, e) => s + (e.quantidade ?? 0), 0);
    const valor = filtradas.reduce((s, e) => s + Number(e.valor_total ?? 0), 0);
    const fornecedores = new Set(filtradas.map((e) => e.fornecedor).filter(Boolean));
    return { qtd, valor, registros: filtradas.length, fornecedores: fornecedores.size };
  }, [filtradas]);

  const produtosDisponiveis = useMemo(() => {
    if (!form.sala_id) return produtos;
    return produtos.filter((p) => p.sala_id === null || p.sala_id === form.sala_id);
  }, [produtos, form.sala_id]);

  const valorTotalCalc = useMemo(
    () => Number(form.quantidade || 0) * Number(form.valor_unitario || 0),
    [form.quantidade, form.valor_unitario],
  );

  const openNew = () => {
    setForm({
      produto_id: "",
      sala_id: scopeSalaId ?? "",
      quantidade: 0,
      valor_unitario: 0,
      fornecedor: "",
      numero_nf: "",
      data_entrada: new Date().toISOString().slice(0, 16),
      observacao: "",
    });
    setOpen(true);
  };

  const salvar = async () => {
    if (!form.produto_id) return toast.error("Selecione o produto");
    if (!form.sala_id) return toast.error("Selecione a sala");
    if (!form.quantidade || form.quantidade <= 0) return toast.error("Quantidade inválida");
    if (form.valor_unitario < 0) return toast.error("Valor unitário inválido");
    setSaving(true);
    const { error } = await supabase.rpc("registrar_entrada_estoque", {
      _produto: form.produto_id,
      _sala: form.sala_id,
      _quantidade: Number(form.quantidade),
      _valor_unitario: Number(form.valor_unitario),
      _fornecedor: form.fornecedor || null,
      _numero_nf: form.numero_nf || null,
      _data_entrada: form.data_entrada ? new Date(form.data_entrada).toISOString() : null,
      _observacao: form.observacao || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Entrada registrada e Custo Médio recalculado");
    setOpen(false);
    load();
  };

  const cols: ExportColumn<Entrada>[] = [
    { header: "Data", key: "data_entrada", map: (e) => new Date(e.data_entrada).toLocaleString("pt-BR") },
    { header: "Produto", key: "produto", map: (e) => e.produto?.nome ?? "—" },
    { header: "Sala", key: "sala", map: (e) => e.sala?.nome ?? "—" },
    { header: "Quantidade", key: "quantidade" },
    { header: "Valor unit.", key: "valor_unitario", map: (e) => BRL(Number(e.valor_unitario)) },
    { header: "Valor total", key: "valor_total", map: (e) => BRL(Number(e.valor_total)) },
    { header: "Fornecedor", key: "fornecedor", map: (e) => e.fornecedor ?? "—" },
    { header: "NF", key: "numero_nf", map: (e) => e.numero_nf ?? "—" },
    { header: "Responsável", key: "usuario_responsavel_nome", map: (e) => e.usuario_responsavel_nome ?? "—" },
    { header: "Observação", key: "observacao", map: (e) => e.observacao ?? "" },
  ];

  const exportExcel = () => exportToExcel("entradas-estoque", cols, filtradas);
  const exportPdf = () =>
    exportReportPdf("entradas-estoque", cols, filtradas, {
      title: "Entradas de Estoque",
      subtitle: `${filtradas.length} registro(s) · ${BRL(totais.valor)}`,
      companyName: "Estoque Pro",
      logoUrl,
      user: profile?.nome ?? null,
    });
  const imprimir = () => window.print();

  return (
    <div className="space-y-4">
      <PageHeader
        title="Entradas de Estoque"
        description="Registre compras e recebimentos. Cada entrada recalcula automaticamente o Custo Médio Ponderado do produto na sala."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportExcel}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
            <Button variant="outline" onClick={exportPdf}>
              <FileText className="size-4" /> PDF
            </Button>
            <Button variant="outline" onClick={imprimir}>
              <Printer className="size-4" /> Imprimir
            </Button>
            <Button onClick={openNew}>
              <Plus className="size-4" /> Nova entrada
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Registros</div>
          <div className="font-display text-2xl font-bold mt-1 flex items-center gap-2">
            <Receipt className="size-4 text-primary" /> {totais.registros}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Itens comprados</div>
          <div className="font-display text-2xl font-bold mt-1 flex items-center gap-2">
            <PackagePlus className="size-4 text-accent" /> {totais.qtd.toLocaleString("pt-BR")}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Valor total</div>
          <div className="font-display text-2xl font-bold mt-1 text-success">{BRL(totais.valor)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Fornecedores</div>
          <div className="font-display text-2xl font-bold mt-1 flex items-center gap-2">
            <ShoppingCart className="size-4 text-warning" /> {totais.fornecedores}
          </div>
        </Card>
      </div>

      <div className="panel p-3 grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
        <div>
          <Label className="text-xs">Sala</Label>
          <Select value={filtroSala} onValueChange={setFiltroSala}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Produto</Label>
          <Select value={filtroProduto} onValueChange={setFiltroProduto}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {produtos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Fornecedor</Label>
          <Input value={filtroFornecedor} onChange={(e) => setFiltroFornecedor(e.target.value)} placeholder="Buscar..." />
        </div>
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead className="text-right">V. unit.</TableHead>
              <TableHead className="text-right">V. total</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>NF</TableHead>
              <TableHead>Responsável</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtradas.map((e) => (
              <TableRow key={e.id} className="table-row-hover">
                <TableCell className="whitespace-nowrap text-xs">
                  {new Date(e.data_entrada).toLocaleString("pt-BR")}
                </TableCell>
                <TableCell className="font-medium">{e.produto?.nome ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="outline">{e.sala?.nome ?? "—"}</Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {e.quantidade} {e.produto?.unidade ?? ""}
                </TableCell>
                <TableCell className="text-right font-mono">{BRL(Number(e.valor_unitario))}</TableCell>
                <TableCell className="text-right font-mono font-semibold text-success">
                  {BRL(Number(e.valor_total))}
                </TableCell>
                <TableCell className="text-sm">{e.fornecedor ?? "—"}</TableCell>
                <TableCell className="text-xs">{e.numero_nf ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.usuario_responsavel_nome ?? "—"}</TableCell>
              </TableRow>
            ))}
            {filtradas.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  Nenhuma entrada registrada com os filtros atuais.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nova entrada de estoque</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Sala *</Label>
              <Select value={form.sala_id} onValueChange={(v) => setForm({ ...form, sala_id: v, produto_id: "" })}>
                <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                <SelectContent>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Produto *</Label>
              <Select
                value={form.produto_id}
                onValueChange={(v) => setForm({ ...form, produto_id: v })}
                disabled={!form.sala_id}
              >
                <SelectTrigger><SelectValue placeholder={form.sala_id ? "Selecione o produto" : "Escolha a sala antes"} /></SelectTrigger>
                <SelectContent>
                  {produtosDisponiveis.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome} ({p.unidade})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Quantidade *</Label>
                <Input type="number" min={1} value={form.quantidade}
                  onChange={(e) => setForm({ ...form, quantidade: Number(e.target.value) })} />
              </div>
              <div className="space-y-2">
                <Label>Valor unitário (R$) *</Label>
                <Input type="number" min={0} step="0.01" value={form.valor_unitario}
                  onChange={(e) => setForm({ ...form, valor_unitario: Number(e.target.value) })} />
              </div>
            </div>
            <div className="rounded-md bg-success/10 border border-success/30 px-3 py-2 text-sm flex items-center justify-between">
              <span className="text-muted-foreground">Valor total</span>
              <span className="font-display font-bold text-lg text-success">{BRL(valorTotalCalc)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Input value={form.fornecedor} onChange={(e) => setForm({ ...form, fornecedor: e.target.value })} placeholder="Ex: Atacadão" />
              </div>
              <div className="space-y-2">
                <Label>Número da NF</Label>
                <Input value={form.numero_nf} onChange={(e) => setForm({ ...form, numero_nf: e.target.value })} placeholder="Ex: 000123456" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Data da entrada</Label>
              <Input type="datetime-local" value={form.data_entrada}
                onChange={(e) => setForm({ ...form, data_entrada: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>
              {saving ? "Salvando..." : "Registrar entrada"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
