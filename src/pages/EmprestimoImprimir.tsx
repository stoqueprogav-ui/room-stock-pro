import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Printer, Loader2, ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/format";

type Emp = {
  id: string;
  status: string;
  observacao: string | null;
  created_at: string;
  decidido_em: string | null;
  retirado_por: string | null;
  retirado_em: string | null;
  origem: { nome: string };
  destino: { nome: string };
  solicitante: { nome: string; email: string } | null;
  aprovador: { nome: string; email: string } | null;
  itens: { quantidade: number; produto: { nome: string; unidade: string } }[];
};

export default function EmprestimoImprimir() {
  const { id } = useParams();
  const [emp, setEmp] = useState<Emp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await supabase
        .from("emprestimos")
        .select(`id, status, observacao, created_at, decidido_em, retirado_por, retirado_em,
                 origem:salas!emprestimos_sala_origem_id_fkey(nome),
                 destino:salas!emprestimos_sala_destino_id_fkey(nome),
                 solicitante:profiles!emprestimos_solicitante_id_fkey(nome, email),
                 aprovador:profiles!emprestimos_decidido_por_fkey(nome, email),
                 itens:emprestimo_itens(quantidade, produto:produtos(nome, unidade))`)
        .eq("id", id)
        .maybeSingle();
      setEmp(data as any);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }
  if (!emp) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Empréstimo não encontrado.</div>;
  }
  if (emp.status !== "aprovado" && emp.status !== "arquivado") {
    return (
      <div className="min-h-screen grid place-items-center p-8 text-center">
        <div>
          <p className="text-muted-foreground">O documento só pode ser gerado após a aprovação do empréstimo.</p>
          <p className="text-xs mt-2 text-muted-foreground">Status atual: {emp.status}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex items-center justify-between mb-6 print:hidden">
          <div className="text-sm text-muted-foreground">Pré-visualização de impressão</div>
          <Button onClick={() => window.print()}><Printer className="size-4" /> Imprimir / Salvar PDF</Button>
        </div>

        <div className="border-b-2 border-black pb-4 mb-6">
          <div className="text-xs uppercase tracking-widest">Estoque Pro</div>
          <h1 className="text-3xl font-bold mt-1">Empréstimo entre salas</h1>
          <div className="text-sm mt-2">Nº <span className="font-mono">{emp.id.slice(0, 8).toUpperCase()}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div className="col-span-2">
            <div className="text-xs uppercase tracking-wide opacity-70">Trajeto</div>
            <div className="font-semibold text-base flex items-center gap-2">
              {emp.origem.nome} <ArrowRight className="size-4" /> {emp.destino.nome}
            </div>
            <div className="text-xs opacity-70 mt-1">Sala que emprestou → Sala que recebeu</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Solicitante (sala destino)</div>
            <div className="font-semibold">{emp.solicitante?.nome ?? "—"}</div>
            <div className="text-xs opacity-70">{emp.solicitante?.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Aprovado por (sala origem)</div>
            <div className="font-semibold">{emp.aprovador?.nome ?? "—"}</div>
            <div className="text-xs opacity-70">{emp.aprovador?.email}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Solicitado em</div>
            <div>{formatDateTime(emp.created_at)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide opacity-70">Aprovado em</div>
            <div>{emp.decidido_em ? formatDateTime(emp.decidido_em) : "—"}</div>
          </div>
        </div>

        <table className="w-full border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-black">
              <th className="text-left py-2 text-sm uppercase tracking-wide">Produto</th>
              <th className="text-right py-2 text-sm uppercase tracking-wide w-32">Quantidade</th>
              <th className="text-left py-2 text-sm uppercase tracking-wide w-24 pl-4">Unidade</th>
            </tr>
          </thead>
          <tbody>
            {emp.itens.map((it, i) => (
              <tr key={i} className="border-b border-gray-300">
                <td className="py-3">{it.produto.nome}</td>
                <td className="py-3 text-right font-mono">{it.quantidade}</td>
                <td className="py-3 pl-4">{it.produto.unidade}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {emp.observacao && (
          <div className="mb-6 text-sm">
            <div className="text-xs uppercase tracking-wide opacity-70">Observação</div>
            <div className="mt-1 italic">"{emp.observacao}"</div>
          </div>
        )}

        <div className="mb-8 text-sm">
          <span className="inline-block px-3 py-1 border-2 border-black font-semibold uppercase tracking-wide text-xs">
            Status: {emp.status}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-12 mt-16 text-center text-sm">
          <div>
            <div className="border-t border-black pt-2">Entregue por (sala origem)</div>
          </div>
          <div>
            <div className="border-t border-black pt-2">Recebido por (sala destino)</div>
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
