import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Pencil, Package, FolderTree, Tag } from "lucide-react";

type Item = {
  produto_id: string;
  nome: string;
  unidade: string;
  quantidade: number;
  categoria_nome: string | null;
};

export default function ConfirmarRequisicaoDialog({
  open, onOpenChange, salaNome, itens, observacao, enviando, onConfirmar,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  salaNome: string;
  itens: Item[];
  observacao: string;
  enviando: boolean;
  onConfirmar: () => void;
}) {
  const grupos = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const it of itens) {
      const k = it.categoria_nome ?? "Sem categoria";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [itens]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Confirmar requisição</DialogTitle>
          <DialogDescription>Revise os produtos e quantidades antes de enviar ao Master.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Sala:</span>
            <span className="font-medium">{salaNome}</span>
            <Badge variant="secondary" className="gap-1 ml-auto"><Package className="size-3" /> {itens.length} produto(s)</Badge>
            <Badge variant="secondary" className="gap-1"><FolderTree className="size-3" /> {grupos.length} categoria(s)</Badge>
          </div>

          <div className="space-y-2">
            {grupos.map(([cat, list]) => (
              <div key={cat} className="rounded-md border border-border overflow-hidden">
                <div className="bg-muted px-3 py-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide">
                  <Tag className="size-3 text-primary" /> {cat}
                  <Badge variant="outline" className="h-4 text-[10px] px-1.5">{list.length}</Badge>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {list.map((it) => (
                      <tr key={it.produto_id} className="border-b border-border/30 last:border-b-0">
                        <td className="px-3 py-1.5">{it.nome}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold w-28">
                          {it.quantidade} <span className="text-muted-foreground text-xs">{it.unidade}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          {observacao && (
            <div className="rounded border border-border bg-muted/30 p-3 text-sm">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Observação</div>
              <div className="italic">"{observacao}"</div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enviando}>
            <Pencil className="size-4" /> Editar
          </Button>
          <Button onClick={onConfirmar} disabled={enviando || itens.length === 0}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {enviando ? "Enviando..." : "Enviar requisição"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
