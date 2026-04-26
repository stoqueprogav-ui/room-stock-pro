import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { Sala } from "@/lib/types";

export default function SalasPage() {
  const [salas, setSalas] = useState<Sala[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Sala | null>(null);
  const [nome, setNome] = useState("");

  const load = async () => {
    const { data } = await supabase.from("salas").select("*").order("nome");
    setSalas((data as Sala[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setNome(""); setOpen(true); };
  const openEdit = (s: Sala) => { setEditing(s); setNome(s.nome); setOpen(true); };

  const save = async () => {
    if (!nome.trim()) return;
    if (editing) {
      const { error } = await supabase.from("salas").update({ nome: nome.trim() }).eq("id", editing.id);
      if (error) return toast.error(error.message);
      toast.success("Sala atualizada");
    } else {
      const { error } = await supabase.from("salas").insert({ nome: nome.trim() });
      if (error) return toast.error(error.message);
      toast.success("Sala criada (estoque inicial 0 para todos os produtos)");
    }
    setOpen(false); load();
  };

  const remove = async (s: Sala) => {
    const { error } = await supabase.from("salas").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    toast.success("Sala removida"); load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Salas"
        description="Cada sala possui seu próprio estoque, usuários e movimentações."
        actions={<Button onClick={openNew}><Plus className="size-4" /> Nova sala</Button>}
      />
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-[180px]">Criada em</TableHead>
              <TableHead className="w-[120px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {salas.map((s) => (
              <TableRow key={s.id} className="table-row-hover">
                <TableCell className="font-medium">{s.nome}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="size-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon"><Trash2 className="size-4 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir sala?</AlertDialogTitle>
                        <AlertDialogDescription>Todos os estoques, movimentações e dívidas vinculadas serão removidos.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(s)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
            {salas.length === 0 && <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-12">Nenhuma sala.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar sala" : "Nova sala"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Nome</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Filial Centro" />
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
