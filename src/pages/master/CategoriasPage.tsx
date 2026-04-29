import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, ArrowRight } from "lucide-react";
import type { Categoria } from "@/lib/types";

type Counts = Record<string, number>;

export default function CategoriasPage() {
  const [cats, setCats] = useState<Categoria[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Categoria | null>(null);
  const [nome, setNome] = useState("");

  // Excluir / transferir
  const [confirmDel, setConfirmDel] = useState<Categoria | null>(null);
  const [transferTo, setTransferTo] = useState<string>("");

  const load = async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from("categorias").select("*").order("nome"),
      supabase.from("produtos").select("categoria_id"),
    ]);
    setCats((c as Categoria[]) ?? []);
    const map: Counts = {};
    (p ?? []).forEach((row: any) => {
      if (row.categoria_id) map[row.categoria_id] = (map[row.categoria_id] ?? 0) + 1;
    });
    setCounts(map);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setNome(""); setOpen(true); };
  const openEdit = (c: Categoria) => { setEditing(c); setNome(c.nome); setOpen(true); };

  const save = async () => {
    const n = nome.trim();
    if (!n) return toast.error("Informe o nome da categoria");
    if (editing) {
      const { error } = await supabase.from("categorias").update({ nome: n }).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Categoria atualizada");
    } else {
      const { error } = await supabase.from("categorias").insert({ nome: n });
      if (error) return toast.error(error.message);
      toast.success("Categoria criada");
    }
    setOpen(false);
    load();
  };

  const askDelete = (c: Categoria) => {
    setConfirmDel(c);
    setTransferTo("");
  };

  const confirmDelete = async () => {
    if (!confirmDel) return;
    const total = counts[confirmDel.id] ?? 0;
    if (total > 0) {
      if (!transferTo) {
        return toast.error("Selecione uma categoria de destino para transferir os produtos");
      }
      const { error: upErr } = await supabase.from("produtos")
        .update({ categoria_id: transferTo })
        .eq("categoria_id", confirmDel.id);
      if (upErr) return toast.error(upErr.message);
    }
    const { error } = await supabase.from("categorias").delete().eq("id", confirmDel.id);
    if (error) return toast.error(error.message);
    toast.success("Categoria excluída");
    setConfirmDel(null);
    load();
  };

  const outras = cats.filter((c) => c.id !== confirmDel?.id);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gerenciar Categorias"
        description="Categorias de produtos. Toda alteração reflete em estoque, requisições, empréstimos, relatórios e PDFs."
        actions={<Button onClick={openNew}><Plus className="size-4" /> Nova categoria</Button>}
      />
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="text-right w-[140px]">Produtos</TableHead>
              <TableHead className="text-right w-[160px]">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cats.map((c) => (
              <TableRow key={c.id} className="table-row-hover">
                <TableCell className="font-medium flex items-center gap-2">
                  <Tag className="size-4 text-muted-foreground" /> {c.nome}
                </TableCell>
                <TableCell className="text-right font-mono">{counts[c.id] ?? 0}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="size-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => askDelete(c)}>
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {cats.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-12">Nenhuma categoria.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar categoria" : "Nova categoria"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Bar, Kids, Limpeza…" autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir categoria "{confirmDel?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDel && (counts[confirmDel.id] ?? 0) > 0 ? (
                <>
                  Esta categoria tem <strong>{counts[confirmDel.id]}</strong> produto(s) vinculado(s).
                  Selecione abaixo uma categoria de destino para transferir os produtos antes de excluir.
                </>
              ) : (
                "Esta ação não pode ser desfeita."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmDel && (counts[confirmDel.id] ?? 0) > 0 && (
            <div className="space-y-2 py-2">
              <Label>Transferir produtos para</Label>
              <Select value={transferTo} onValueChange={setTransferTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Escolha a categoria de destino" />
                </SelectTrigger>
                <SelectContent>
                  {outras.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {transferTo && (
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <strong>{confirmDel.nome}</strong> <ArrowRight className="size-3" />
                  <strong>{outras.find((o) => o.id === transferTo)?.nome}</strong>
                </div>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
