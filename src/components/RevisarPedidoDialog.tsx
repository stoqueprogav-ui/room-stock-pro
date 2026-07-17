import { useEffect, useMemo, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Check, X, ArrowRight, Tag, AlertTriangle, Recycle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";

type Item = { quantidade: number; produto: { id: string; nome: string; unidade: string; categoria: { nome: string } | null } };
type LoteAviso = { produto_nome: string; quantidade: number; dias_para_vencer: number | null; validade: string | null; sala_nome: string };
type TrocaSug = {
  lote_id: string;
  sala_id: string;
  sala_nome: string;
  validade: string | null;
  dias: number | null;
  quantidade: number;
  produto_id: string;
  produto_nome: string;
  qtd_pedida: number;
};

type RequisicaoFull = {
  kind: "requisicao";
  id: string;
  observacao: string | null;
  created_at: string;
  sala: { id: string; nome: string };
  usuario: { nome: string; email: string } | null;
  itens: Item[];
};
type EmprestimoFull = {
  kind: "emprestimo";
  id: string;
  observacao: string | null;
  created_at: string;
  origem: { id: string; nome: string };
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
  const [avisos, setAvisos] = useState<LoteAviso[]>([]);

  useEffect(() => {
    if (!open || !id) { setData(null); setAvisos([]); return; }
    setLoading(true);
    (async () => {
      if (kind === "requisicao") {
        const { data: r } = await supabase
          .from("solicitacoes")
          .select(`id, observacao, created_at,
                   sala:salas(id, nome),
                   usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
                   itens:solicitacao_itens(quantidade, produto:produtos(id, nome, unidade, categoria:categorias(nome)))`)
          .eq("id", id).maybeSingle();
        setData(r ? ({ kind: "requisicao", ...(r as any) }) : null);
      } else {
        const { data: e } = await supabase
          .from("emprestimos")
          .select(`id, observacao, created_at,
                   origem:salas!emprestimos_sala_origem_id_fkey(id, nome),
                   destino:salas!emprestimos_sala_destino_id_fkey(nome),
                   solicitante:profiles!emprestimos_solicitante_id_fkey(nome, email),
                   itens:emprestimo_itens(quantidade, produto:produtos(id, nome, unidade, categoria:categorias(nome)))`)
          .eq("id", id).maybeSingle();
        setData(e ? ({ kind: "emprestimo", ...(e as any) }) : null);
      }
      setLoading(false);
    })();
  }, [open, id, kind]);

  // Aviso de validade: lotes na sala de atendimento vencendo em <= 30 dias
  useEffect(() => {
    if (!data) { setAvisos([]); return; }
    const salaId = data.kind === "requisicao" ? data.sala.id : data.origem.id;
    const produtoIds = new Set(data.itens.map((i) => i.produto.id));
    if (!salaId || produtoIds.size === 0) { setAvisos([]); return; }
    (async () => {
      const { data: rows } = await supabase.rpc("lotes_por_validade", { _sala: salaId, _regiao: null, _dias: 30 });
      const filt = (rows ?? []).filter((r: any) => produtoIds.has(r.produto_id));
      setAvisos(filt.slice(0, 3).map((r: any) => ({
        produto_nome: r.produto_nome,
        quantidade: r.quantidade,
        dias_para_vencer: r.dias_para_vencer,
        validade: r.validade,
        sala_nome: r.sala_nome,
      })));
    })();
  }, [data]);

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

            {avisos.length > 0 && (
              <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                <div className="flex items-center gap-2 font-semibold text-yellow-700 dark:text-yellow-400 mb-1">
                  <AlertTriangle className="size-4" /> Atenção: há lote(s) vencendo
                </div>
                <ul className="space-y-0.5 text-yellow-900/90 dark:text-yellow-200/90">
                  {avisos.map((a, i) => {
                    const d = a.dias_para_vencer;
                    const txt = d === null ? "sem data" : d < 0 ? `vencido há ${Math.abs(d)} dia(s)` : d === 0 ? "vence hoje" : `vence em ${d} dia(s)`;
                    return (
                      <li key={i}>
                        <span className="font-medium">{a.produto_nome}</span>: {a.quantidade} un. {txt} na sala {a.sala_nome}.
                      </li>
                    );
                  })}
                </ul>
                <div className="text-xs mt-1 text-yellow-800/80 dark:text-yellow-300/80">A baixa segue FEFO — priorize a saída desses lotes fisicamente.</div>
              </div>
            )}


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
