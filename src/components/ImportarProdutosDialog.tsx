import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Sala, Categoria, Produto } from "@/lib/types";

type Row = {
  produto: string;
  categoria: string;
  quantidade: number;
  unidade: string;
  _status?: "novo" | "atualizar" | "erro";
  _msg?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salas: Sala[];
  categorias: Categoria[];
  produtos: Produto[];
  onDone: () => void;
};

const norm = (s: any) => String(s ?? "").trim();
const lower = (s: any) => norm(s).toLowerCase();

const COL_ALIASES: Record<keyof Omit<Row, "_status" | "_msg">, string[]> = {
  produto: ["produto", "nome", "item", "descricao", "descrição"],
  categoria: ["categoria", "grupo", "tipo"],
  quantidade: ["quantidade", "qtd", "qtde", "estoque"],
  unidade: ["unidade", "un", "und", "medida"],
};

function pickKey(headers: string[], aliases: string[]) {
  const lowered = headers.map((h) => lower(h));
  for (const a of aliases) {
    const i = lowered.indexOf(a);
    if (i >= 0) return headers[i];
  }
  return null;
}

export default function ImportarProdutosDialog({ open, onOpenChange, salas, categorias, produtos, onDone }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [salaDestino, setSalaDestino] = useState<string>("none");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const reset = () => { setRows([]); setSalaDestino("none"); setProgress(null); };

  const baixarModelo = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Produto", "Categoria", "Quantidade", "Unidade"],
      ["Coca-Cola 350ml", "Bar", 24, "un"],
      ["Detergente", "Limpeza", 5, "un"],
      ["Papel A4", "Administrativo", 2, "rs"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    XLSX.writeFile(wb, "modelo-importacao-produtos.xlsx");
  };

  const handleFile = async (file: File) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    if (json.length === 0) { toast.error("Planilha vazia"); return; }

    const headers = Object.keys(json[0]);
    const kProd = pickKey(headers, COL_ALIASES.produto);
    const kCat = pickKey(headers, COL_ALIASES.categoria);
    const kQtd = pickKey(headers, COL_ALIASES.quantidade);
    const kUn = pickKey(headers, COL_ALIASES.unidade);
    if (!kProd) { toast.error("Coluna 'Produto' não encontrada"); return; }

    const produtosByName = new Map(produtos.map((p) => [lower(p.nome), p]));

    const parsed: Row[] = json.map((r) => {
      const produto = norm(r[kProd]);
      const categoria = kCat ? norm(r[kCat]) : "";
      const quantidade = kQtd ? Number(String(r[kQtd]).replace(",", ".")) || 0 : 0;
      const unidade = kUn ? norm(r[kUn]) || "un" : "un";
      const exists = produtosByName.has(lower(produto));
      const row: Row = { produto, categoria, quantidade, unidade };
      if (!produto) { row._status = "erro"; row._msg = "Sem nome"; }
      else row._status = exists ? "atualizar" : "novo";
      return row;
    });

    setRows(parsed);
    toast.success(`${parsed.length} linha(s) carregada(s)`);
  };

  const stats = useMemo(() => ({
    novos: rows.filter((r) => r._status === "novo").length,
    atualizar: rows.filter((r) => r._status === "atualizar").length,
    erros: rows.filter((r) => r._status === "erro").length,
    catsNovas: Array.from(new Set(rows.filter((r) => r.categoria && !categorias.find((c) => lower(c.nome) === lower(r.categoria))).map((r) => r.categoria))),
  }), [rows, categorias]);

  const importar = async () => {
    const validRows = rows.filter((r) => r._status !== "erro");
    if (validRows.length === 0) { toast.error("Nada para importar"); return; }
    setLoading(true);

    try {
      // 1) Criar categorias faltantes
      const catsByName = new Map(categorias.map((c) => [lower(c.nome), c]));
      for (const nome of stats.catsNovas) {
        const { data, error } = await supabase.from("categorias").insert({ nome }).select("id, nome").single();
        if (!error && data) catsByName.set(lower(data.nome), data as Categoria);
      }

      // 2) Upsert produtos
      const produtosByName = new Map(produtos.map((p) => [lower(p.nome), p]));
      let done = 0;
      setProgress({ done: 0, total: validRows.length });

      for (const r of validRows) {
        const cat = r.categoria ? catsByName.get(lower(r.categoria)) : null;
        const existing = produtosByName.get(lower(r.produto));
        let prodId = existing?.id;

        if (existing) {
          await supabase.from("produtos").update({
            unidade: r.unidade || existing.unidade,
            categoria_id: cat?.id ?? existing.categoria_id ?? null,
          }).eq("id", existing.id);
        } else {
          const { data, error } = await supabase.from("produtos").insert({
            nome: r.produto,
            unidade: r.unidade || "un",
            categoria_id: cat?.id ?? null,
            sala_id: null,
          }).select("id").single();
          if (error || !data) { r._status = "erro"; r._msg = error?.message; continue; }
          prodId = data.id;
        }

        // 3) Ajustar estoque se sala selecionada e quantidade > 0
        if (salaDestino !== "none" && prodId && r.quantidade > 0) {
          await supabase.rpc("ajustar_estoque", {
            _produto: prodId, _sala: salaDestino,
            _quantidade: r.quantidade,
            _observacao: "Importação de planilha",
          });
        }

        done++;
        setProgress({ done, total: validRows.length });
      }

      toast.success(`Importação concluída: ${done} produto(s) processado(s)`);
      reset();
      onOpenChange(false);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro na importação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar produtos de planilha</DialogTitle>
          <DialogDescription>
            Aceita .xlsx ou .csv com colunas <b>Produto</b>, <b>Categoria</b>, <b>Quantidade</b>, <b>Unidade</b>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={baixarModelo}>
            <Download className="size-4" /> Baixar modelo
          </Button>
          <Label htmlFor="file" className="cursor-pointer">
            <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 h-9 text-sm hover:bg-muted">
              <Upload className="size-4" /> Selecionar planilha
            </div>
          </Label>
          <Input id="file" type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="bg-success/15 text-success border border-success/30">Novos: {stats.novos}</Badge>
              <Badge className="bg-primary/15 text-primary border border-primary/30">Atualizar: {stats.atualizar}</Badge>
              {stats.erros > 0 && <Badge variant="destructive">Erros: {stats.erros}</Badge>}
              {stats.catsNovas.length > 0 && (
                <Badge variant="outline">Categorias novas: {stats.catsNovas.join(", ")}</Badge>
              )}
            </div>

            <div className="space-y-2">
              <Label>Atualizar estoque na sala (opcional)</Label>
              <Select value={salaDestino} onValueChange={setSalaDestino}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— não atualizar estoque —</SelectItem>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="border rounded-md max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Un</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 200).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{r.produto}</TableCell>
                      <TableCell>{r.categoria || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{r.quantidade}</TableCell>
                      <TableCell>{r.unidade}</TableCell>
                      <TableCell>
                        {r._status === "novo" && <span className="inline-flex items-center gap-1 text-success text-xs"><CheckCircle2 className="size-3" /> Novo</span>}
                        {r._status === "atualizar" && <span className="text-primary text-xs">Atualizar</span>}
                        {r._status === "erro" && <span className="inline-flex items-center gap-1 text-destructive text-xs"><AlertTriangle className="size-3" /> {r._msg}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 200 && <div className="text-xs text-muted-foreground text-center py-2">Mostrando 200 de {rows.length} linhas.</div>}
            </div>
          </>
        )}

        {progress && (
          <div className="text-sm text-muted-foreground">Processando {progress.done} de {progress.total}…</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={importar} disabled={loading || rows.length === 0}>
            {loading ? <><Loader2 className="size-4 animate-spin" /> Importando…</> : <>Importar {stats.novos + stats.atualizar} produto(s)</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
