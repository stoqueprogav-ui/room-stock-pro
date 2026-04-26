import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Produto, Sala } from "@/lib/types";

type SalaQty = { sala_id: string; selected: boolean; quantidade: number };

export default function ProdutosPage() {
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Produto | null>(null);
  const [form, setForm] = useState({ nome: "", descricao: "", unidade: "un", estoque_minimo: 0 });
  const [escopo, setEscopo] = useState<"todas" | "selecionadas">("todas");
  const [salasQty, setSalasQty] = useState<SalaQty[]>([]);

  const load = async () => {
    const [{ data: p }, { data: s }] = await Promise.all([
      supabase.from("produtos").select("*").order("nome"),
      supabase.from("salas").select("*").order("nome"),
    ]);
    setProdutos((p as Produto[]) ?? []);
    setSalas((s as Sala[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const resetSalasQty = (salasList: Sala[], allSelected: boolean) => {
    setSalasQty(salasList.map((s) => ({ sala_id: s.id, selected: allSelected, quantidade: 0 })));
  };

  const openNew = () => {
    setEditing(null);
    setForm({ nome: "", descricao: "", unidade: "un", estoque_minimo: 0 });
    setEscopo("todas");
    resetSalasQty(salas, true);
    setOpen(true);
  };
  const openEdit = (p: Produto) => {
    setEditing(p);
    setForm({ nome: p.nome, descricao: p.descricao ?? "", unidade: p.unidade, estoque_minimo: p.estoque_minimo });
    setOpen(true);
  };

  const totalSelecionadas = useMemo(() => salasQty.filter((s) => s.selected).length, [salasQty]);

  const save = async () => {
    if (!form.nome.trim()) return toast.error("Nome obrigatório");
    const payload = {
      nome: form.nome.trim(),
      descricao: form.descricao || null,
      unidade: form.unidade.trim() || "un",
      estoque_minimo: Number(form.estoque_minimo) || 0,
    };

    if (editing) {
      const { error } = await supabase.from("produtos").update(payload).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Produto atualizado");
      setOpen(false); load();
      return;
    }

    // Criação
    if (escopo === "selecionadas" && totalSelecionadas === 0) {
      return toast.error("Selecione ao menos uma sala");
    }

    const { data: novo, error } = await supabase
      .from("produtos").insert(payload).select("id").single();
    if (error || !novo) return toast.error(error?.message ?? "Erro ao criar produto");

    // Define quais salas terão estoque inicial > 0
    const alvos = escopo === "todas"
      ? salasQty
      : salasQty.filter((s) => s.selected);

    const ajustes = alvos.filter((s) => Number(s.quantidade) > 0);
    if (ajustes.length > 0) {
      const results = await Promise.all(
        ajustes.map((s) =>
          supabase.rpc("ajustar_estoque", {
            _produto: novo.id,
            _sala: s.sala_id,
            _quantidade: Number(s.quantidade),
            _observacao: "Estoque inicial no cadastro",
          })
        )
      );
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) toast.error(`Produto criado, mas falhou ajuste: ${firstErr.message}`);
    }

    toast.success("Produto criado");
    setOpen(false); load();
  };

  const remove = async (p: Produto) => {
    const { error } = await supabase.from("produtos").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Produto removido"); load();
  };

  const toggleSala = (sala_id: string, checked: boolean) => {
    setSalasQty((prev) => prev.map((s) => s.sala_id === sala_id ? { ...s, selected: checked } : s));
  };
  const setQty = (sala_id: string, q: number) => {
    setSalasQty((prev) => prev.map((s) => s.sala_id === sala_id ? { ...s, quantidade: q } : s));
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Produtos" description="Catálogo global. No cadastro, defina o estoque inicial por sala." actions={<Button onClick={openNew}><Plus className="size-4" /> Novo produto</Button>} />
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-[100px]">Unidade</TableHead>
              <TableHead className="w-[140px] text-right">Estoque mín.</TableHead>
              <TableHead className="w-[120px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {produtos.map((p) => (
              <TableRow key={p.id} className="table-row-hover">
                <TableCell className="font-medium">{p.nome}</TableCell>
                <TableCell className="text-muted-foreground max-w-md truncate">{p.descricao ?? "—"}</TableCell>
                <TableCell>{p.unidade}</TableCell>
                <TableCell className="text-right font-mono">{p.estoque_minimo}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Pencil className="size-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="size-4 text-destructive" /></Button></AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir {p.nome}?</AlertDialogTitle>
                        <AlertDialogDescription>Todo o estoque do produto em todas as salas será removido.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(p)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
            {produtos.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-12">Nenhum produto cadastrado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-2"><Label>Descrição</Label><Textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Unidade</Label><Input value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })} placeholder="un, kg, cx…" /></div>
              <div className="space-y-2"><Label>Estoque mínimo</Label><Input type="number" min={0} value={form.estoque_minimo} onChange={(e) => setForm({ ...form, estoque_minimo: Number(e.target.value) })} /></div>
            </div>

            {!editing && (
              <div className="space-y-3 pt-2 border-t">
                <div className="space-y-2">
                  <Label>Disponibilizar em</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={escopo === "todas" ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setEscopo("todas"); resetSalasQty(salas, true); }}
                    >
                      Todas as salas
                    </Button>
                    <Button
                      type="button"
                      variant={escopo === "selecionadas" ? "default" : "outline"}
                      size="sm"
                      onClick={() => { setEscopo("selecionadas"); resetSalasQty(salas, false); }}
                    >
                      Selecionar salas
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">
                    {escopo === "todas"
                      ? "Defina a quantidade inicial em cada sala (0 para deixar zerado)."
                      : "Marque as salas e informe a quantidade inicial em cada uma."}
                  </Label>
                  <div className="rounded-md border divide-y">
                    {salasQty.map((s) => {
                      const sala = salas.find((x) => x.id === s.sala_id);
                      if (!sala) return null;
                      const enabled = escopo === "todas" || s.selected;
                      return (
                        <div key={s.sala_id} className="flex items-center gap-3 p-2.5">
                          {escopo === "selecionadas" && (
                            <Checkbox
                              checked={s.selected}
                              onCheckedChange={(v) => toggleSala(s.sala_id, !!v)}
                            />
                          )}
                          <div className="flex-1 text-sm font-medium">{sala.nome}</div>
                          <Input
                            type="number"
                            min={0}
                            value={s.quantidade}
                            disabled={!enabled}
                            onChange={(e) => setQty(s.sala_id, Number(e.target.value))}
                            className="w-28 text-right font-mono"
                          />
                          <span className="text-xs text-muted-foreground w-8">{form.unidade || "un"}</span>
                        </div>
                      );
                    })}
                    {salasQty.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground text-center">Nenhuma sala cadastrada.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
