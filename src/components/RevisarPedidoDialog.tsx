import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, ArrowRight, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";

type Item = { quantidade: number; produto: { nome: string; unidade: string; categoria: { nome: string } | null } };

type RequisicaoFull = {
  kind: "requisicao";
  id: string;
  observacao: string | null;
  created_at: string;
  sala: { nome: string };
  usuario: { nome: string; email: string } | null;
  itens: Item[];
};
type EmprestimoFull = {
  kind: "emprestimo";
  id: string;
  observacao: string | null;
  created_at: string;
  origem: { nome: string };
  destino: { nome: string };
  solicitante: { nome: string; email: string } | null;
  itens: Item[];
};

type Pedido = RequisicaoFull | EmprestimoFull;

export default function RevisarPedidoDialog({
  open, onOpenChange, kind, id, canDecide, onDecidir,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  kind: "requisicao" | "emprestimo";
  id: string | null;
  canDecide: boolean;
  onDecidir: (id: string, aprovar: boolean) => Promise<void> | void;
}) {
  const [data, setData] = useState<Pedido | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<"aprovar" | "rejeitar" | null>(null);

  useEffect(() => {
    if (!open || !id) { setData(null); return; }
    setLoading(true);
    (async () => {
      if (kind === "requisicao") {
        const { data: r } = await supabase
          .from("solicitacoes")
          .select(`id, observacao, created_at,
                   sala:salas(nome),
                   usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
                   itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
          .eq("id", id).maybeSingle();
        setData(r ? ({ kind: "requisicao", ...(r as any) }) : null);
      } else {
        const { data: e } = await supabase
          .from("emprestimos")
          .select(`id, observacao, created_at,
                   origem:salas!emprestimos_sala_origem_id_fkey(nome),
                   destino:salas!emprestimos_sala_destino_id_fkey(nome),
                   solicitante:profiles!emprestimos_solicitante_id_fkey(nome, email),
                   itens:emprestimo_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
          .eq("id", id).maybeSingle();
        setData(e ? ({ kind: "emprestimo", ...(e as any) }) : null);
      }
      setLoading(false);
    })();
  }, [open, id, kind]);

  const handle = async (aprovar: boolean) => {
    if (!id) return;
    setActing(aprovar ? "aprovar" : "rejeitar");
    try { await onDecidir(id, aprovar); onOpenChange(false); }
    finally { setActing(null); }
  };

  // Agrupar por categoria
  const grupos = (() => {
    if (!data) return [] as [string, Item[]][];
    const m = new Map<string, Item[]>();
    for (const it of data.itens) {
      const k = it.produto.categoria?.nome ?? "Sem categoria";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisar {kind === "requisicao" ? "requisição" : "empréstimo"} antes de decidir</DialogTitle>
          <DialogDescription>Confira todos os itens, quantidades e categorias antes de aprovar ou rejeitar.</DialogDescription>
        </DialogHeader>

        {loading || !data ? (
          <div className="py-12 grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              {data.kind === "requisicao" ? (
                <>
                  <Field label="Sala">{data.sala.nome}</Field>
                  <Field label="Solicitante">{data.usuario?.nome ?? "—"}<div className="text-xs text-muted-foreground">{data.usuario?.email}</div></Field>
                </>
              ) : (
                <>
                  <Field label="Trajeto">
                    <span className="inline-flex items-center gap-1 font-medium">
                      {data.origem.nome} <ArrowRight className="size-3.5" /> {data.destino.nome}
                    </span>
                  </Field>
                  <Field label="Solicitante">{data.solicitante?.nome ?? "—"}<div className="text-xs text-muted-foreground">{data.solicitante?.email}</div></Field>
                </>
              )}
              <Field label="Criado em">{formatDateTime(data.created_at)}</Field>
              <Field label="Total de itens">{data.itens.length}</Field>
            </div>

            {data.observacao && (
              <div className="rounded border border-border bg-muted/30 p-3 text-sm">
                <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Observação</div>
                <div className="italic">"{data.observacao}"</div>
              </div>
            )}

            <div className="space-y-3">
              {grupos.map(([cat, itens]) => (
                <div key={cat} className="rounded-md border border-border overflow-hidden">
                  <div className="bg-muted px-3 py-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Tag className="size-3.5" /> {cat}
                    </div>
                    <Badge variant="secondary">{itens.length} item(ns)</Badge>
                  </div>
                  <ul className="divide-y divide-border">
                    {itens.map((it, i) => (
                      <li key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                        <span className="font-medium">{it.produto.nome}</span>
                        <span className="font-mono text-foreground">{it.quantidade} {it.produto.unidade}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={!!acting}>Fechar</Button>
          {canDecide && data && (
            <>
              <Button variant="outline" onClick={() => handle(false)} disabled={!!acting}>
                {acting === "rejeitar" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />} Rejeitar
              </Button>
              <Button onClick={() => handle(true)} disabled={!!acting}>
                {acting === "aprovar" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Aprovar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}
