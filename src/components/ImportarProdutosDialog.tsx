import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Sala, Categoria, Produto } from "@/lib/types";

type RowStatus = "novo" | "atualizar" | "duplicado" | "erro";
type Row = {
  produto: string;
  categoria: string;
  quantidade: number;
  unidade: string;
  _status: RowStatus;
  _msg?: string;
  _include: boolean;
  _matchedProdutoId?: string;
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
const dedupeKey = (nome: string, categoria: string) => `${lower(nome)}|${lower(categoria)}`;

const COL_ALIASES: Record<"produto" | "categoria" | "quantidade" | "unidade", string[]> = {
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
      ["Papel A4", "Administração", 2, "rs"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Produtos");
    XLSX.writeFile(wb, "modelo-importacao-produtos.xlsx");
  };

  // Reanalisa quando muda sala destino (matching considera sala)
  const analyze = (parsed: Row[], salaId: string) => {
    // Index produtos por nome (global ou da sala alvo)
    const produtosByName = new Map<string, Produto>();
    for (const p of produtos) {
      if (p.sala_id == null || (salaId !== "none" && p.sala_id === salaId)) {
        // produto da sala-alvo tem prioridade sobre global
        const cur = produtosByName.get(lower(p.nome));
        if (!cur || (cur.sala_id == null && p.sala_id != null)) {
          produtosByName.set(lower(p.nome), p);
        }
      }
    }

    const seen = new Map<string, number>(); // dedupeKey -> primeira ocorrência (índice)
    return parsed.map((r, idx) => {
      const out: Row = { ...r };
      if (!out.produto) { out._status = "erro"; out._msg = "Sem nome"; out._include = false; return out; }
      if (out.quantidade < 0) { out._status = "erro"; out._msg = "Quantidade negativa"; out._include = false; return out; }

      const key = dedupeKey(out.produto, out.categoria);
      const firstIdx = seen.get(key);
      if (firstIdx !== undefined) {
        out._status = "duplicado";
        out._msg = `Duplicado da linha ${firstIdx + 1}`;
        out._include = false;
        return out;
      }
      seen.set(key, idx);

      const existing = produtosByName.get(lower(out.produto));
      if (existing) {
        out._status = "atualizar";
        out._matchedProdutoId = existing.id;
      } else {
        out._status = "novo";
      }
      out._include = true;
      return out;
    });
  };

  // Re-analisa quando salaDestino muda
  useEffect(() => {
    if (rows.length === 0) return;
    setRows((prev) => analyze(prev.map(({ _status, _msg, _include, _matchedProdutoId, ...rest }) => ({
      ...rest, _status: "novo", _include: true,
    } as Row)), salaDestino));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salaDestino]);

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

    const parsed: Row[] = json.map((r) => ({
      produto: norm(r[kProd]),
      categoria: kCat ? norm(r[kCat]) : "",
      quantidade: kQtd ? Number(String(r[kQtd]).replace(",", ".")) || 0 : 0,
      unidade: kUn ? norm(r[kUn]) || "un" : "un",
      _status: "novo" as RowStatus,
      _include: true,
    }));

    const analyzed = analyze(parsed, salaDestino);
    setRows(analyzed);
    toast.success(`${analyzed.length} linha(s) carregada(s)`);
  };

  const toggleInclude = (idx: number) => {
    setRows((prev) => prev.map((r, i) => i === idx ? { ...r, _include: !r._include } : r));
  };

  const stats = useMemo(() => {
    const inc = rows.filter((r) => r._include);
    return {
      total: rows.length,
      novos: inc.filter((r) => r._status === "novo").length,
      atualizar: inc.filter((r) => r._status === "atualizar").length,
      duplicados: rows.filter((r) => r._status === "duplicado").length,
      erros: rows.filter((r) => r._status === "erro").length,
      catsNovas: Array.from(new Set(inc
        .filter((r) => r.categoria && !categorias.find((c) => lower(c.nome) === lower(r.categoria)))
        .map((r) => r.categoria))),
    };
  }, [rows, categorias]);

  const importar = async () => {
    const validRows = rows.filter((r) => r._include && (r._status === "novo" || r._status === "atualizar"));
    if (validRows.length === 0) { toast.error("Nenhuma linha selecionada para importar"); return; }
    setLoading(true);

    try {
      const catsByName = new Map(categorias.map((c) => [lower(c.nome), c]));
      for (const nome of stats.catsNovas) {
        const { data, error } = await supabase.from("categorias").insert({ nome }).select("id, nome").single();
        if (!error && data) catsByName.set(lower(data.nome), data as Categoria);
      }

      let done = 0;
      setProgress({ done: 0, total: validRows.length });

      for (const r of validRows) {
        const cat = r.categoria ? catsByName.get(lower(r.categoria)) : null;
        let prodId = r._matchedProdutoId;

        if (prodId) {
          const existing = produtos.find((p) => p.id === prodId);
          await supabase.from("produtos").update({
            unidade: r.unidade || existing?.unidade || "un",
            categoria_id: cat?.id ?? existing?.categoria_id ?? null,
            ativo: true,
          }).eq("id", prodId);
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
            Duplicados e produtos já cadastrados são detectados automaticamente.
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
            <div className="space-y-2">
              <Label>Atualizar estoque na sala (opcional)</Label>
              <Select value={salaDestino} onValueChange={setSalaDestino}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— não atualizar estoque —</SelectItem>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">A detecção de duplicados considera a sala selecionada.</p>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="bg-success/15 text-success border border-success/30">Novos: {stats.novos}</Badge>
              <Badge className="bg-primary/15 text-primary border border-primary/30">Atualizar: {stats.atualizar}</Badge>
              {stats.duplicados > 0 && <Badge variant="outline" className="border-warning/40 text-warning">Duplicados: {stats.duplicados}</Badge>}
              {stats.erros > 0 && <Badge variant="destructive">Erros: {stats.erros}</Badge>}
              {stats.catsNovas.length > 0 && (
                <Badge variant="outline">Categorias novas: {stats.catsNovas.join(", ")}</Badge>
              )}
            </div>

            <div className="border rounded-md max-h-72 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Un</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 300).map((r, i) => (
                    <TableRow key={i} className={r._status === "erro" || r._status === "duplicado" ? "opacity-60" : ""}>
                      <TableCell>
                        <Checkbox
                          checked={r._include}
                          disabled={r._status === "erro"}
                          onCheckedChange={() => toggleInclude(i)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{r.produto}</TableCell>
                      <TableCell>{r.categoria || "—"}</TableCell>
                      <TableCell className="text-right font-mono">{r.quantidade}</TableCell>
                      <TableCell>{r.unidade}</TableCell>
                      <TableCell className="text-xs">
                        {r._status === "novo" && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> Novo</span>}
                        {r._status === "atualizar" && <span className="text-primary">Atualizar existente</span>}
                        {r._status === "duplicado" && <span className="inline-flex items-center gap-1 text-warning"><Copy className="size-3" /> {r._msg}</span>}
                        {r._status === "erro" && <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-3" /> {r._msg}</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 300 && <div className="text-xs text-muted-foreground text-center py-2">Mostrando 300 de {rows.length} linhas.</div>}
            </div>
          </>
        )}

        {progress && (
          <div className="text-sm text-muted-foreground">Processando {progress.done} de {progress.total}…</div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
          <Button onClick={importar} disabled={loading || stats.novos + stats.atualizar === 0}>
            {loading ? <><Loader2 className="size-4 animate-spin" /> Importando…</> : <>Importar {stats.novos + stats.atualizar} produto(s)</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
