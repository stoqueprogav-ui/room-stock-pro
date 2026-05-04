import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Globe2, Building2, RotateCcw, FileSpreadsheet } from "lucide-react";
import type { Produto, Sala, Categoria } from "@/lib/types";
import ImportarProdutosDialog from "@/components/ImportarProdutosDialog";

type SalaQty = { sala_id: string; selected: boolean; quantidade: number };
type Escopo = "global" | "sala";

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", unidade: "un", estoque_minimo: 0, estoque_critico: 0, categoria_id: "" });

  // Escopo do produto
  const [escopo, setEscopo] = useState<Escopo>("global");
  const [salaUnica, setSalaUnica] = useState<string>("");
  const [qtdInicialSala, setQtdInicialSala] = useState<number>(0);
  const [salasQty, setSalasQty] = useState<SalaQty[]>([]);

  const [filtroCat, setFiltroCat] = useState<string>("all");
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // Confirmação de exclusão
  const [confirmDel, setConfirmDel] = useState<Produto | null>(null);
  const [delLoading, setDelLoading] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: s }, { data: c }] = await Promise.all([
      supabase.from("produtos").select("*, categoria:categorias(id, nome), sala:salas(id, nome)").order("nome"),
      supabase.from("salas").select("*").order("nome"),
      supabase.from("categorias").select("*").order("nome"),
    ]);
    setProdutos((p as any) ?? []);
    setSalas((s as Sala[]) ?? []);
    setCategorias((c as Categoria[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const resetSalasQty = (salasList: Sala[]) => {
    setSalasQty(salasList.map((s) => ({ sala_id: s.id, selected: false, quantidade: 0 })));
  };

  const openNew = () => {
    setEditing(null);
    setForm({ nome: "", descricao: "", unidade: "un", estoque_minimo: 0, estoque_critico: 0, categoria_id: "" });
    setEscopo("global");
    setSalaUnica("");
    setQtdInicialSala(0);
    resetSalasQty(salas);
    setOpen(true);
  };
  const openEdit = (p: Produto) => {
    setEditing(p);
    setForm({
      nome: p.nome,
      descricao: p.descricao ?? "",
      unidade: p.unidade,
      estoque_minimo: p.estoque_minimo,
      estoque_critico: p.estoque_critico ?? 0,
      categoria_id: p.categoria_id ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    if (!form.categoria_id) return toast.error("Categoria obrigatória");

    const payload: any = {
      nome: form.nome.trim(),
      descricao: form.descricao || null,
      unidade: form.unidade.trim() || "un",
      estoque_minimo: Number(form.estoque_minimo) || 0,
      estoque_critico: Number(form.estoque_critico) || 0,
      categoria_id: form.categoria_id,
    };

    if (editing) {
      // Edição: não altera escopo (sala_id) para evitar inconsistências de estoque
      const { error } = await supabase.from("produtos").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Produto atualizado");
      setOpen(false); load();
      return;
    }

    // Validações de escopo
    if (escopo === "sala" && !salaUnica) {
      return toast.error("Selecione a sala vinculada ao produto");
    }

    payload.sala_id = escopo === "sala" ? salaUnica : null;

    const { data: novo, error } = await supabase
      .from("produtos").insert(payload).select("id").single();
    if (error || !novo) return toast.error(error?.message ?? "Erro ao criar produto");

    // Quantidades iniciais
    if (escopo === "sala" && Number(qtdInicialSala) > 0) {
      const { error: e2 } = await supabase.rpc("ajustar_estoque", {
        _produto: novo.id, _sala: salaUnica,
        _quantidade: Number(qtdInicialSala),
        _observacao: "Estoque inicial no cadastro",
      });
      if (e2) toast.error(`Produto criado, mas falhou ajuste: ${e2.message}`);
    } else if (escopo === "global") {
      const ajustes = salasQty.filter((s) => Number(s.quantidade) > 0);
      if (ajustes.length > 0) {
        const results = await Promise.all(
          ajustes.map((s) =>
            supabase.rpc("ajustar_estoque", {
              _produto: novo.id, _sala: s.sala_id,
              _quantidade: Number(s.quantidade),
              _observacao: "Estoque inicial no cadastro (global)",
            })
          )
        );
        const firstErr = results.find((r) => r.error)?.error;
        if (firstErr) toast.error(`Produto criado, mas falhou ajuste: ${firstErr.message}`);
      }
    }

    toast.success(escopo === "global" ? "Produto global criado" : "Produto criado para a sala");
    setOpen(false); load();
  };

  const confirmarExclusao = async () => {
    if (!confirmDel) return;
    setDelLoading(true);
    const { data, error } = await supabase.rpc("excluir_produto", { _produto: confirmDel.id });
    setDelLoading(false);
    if (error) {
      toast.error(error.message ?? "Não foi possível excluir o produto");
      return;
    }
    const res = (data as any) ?? {};
    if (res.modo === "desativado") {
      toast.success(res.mensagem ?? "Produto desativado");
    } else {
      toast.success(res.mensagem ?? "Produto excluído");
    }
    setConfirmDel(null);
    load();
  };

  const reativar = async (p: Produto) => {
    const { error } = await supabase.rpc("reativar_produto", { _produto: p.id });
    if (error) return toast.error(error.message);
    toast.success("Produto reativado");
    load();
  };

  const setQty = (sala_id: string, q: number) => {
    setSalasQty((prev) => prev.map((s) => s.sala_id === sala_id ? { ...s, quantidade: q } : s));
  };

  const lista = useMemo(() => produtos
    .filter((p) => mostrarInativos ? true : (p.ativo !== false))
    .filter((p) => filtroCat === "all" || p.categoria_id === filtroCat),
    [produtos, filtroCat, mostrarInativos]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos"
        description="Catálogo. Produtos podem ser globais (todas as salas) ou exclusivos de uma sala."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}><FileSpreadsheet className="size-4" /> Importar</Button>
            <Button onClick={openNew}><Plus className="size-4" /> Novo produto</Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-muted-foreground mr-1">Categoria:</span>
        <Button size="sm" variant={filtroCat === "all" ? "default" : "outline"} onClick={() => setFiltroCat("all")}>
          Todas
        </Button>
        {categorias.map((c) => (
          <Button key={c.id} size="sm" variant={filtroCat === c.id ? "default" : "outline"} onClick={() => setFiltroCat(c.id)}>
            <Tag className="size-3" /> {c.nome}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs">
          <Checkbox id="inativos" checked={mostrarInativos} onCheckedChange={(v) => setMostrarInativos(!!v)} />
          <label htmlFor="inativos" className="cursor-pointer text-muted-foreground">Mostrar inativos</label>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[120px]">Escopo</TableHead>
              <TableHead className="w-[140px]">Categoria</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-[90px]">Unidade</TableHead>
              <TableHead className="w-[90px] text-right">Mínimo</TableHead>
              <TableHead className="w-[90px] text-right">Crítico</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[140px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lista.map((p) => {
              const inativo = p.ativo === false;
              return (
                <TableRow key={p.id} className={`table-row-hover ${inativo ? "opacity-60" : ""}`}>
                  <TableCell className="font-medium">{p.nome}</TableCell>
                  <TableCell>
                    {p.sala_id
                      ? <Badge variant="outline" className="gap-1 border-accent/40 text-accent"><Building2 className="size-3" /> {p.sala?.nome ?? "Sala"}</Badge>
                      : <Badge variant="outline" className="gap-1 border-primary/40 text-primary"><Globe2 className="size-3" /> Global</Badge>}
                  </TableCell>
                  <TableCell>
                    {p.categoria
                      ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" /> {p.categoria.nome}</Badge>
                      : <span className="text-xs text-destructive">— sem categoria</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-md truncate">{p.descricao ?? "—"}</TableCell>
                  <TableCell>{p.unidade}</TableCell>
                  <TableCell className="text-right font-mono text-warning">{p.estoque_minimo}</TableCell>
                  <TableCell className="text-right font-mono text-destructive">{p.estoque_critico ?? 0}</TableCell>
                  <TableCell>
                    {inativo
                      ? <Badge className="bg-muted text-muted-foreground border">Inativo</Badge>
                      : <Badge className="bg-success/15 text-success border border-success/30">Ativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    {inativo ? (
                      <Button variant="ghost" size="sm" onClick={() => reativar(p)} className="gap-1">
                        <RotateCcw className="size-4" /> Reativar
                      </Button>
                    ) : (
                      <>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDel(p)}>
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {lista.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-12">Nenhum produto.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      {/* Cadastro / Edição */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Nome *</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-2">
              <Label>Categoria *</Label>
              <Select value={form.categoria_id} onValueChange={(v) => setForm({ ...form, categoria_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a categoria" /></SelectTrigger>
                <SelectContent>
                  {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              {categorias.length === 0 && (
                <p className="text-xs text-destructive">Nenhuma categoria cadastrada. Crie uma em "Categorias".</p>
              )}
            </div>
            <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2"><Label>Unidade</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} placeholder="un, kg, cx…" /></div>
              <div className="space-y-2"><Label>Estoque mínimo</Label><Input type="number" min={0} value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} /></div>
              <div className="space-y-2"><Label>Estoque crítico</Label><Input type="number" min={0} value={form.estoque_critico} onChange={(e) => setForm({ ...form, estoque_critico: Number(e.target.value) })} /></div>
            </div>

            {!editing && (
              <div className="space-y-3 pt-3 border-t">
                <div className="space-y-2">
                  <Label>Tipo de cadastro *</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setEscopo("global")}
                      className={`rounded-md border p-3 text-left transition ${escopo === "global" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    >
                      <div className="flex items-center gap-2 font-medium"><Globe2 className="size-4 text-primary" /> Produto global</div>
                      <div className="text-xs text-muted-foreground mt-1">Disponível em todas as salas.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEscopo("sala")}
                      className={`rounded-md border p-3 text-left transition ${escopo === "sala" ? "border-accent bg-accent/5" : "border-border hover:bg-muted/50"}`}
                    >
                      <div className="flex items-center gap-2 font-medium"><Building2 className="size-4 text-accent" /> Apenas para uma sala</div>
                      <div className="text-xs text-muted-foreground mt-1">Não aparece em outras salas.</div>
                    </button>
                  </div>
                </div>

                {escopo === "sala" ? (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="space-y-2">
                      <Label>Sala vinculada *</Label>
                      <Select value={salaUnica} onValueChange={setSalaUnica}>
                        <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                        <SelectContent>
                          {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Quantidade inicial</Label>
                      <Input type="number" min={0} value={qtdInicialSala} onChange={(e) => setQtdInicialSala(Number(e.target.value))} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-md border p-3">
                    <Label className="text-xs text-muted-foreground">
                      Quantidade inicial por sala (opcional, deixe 0 para iniciar zerado).
                    </Label>
                    <div className="divide-y">
                      {salasQty.map((s) => {
                        const sala = salas.find((x) => x.id === s.sala_id);
                        if (!sala) return null;
                        return (
                          <div key={s.sala_id} className="flex items-center gap-3 py-2">
                            <div className="flex-1 text-sm font-medium">{sala.nome}</div>
                            <Input type="number" min={0} value={s.quantidade}
                              onChange={(e) => setQty(s.sala_id, Number(e.target.value))}
                              className="w-28 text-right font-mono" />
                            <span className="text-xs text-muted-foreground w-8">{form.unidade || "un"}</span>
                          </div>
                        );
                      })}
                      {salasQty.length === 0 && (
                        <div className="py-3 text-sm text-muted-foreground text-center">Nenhuma sala cadastrada.</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmação de exclusão */}
      <Dialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir “{confirmDel?.nome}”?</DialogTitle>
            <DialogDescription>
              Se houver histórico (movimentações, requisições ou empréstimos) o produto será apenas{" "}
              <span className="font-medium text-foreground">desativado</span> para preservar os dados.
              Caso contrário, será excluído permanentemente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDel(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmarExclusao} disabled={delLoading}>
              {delLoading ? "Processando..." : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
