import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, AlertTriangle, CheckCircle2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Sala, Categoria, Produto } from "@/lib/types";

type Row = {
  nome: string;
  categoria: string;
  unidade: string;
  custo: string;
  quantidade: string;
  validade: string; // DD/MM/AAAA
};

type Analyzed = Row & {
  _errors: string[];
  _warnings: string[];
  _categoriaId?: string | null;
  _custoNum: number;
  _qtdNum: number;
  _validadeIso: string | null; // yyyy-mm-dd or null
  _existingProdutoId?: string | null;
  _existingAtivo?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salas: Sala[];
  categorias: Categoria[];
  produtos: Produto[];
  salaPadrao?: string | null;
  onDone: () => void;
};

const norm = (s: any) => String(s ?? "").trim();
const lower = (s: any) => norm(s).toLowerCase();
const normalizeName = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

function parseNumberBR(v: string): number | null {
  const s = norm(v).replace(/\./g, "").replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function parseDateBR(v: string): { iso: string | null; error: boolean } {
  const s = norm(v);
  if (!s) return { iso: null, error: false };
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return { iso: null, error: true };
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(yyyy, mm - 1, dd);
  if (d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return { iso: null, error: true };
  const iso = `${yyyy.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  return { iso, error: false };
}

const EMPTY_ROW = (): Row => ({ nome: "", categoria: "", unidade: "Unidade", custo: "", quantidade: "", validade: "" });

const HEADER_LABEL = "Nome\tCategoria\tUnidade\tCusto unitário\tQuantidade\tValidade";

function parseColada(text: string): Row[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const parseLine = (line: string): string[] => {
    if (line.includes("\t")) return line.split("\t");
    // CSV simples (sem aspas complexas)
    return line.split(",");
  };
  const first = parseLine(lines[0]).map((c) => lower(c));
  const looksLikeHeader = first.some((c) => ["nome", "produto", "categoria", "quantidade", "custo", "custo unitário", "validade"].includes(c));
  const dataLines = looksLikeHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const cols = parseLine(line);
    return {
      nome: norm(cols[0]),
      categoria: norm(cols[1]),
      unidade: norm(cols[2]) || "Unidade",
      custo: norm(cols[3]),
      quantidade: norm(cols[4]),
      validade: norm(cols[5]),
    };
  });
}

export default function ImportarProdutosDialog({
  open, onOpenChange, salas, categorias, produtos, salaPadrao, onDone,
}: Props) {
  const [rows, setRows] = useState<Row[]>([EMPTY_ROW()]);
  const [pasted, setPasted] = useState("");
  const [salaDestino, setSalaDestino] = useState<string>(salaPadrao ?? "");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resumo, setResumo] = useState<{ criados: number; entradas: number; ignoradas: Array<{ nome: string; motivo: string }> } | null>(null);

  useEffect(() => {
    if (open) {
      setSalaDestino(salaPadrao ?? "");
      setResumo(null);
    }
  }, [open, salaPadrao]);

  const reset = () => { setRows([EMPTY_ROW()]); setPasted(""); setProgress(null); setResumo(null); };

  const catsByLower = useMemo(() => {
    const m = new Map<string, Categoria>();
    for (const c of categorias) m.set(lower(c.nome), c);
    return m;
  }, [categorias]);

  const prodsSalaByNorm = useMemo(() => {
    const m = new Map<string, { id: string; ativo: boolean }>();
    if (!salaDestino) return m;
    for (const p of produtos) {
      if ((p as any).sala_id === salaDestino) {
        m.set(normalizeName(p.nome), { id: p.id, ativo: (p as any).ativo !== false });
      }
    }
    return m;
  }, [produtos, salaDestino]);

  const analyzed: Analyzed[] = useMemo(() => {
    return rows.map((r) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const nome = norm(r.nome);
      if (!nome) errors.push("Nome vazio");

      let categoriaId: string | null | undefined = undefined;
      if (nome) {
        if (!r.categoria) {
          errors.push("Categoria vazia");
        } else {
          const cat = catsByLower.get(lower(r.categoria));
          if (!cat) errors.push(`Categoria "${r.categoria}" não existe`);
          else categoriaId = cat.id;
        }
      }

      const custoN = parseNumberBR(r.custo);
      if (custoN === null || custoN < 0) errors.push("Custo inválido");

      const qtdN = parseNumberBR(r.quantidade);
      if (qtdN === null || qtdN < 0) errors.push("Quantidade inválida");

      const val = parseDateBR(r.validade);
      if (val.error) errors.push("Validade inválida (use DD/MM/AAAA)");

      let existingId: string | null = null;
      let existingAtivo = true;
      if (nome && salaDestino) {
        const found = prodsSalaByNorm.get(normalizeName(nome));
        if (found) {
          existingId = found.id;
          existingAtivo = found.ativo;
          if (!existingAtivo) warnings.push("Existe inativo — será reativado");
          else warnings.push("Existe — nova entrada será adicionada");
        }
      }

      return {
        ...r,
        _errors: errors,
        _warnings: warnings,
        _categoriaId: categoriaId ?? null,
        _custoNum: custoN ?? 0,
        _qtdNum: qtdN ?? 0,
        _validadeIso: val.iso,
        _existingProdutoId: existingId,
        _existingAtivo: existingAtivo,
      };
    });
  }, [rows, catsByLower, prodsSalaByNorm, salaDestino]);

  const validasCount = analyzed.filter((a) => a._errors.length === 0 && norm(a.nome)).length;
  const errosCount = analyzed.filter((a) => a._errors.length > 0).length;

  const aplicarColagem = () => {
    const parsed = parseColada(pasted);
    if (parsed.length === 0) { toast.error("Nada para importar. Cole linhas TSV/CSV."); return; }
    setRows(parsed);
    toast.success(`${parsed.length} linha(s) carregada(s)`);
  };

  const updateCell = (idx: number, key: keyof Row, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, EMPTY_ROW()]);
  const removeRow = (idx: number) => setRows((prev) => prev.filter((_, i) => i !== idx));

  const importar = async () => {
    if (!salaDestino) { toast.error("Selecione a sala destino"); return; }
    const validas = analyzed.filter((a) => a._errors.length === 0 && norm(a.nome));
    if (validas.length === 0) { toast.error("Nenhuma linha válida para importar"); return; }

    setLoading(true);
    setProgress({ done: 0, total: validas.length });
    let criados = 0;
    let entradas = 0;
    const ignoradas: Array<{ nome: string; motivo: string }> = [];

    try {
      for (let i = 0; i < validas.length; i++) {
        const r = validas[i];
        try {
          let produtoId = r._existingProdutoId ?? null;

          // Reativar se necessário
          if (produtoId && r._existingAtivo === false) {
            await (supabase as any).rpc("toggle_produto_sala_ativo", {
              _produto_id: produtoId, _sala_id: salaDestino, _ativo: true,
            });
          }

          // Criar se não existe
          if (!produtoId) {
            // Reaproveita nome exato do catálogo por chave normalizada
            let nomeFinal = norm(r.nome);
            const alvo = normalizeName(nomeFinal);
            if (alvo.length > 0) {
              const { data: catalogos } = await supabase
                .from("produtos_catalogo")
                .select("id, nome");
              const match = (catalogos ?? []).find((c: any) => normalizeName(c.nome) === alvo);
              if (match) nomeFinal = match.nome;
            }

            const { data: novo, error } = await supabase.from("produtos").insert({
              nome: nomeFinal,
              unidade: (r.unidade || "Unidade").trim(),
              categoria_id: r._categoriaId,
              custo_unitario: r._custoNum,
              estoque_minimo: 0,
              sala_id: salaDestino,
            } as any).select("id").single();

            if (error || !novo) {
              // Trata caso em que existe (talvez inativo) — busca e reativa
              const { data: prods } = await supabase
                .from("produtos")
                .select("id, ativo")
                .eq("sala_id", salaDestino)
                .eq("ativo", true);
              const existente = (prods ?? []).find((p: any) => normalizeName((p as any).nome ?? "") === alvo);
              // fallback: busca por nome
              const { data: prods2 } = existente ? { data: null } : await supabase
                .from("produtos")
                .select("id, nome, ativo")
                .eq("sala_id", salaDestino)
                .eq("ativo", true)
                .ilike("nome", nomeFinal);
              const alvoRow: any = existente ?? (prods2 ?? []).find((p: any) => normalizeName(p.nome) === alvo);
              if (alvoRow?.id) {
                produtoId = alvoRow.id;
                if (alvoRow.ativo === false) {
                  await (supabase as any).rpc("toggle_produto_sala_ativo", {
                    _produto_id: produtoId, _sala_id: salaDestino, _ativo: true,
                  });
                }
              } else {
                ignoradas.push({ nome: r.nome, motivo: error?.message ?? "Falha ao criar produto" });
                setProgress({ done: i + 1, total: validas.length });
                continue;
              }
            } else {
              produtoId = novo.id;
              criados++;
            }
          }

          // Entrada de estoque valorizada + lote
          if (produtoId && r._qtdNum > 0) {
            const { error: e2 } = await supabase.rpc("registrar_entrada_estoque", {
              _produto: produtoId,
              _sala: salaDestino,
              _quantidade: r._qtdNum,
              _valor_unitario: r._custoNum,
              _fornecedor: null,
              _numero_nf: null,
              _data_entrada: new Date().toISOString(),
              _observacao: "Importação",
              _validade: r._validadeIso,
            } as any);
            if (e2) {
              ignoradas.push({ nome: r.nome, motivo: `Entrada falhou: ${e2.message}` });
            } else {
              entradas++;
            }
          }
        } catch (e: any) {
          ignoradas.push({ nome: r.nome, motivo: e?.message ?? "Erro" });
        }
        setProgress({ done: i + 1, total: validas.length });
      }

      // Linhas com erro na pré-visualização também entram no resumo
      for (const a of analyzed) {
        if (a._errors.length > 0 && norm(a.nome)) {
          ignoradas.push({ nome: a.nome, motivo: a._errors.join("; ") });
        } else if (!norm(a.nome) && (a.categoria || a.custo || a.quantidade || a.validade)) {
          ignoradas.push({ nome: "(sem nome)", motivo: "Nome vazio" });
        }
      }

      setResumo({ criados, entradas, ignoradas });
      toast.success(`Importação concluída: ${criados} criado(s), ${entradas} entrada(s)`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro na importação");
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) { onOpenChange(v); if (!v) reset(); } }}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar produtos com estoque e validade</DialogTitle>
          <DialogDescription>
            Cole linhas de planilha (TSV/CSV) ou preencha a grade. Colunas:
            <br /><code className="text-xs">{HEADER_LABEL.replace(/\t/g, "  |  ")}</code>
            <br />Cada linha vira, na sala destino, um produto (se novo) e uma <strong>entrada valorizada</strong> com lote (se quantidade &gt; 0). Validade opcional em DD/MM/AAAA.
          </DialogDescription>
        </DialogHeader>

        {resumo ? (
          <div className="space-y-3">
            <div className="rounded-md border p-3 space-y-2">
              <div className="text-sm font-medium">Resumo da importação</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge className="bg-success/15 text-success border border-success/30">{resumo.criados} produto(s) criado(s)</Badge>
                <Badge className="bg-primary/15 text-primary border border-primary/30">{resumo.entradas} entrada(s) adicionada(s)</Badge>
                {resumo.ignoradas.length > 0 && <Badge variant="destructive">{resumo.ignoradas.length} linha(s) ignorada(s)</Badge>}
              </div>
              {resumo.ignoradas.length > 0 && (
                <div className="text-xs max-h-40 overflow-y-auto border rounded p-2 bg-muted/30">
                  {resumo.ignoradas.map((it, i) => (
                    <div key={i}><strong>{it.nome}</strong>: {it.motivo}</div>
                  ))}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Nova importação</Button>
              <Button onClick={() => { onOpenChange(false); reset(); }}>Fechar</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Sala destino *</Label>
              <Select value={salaDestino} onValueChange={setSalaDestino}>
                <SelectTrigger><SelectValue placeholder="Selecione a sala destino" /></SelectTrigger>
                <SelectContent>
                  {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Colar da planilha (TSV/CSV)</Label>
              <Textarea
                rows={4}
                placeholder={`${HEADER_LABEL}\nCoca-Cola 350ml\tBar\tUnidade\t3,50\t24\t31/12/2026`}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={aplicarColagem}>Carregar linhas coladas</Button>
                <Button size="sm" variant="ghost" onClick={() => setRows([EMPTY_ROW()])}>Limpar grade</Button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Badge className="bg-success/15 text-success border border-success/30">Válidas: {validasCount}</Badge>
              {errosCount > 0 && <Badge variant="destructive">Com erro: {errosCount}</Badge>}
              {!salaDestino && <Badge variant="outline" className="border-warning/40 text-warning">Selecione a sala destino</Badge>}
            </div>

            <div className="border rounded-md max-h-[46vh] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="text-right">Custo unit.</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead>Validade</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analyzed.map((a, i) => {
                    const invalid = a._errors.length > 0;
                    return (
                      <TableRow key={i} className={invalid ? "bg-destructive/5" : ""}>
                        <TableCell><Input value={a.nome} onChange={(e) => updateCell(i, "nome", e.target.value)} className="h-8" /></TableCell>
                        <TableCell><Input value={a.categoria} onChange={(e) => updateCell(i, "categoria", e.target.value)} className="h-8" /></TableCell>
                        <TableCell><Input value={a.unidade} onChange={(e) => updateCell(i, "unidade", e.target.value)} className="h-8 w-24" /></TableCell>
                        <TableCell><Input value={a.custo} onChange={(e) => updateCell(i, "custo", e.target.value)} className="h-8 w-24 text-right" placeholder="0,00" /></TableCell>
                        <TableCell><Input value={a.quantidade} onChange={(e) => updateCell(i, "quantidade", e.target.value)} className="h-8 w-20 text-right" placeholder="0" /></TableCell>
                        <TableCell><Input value={a.validade} onChange={(e) => updateCell(i, "validade", e.target.value)} className="h-8 w-32" placeholder="DD/MM/AAAA" /></TableCell>
                        <TableCell className="text-xs">
                          {invalid && (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <AlertTriangle className="size-3" /> {a._errors.join("; ")}
                            </span>
                          )}
                          {!invalid && a._warnings.length > 0 && (
                            <span className="text-warning">{a._warnings.join("; ")}</span>
                          )}
                          {!invalid && a._warnings.length === 0 && norm(a.nome) && (
                            <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-3" /> Novo</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeRow(i)} className="h-7 w-7">
                            <Trash2 className="size-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div>
              <Button size="sm" variant="outline" onClick={addRow}><Plus className="size-3" /> Adicionar linha</Button>
            </div>

            {progress && (
              <div className="text-sm text-muted-foreground">Processando {progress.done} de {progress.total}…</div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Cancelar</Button>
              <Button onClick={importar} disabled={loading || validasCount === 0 || !salaDestino}>
                {loading ? <><Loader2 className="size-4 animate-spin" /> Importando…</> : <>Importar {validasCount} linha(s)</>}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
