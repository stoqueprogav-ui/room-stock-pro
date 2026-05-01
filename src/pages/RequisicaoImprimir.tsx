import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type Req = {
  id: string;
  status: string;
  observacao: string | null;
  created_at: string;
  decidido_em: string | null;
  retirado_por: string | null;
  retirado_em: string | null;
  sala: { nome: string };
  usuario: { nome: string; email: string } | null;
  itens: { quantidade: number; produto: { nome: string; unidade: string; categoria: { nome: string } | null } }[];
};

export default function RequisicaoImprimir() {
  const { id } = useParams();
  const [req, setReq] = useState<Req | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("solicitacoes")
        .select(`id, status, observacao, created_at, decidido_em, retirado_por, retirado_em,
                 sala:salas(nome),
                 usuario:profiles!solicitacoes_usuario_id_fkey(nome, email),
                 itens:solicitacao_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
        .eq("id", id)
        .maybeSingle();
      setReq(data as any);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }
  if (!req) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Requisição não encontrada.</div>;
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div className="text-sm text-muted-foreground">Pré-visualização de impressão</div>
          <Button onClick={() => window.print()}><Printer className="size-4" /> Imprimir</Button>
        </div>

        <div className="border-b-2 border-black pb-4 mb-6">
          <div className="text-xs uppercase tracking-widest">Estoque Pro</div>
          <h1 className="text-3xl font-bold mt-1">Requisição de produtos</h1>
          <div className="text-sm mt-2">Nº <span className="font-mono">{req.id.slice(0, 8).toUpperCase()}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Sala</div>
            <div className="font-semibold text-base">{req.sala.nome}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Solicitante</div>
            <div className="font-semibold text-base">{req.usuario?.nome ?? "—"}</div>
            <div className="text-xs opacity-70">{req.usuario?.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Criada em</div>
            <div>{formatDateTime(req.created_at)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Aprovada em</div>
            <div>{req.decidido_em ? formatDateTime(req.decidido_em) : "—"}</div>
          </div>
          {req.retirado_por && (
            <div className="col-span-2 mt-2 p-3 border-2 border-black rounded">
              <div className="text-xs uppercase tracking-wide opacity-70">Retirada confirmada</div>
              <div className="font-semibold">Retirado por: {req.retirado_por}</div>
              {req.retirado_em && <div className="text-xs">Em: {formatDateTime(req.retirado_em)}</div>}
            </div>
          )}
        </div>

        {(() => {
          const groups = new Map<string, typeof req.itens>();
          for (const it of req.itens) {
            const key = it.produto.categoria?.nome ?? "Sem categoria";
            if (!groups.has(key)) groups.set(key, [] as any);
            groups.get(key)!.push(it);
          }
          const ordered = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
          return ordered.map(([cat, itens]) => (
            <div key={cat} className="mb-6">
              <div className="bg-black text-white px-3 py-1.5 text-xs uppercase tracking-widest font-bold">
                {cat} <span className="opacity-70 ml-1">({itens.length})</span>
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-black">
                    <th className="text-left py-1.5 text-xs uppercase tracking-wide">Produto</th>
                    <th className="text-right py-1.5 text-xs uppercase tracking-wide w-32">Quantidade</th>
                    <th className="text-left py-1.5 text-xs uppercase tracking-wide w-24 pl-4">Unidade</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((it, i) => (
                    <tr key={i} className="border-b border-gray-300">
                      <td className="py-2.5">{it.produto.nome}</td>
                      <td className="py-2.5 text-right font-mono">{it.quantidade}</td>
                      <td className="py-2.5 pl-4">{it.produto.unidade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ));
        })()}

        {req.observacao && (
          <div className="mb-6 text-sm">
            <div className="text-xs uppercase tracking-wide opacity-70">Observação</div>
            <div className="mt-1 italic">"{req.observacao}"</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-12 mt-16 text-center text-sm">
          <div>
            <div className="border-t border-black pt-2">Entregue por</div>
          </div>
          <div>
            <div className="border-t border-black pt-2">Recebido por</div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { margin: 1.5cm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
