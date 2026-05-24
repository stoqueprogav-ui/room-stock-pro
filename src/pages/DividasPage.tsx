import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Wallet, ArrowRight } from "lucide-react";


type Divida = {
  id: string;
  saldo: number;
  sala_devedora_id: string;
  sala_credora_id: string;
  devedora: { nome: string };
  credora: { nome: string };
  produto: { nome: string; unidade: string };
};

export default function DividasPage() {
  const { role, profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const [rows, setRows] = useState<Divida[]>([]);
  const [editing, setEditing] = useState<Divida | null>(null);
  const [qtd, setQtd] = useState(0);

  const load = useCallback(async () => {
    let q = supabase
      .from("dividas")
      .select(`id, saldo, sala_devedora_id, sala_credora_id,
               devedora:salas!dividas_sala_devedora_id_fkey(nome),
               credora:salas!dividas_sala_credora_id_fkey(nome),
               produto:produtos(nome, unidade)`)
      .order("saldo", { ascending: false });
    if (role === "master" && scopeSalaId) {
      q = q.or(`sala_devedora_id.eq.${scopeSalaId},sala_credora_id.eq.${scopeSalaId}`);
    }
    const { data } = await q;
    setRows((data as any) ?? []);
  }, [role, scopeSalaId]);
  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["dividas", "emprestimos", "movimentacoes"], load, { debounceMs: 300 });


  const quitar = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("quitar_divida", { _divida: editing.id, _quantidade: Number(qtd) });
    if (error) return toast.error(error.message);
    toast.success("Dívida atualizada"); setEditing(null); load();
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Dívidas entre salas" description="Saldo de produtos pendente de devolução, gerado por empréstimos aprovados." />
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Devedora → Credora</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right w-[120px]">Saldo</TableHead>
              {role === "master" && <TableHead className="text-right w-[120px]">Ação</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id} className="table-row-hover">
                <TableCell>
                  <div className="flex items-center gap-2 font-medium">
                    {d.devedora.nome} <ArrowRight className="size-3 text-muted-foreground" /> {d.credora.nome}
                  </div>
                </TableCell>
                <TableCell>{d.produto.nome}</TableCell>
                <TableCell className="text-right font-mono">
                  <span className="inline-flex items-center gap-1 rounded-md bg-destructive/15 text-destructive px-2 py-0.5">
                    {d.saldo} {d.produto.unidade}
                  </span>
                </TableCell>
                {role === "master" && (
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => { setEditing(d); setQtd(d.saldo); }}><Wallet className="size-4" /> Quitar</Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">Sem dívidas em aberto.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Quitar dívida</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">{editing.devedora.nome} deve <span className="font-mono">{editing.saldo}</span> {editing.produto.unidade} de <span className="font-medium text-foreground">{editing.produto.nome}</span> a {editing.credora.nome}.</div>
              <div className="space-y-2"><Label>Quantidade a quitar</Label><Input type="number" min={1} max={editing.saldo} value={qtd} onChange={(e) => setQtd(Number(e.target.value))} /></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={quitar}>Confirmar baixa</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
