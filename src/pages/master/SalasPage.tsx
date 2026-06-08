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
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/NotificationsContext";
import type { Sala } from "@/lib/types";

export default function SalasPage() {
  const { perSalaCount } = useNotifications();
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

  const [deps, setDeps] = useState<{ sala: Sala; info: any } | null>(null);
  const [forcing, setForcing] = useState(false);

  const remove = async (s: Sala, force = false) => {
    const { data, error } = await supabase.rpc("excluir_sala", { _sala: s.id, _force: force });
    if (error) return toast.error(error.message);
    const res = (data as any) ?? {};
    if (res.has_deps) {
      setDeps({ sala: s, info: res });
      return;
    }
    toast.success("Sala excluída"); setDeps(null); load();
  };

  const confirmForce = async () => {
    if (!deps) return;
    setForcing(true);
    const { error } = await supabase.rpc("excluir_sala", { _sala: deps.sala.id, _force: true });
    setForcing(false);
    if (error) return toast.error(error.message);
    toast.success(`Sala "${deps.sala.nome}" e dados vinculados removidos`);
    setDeps(null); load();
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
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <span>{s.nome}</span>
                    {perSalaCount[s.id] > 0 && (
                      <Badge className="bg-destructive text-destructive-foreground border-transparent h-5 px-1.5 text-[10px] animate-pulse">
                        {perSalaCount[s.id]}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(s.created_at).toLocaleDateString("pt-BR")}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Editar sala" onClick={() => openEdit(s)}><Pencil className="size-4" /></Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Excluir sala"><Trash2 className="size-4 text-destructive" /></Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir sala "{s.nome}"?</AlertDialogTitle>
                        <AlertDialogDescription>O sistema verificará se há dados vinculados antes de excluir.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(s, false)}>Verificar e excluir</AlertDialogAction>
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

      <AlertDialog open={!!deps} onOpenChange={(o) => !o && setDeps(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sala "{deps?.sala.nome}" possui dados vinculados</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div>Antes de excluir, transfira ou trate estes itens. Se confirmar a exclusão forçada, <strong>tudo será removido</strong> e os usuários ficarão sem sala.</div>
                <ul className="list-disc pl-5 text-foreground">
                  {deps?.info?.usuarios > 0 && <li>{deps.info.usuarios} usuário(s) vinculado(s) — ficarão sem sala</li>}
                  {deps?.info?.estoque > 0 && <li>{deps.info.estoque} produto(s) com estoque positivo</li>}
                  {deps?.info?.solicitacoes_pendentes > 0 && <li>{deps.info.solicitacoes_pendentes} requisição(ões) pendente(s)</li>}
                  {deps?.info?.emprestimos_pendentes > 0 && <li>{deps.info.emprestimos_pendentes} empréstimo(s) pendente(s)</li>}
                  {deps?.info?.emprestimos_total > 0 && <li>{deps.info.emprestimos_total} empréstimo(s) no histórico</li>}
                  {deps?.info?.movimentacoes > 0 && <li>{deps.info.movimentacoes} movimentação(ões) — serão apagadas</li>}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmForce}
              disabled={forcing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {forcing ? "Excluindo…" : "Excluir tudo mesmo assim"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
