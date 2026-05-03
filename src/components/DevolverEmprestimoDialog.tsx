import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Undo2 } from "lucide-react";

type Item = {
  id: string;
  produto_id: string;
  quantidade: number;
  quantidade_devolvida: number;
  produto: { nome: string; unidade: string };
};

type Emp = {
  id: string;
  origem: { nome: string };
  destino: { nome: string };
};

export default function DevolverEmprestimoDialog({
  open, onOpenChange, emprestimoId, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  emprestimoId: string | null;
  onDone?: () => void;
}) {
  const [emp, setEmp] = useState<Emp | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [qtds, setQtds] = useState<Record<string, number>>({});
  const [obs, setObs] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!open || !emprestimoId) return;
    setObs("");
    setQtds({});
    setLoading(true);
    (async () => {
      const { data: e } = await supabase
        .from("emprestimos")
        .select("id, origem:salas!emprestimos_sala_origem_id_fkey(nome), destino:salas!emprestimos_sala_destino_id_fkey(nome)")
        .eq("id", emprestimoId).maybeSingle();
      const { data: its } = await supabase
        .from("emprestimo_itens")
        .select("id, produto_id, quantidade, quantidade_devolvida, produto:produtos(nome, unidade)")
        .eq("emprestimo_id", emprestimoId);
      setEmp(e as any);
      setItens((its as any) ?? []);
      setLoading(false);
    })();
  }, [open, emprestimoId]);

  const enviar = async () => {
    const payload = itens
      .map((it) => ({
        emprestimo_item_id: it.id,
        quantidade: Math.max(0, Math.min(qtds[it.id] ?? 0, it.quantidade - it.quantidade_devolvida)),
      }))
      .filter((x) => x.quantidade > 0);
    if (payload.length === 0) return toast.error("Informe ao menos uma quantidade a devolver");

    setEnviando(true);
    const { error } = await supabase.rpc("registrar_devolucao", {
      _emp: emprestimoId,
      _itens: payload,
      _observacao: obs || null,
    });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Devolução registrada. Estoque e dívida atualizados.");
    onOpenChange(false);
    onDone?.();
  };

  const totalPendente = itens.reduce((s, i) => s + (i.quantidade - i.quantidade_devolvida), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar devolução</DialogTitle>
          <DialogDescription>
            {emp ? <>Devolvendo de <strong>{emp.destino.nome}</strong> para <strong>{emp.origem.nome}</strong>. A dívida será baixada automaticamente.</> : "Carregando..."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="size-5 animate-spin" /></div>
        ) : totalPendente <= 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Este empréstimo já foi 100% devolvido.</div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Emprestado</TableHead>
                  <TableHead className="text-right">Já devolvido</TableHead>
                  <TableHead className="text-right">Pendente</TableHead>
                  <TableHead className="w-[140px]">Devolver agora</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens.map((it) => {
                  const pend = it.quantidade - it.quantidade_devolvida;
                  return (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">{it.produto.nome} <span className="text-muted-foreground text-xs">({it.produto.unidade})</span></TableCell>
                      <TableCell className="text-right font-mono">{it.quantidade}</TableCell>
                      <TableCell className="text-right font-mono">{it.quantidade_devolvida}</TableCell>
                      <TableCell className="text-right font-mono">{pend}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            type="number" min={0} max={pend} value={qtds[it.id] ?? ""}
                            onChange={(e) => setQtds({ ...qtds, [it.id]: Number(e.target.value) })}
                            disabled={pend === 0}
                          />
                          <Button size="sm" variant="ghost" type="button" onClick={() => setQtds({ ...qtds, [it.id]: pend })} disabled={pend === 0}>Tudo</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="space-y-2">
              <Label>Observação (opcional)</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: devolução parcial, item danificado, etc." />
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={enviar} disabled={enviando || totalPendente <= 0}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            Confirmar devolução
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
