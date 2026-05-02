import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, Loader2, ArrowRight } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";

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
  itens: { quantidade: number; produto: { nome: string; unidade: string; categoria: { nome: string } | null } }[];
};

export default function EmprestimoImprimir() {
  const { id } = useParams();
  const { profile, role } = useAuth();
  const [emp, setEmp] = useState<Emp | null>(null);
  const [loading, setLoading] = useState(true);
  const [entreguePor, setEntreguePor] = useState("");

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
                 itens:emprestimo_itens(quantidade, produto:produtos(nome, unidade, categoria:categorias(nome)))`)
        .eq("id", id)
        .maybeSingle();
      setEmp(data as any);
      setLoading(false);
    })();
  }, [id]);

  useEffect(() => {
    if (!entreguePor && profile?.nome) {
      // Master ou admin (origem) — usar nome real do logado
      setEntreguePor(profile.nome);
    }
  }, [profile?.nome, role, entreguePor]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-black" /></div>;
  }
  if (!emp) {
    return <div className="min-h-screen grid place-items-center text-black">Empréstimo não encontrado.</div>;
  }
  if (emp.status !== "aprovado" && emp.status !== "arquivado") {
    return (
      <div className="min-h-screen grid place-items-center p-8 text-center text-black">
        <div>
          <p>O documento só pode ser gerado após a aprovação do empréstimo.</p>
          <p className="text-xs mt-2 opacity-70">Status atual: {emp.status}</p>
        </div>
      </div>
    );
  }

  const groupedItens = (() => {
    const m = new Map<string, typeof emp.itens>();
    for (const it of emp.itens) {
      const k = it.produto.categoria?.nome ?? "Sem categoria";
      if (!m.has(k)) m.set(k, [] as any);
      m.get(k)!.push(it);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  })();

  return (
    <div className="min-h-screen bg-white text-black print-doc">
      <div className="max-w-3xl mx-auto p-8 print:p-0">
        <div className="flex items-center justify-between mb-6 print:hidden gap-3">
          <div className="text-sm text-black/70">Pré-visualização de impressão</div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-black/70">Entregue por:</label>
            <Input
              value={entreguePor}
              onChange={(e) => setEntreguePor(e.target.value)}
              className="h-9 w-56 bg-white border-black text-black"
            />
            <Button onClick={() => window.print()} className="bg-black text-white hover:bg-black/90">
              <Printer className="size-4" /> Imprimir
            </Button>
          </div>
        </div>

        <div className="border-b border-black pb-3 mb-5">
          <div className="text-[10px] uppercase tracking-widest">Estoque Pro</div>
          <h1 className="text-2xl font-bold mt-1">Empréstimo entre salas</h1>
          <div className="text-xs mt-1">Nº <span className="font-mono">{emp.id.slice(0, 8).toUpperCase()}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          <div className="col-span-2">
            <div className="text-[11px] uppercase tracking-wide opacity-70">Trajeto</div>
            <div className="font-semibold flex items-center gap-2">
              {emp.origem.nome} <ArrowRight className="size-3.5" /> {emp.destino.nome}
            </div>
          </div>
          <Field label="Solicitante (sala destino)">
            {emp.solicitante?.nome ?? "—"}
            <div className="text-[11px] opacity-60">{emp.solicitante?.email}</div>
          </Field>
          <Field label="Aprovado por (sala origem)">
            {emp.aprovador?.nome ?? "—"}
            <div className="text-[11px] opacity-60">{emp.aprovador?.email}</div>
          </Field>
          <Field label="Solicitado em">{formatDateTime(emp.created_at)}</Field>
          <Field label="Aprovado em">{emp.decidido_em ? formatDateTime(emp.decidido_em) : "—"}</Field>
          {emp.retirado_por && (
            <div className="col-span-2 mt-1 border border-black/40 rounded p-2 text-xs">
              <span className="font-semibold">Retirada:</span> {emp.retirado_por}
              {emp.retirado_em && <> · {formatDateTime(emp.retirado_em)}</>}
            </div>
          )}
        </div>

        {groupedItens.map(([cat, itens]) => (
          <div key={cat} className="mb-4">
            <div className="text-[11px] uppercase tracking-widest font-bold border-b border-black pb-0.5 mb-1">
              {cat} <span className="font-normal opacity-70">({itens.length})</span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-black/40">
                  <th className="text-left py-1 text-[11px] uppercase tracking-wide font-medium">Produto</th>
                  <th className="text-right py-1 text-[11px] uppercase tracking-wide font-medium w-28">Qtd</th>
                  <th className="text-left py-1 text-[11px] uppercase tracking-wide font-medium w-20 pl-3">Un.</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((it, i) => (
                  <tr key={i} className="border-b border-black/20">
                    <td className="py-1.5">{it.produto.nome}</td>
                    <td className="py-1.5 text-right font-mono">{it.quantidade}</td>
                    <td className="py-1.5 pl-3">{it.produto.unidade}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        {emp.observacao && (
          <div className="mb-5 text-xs">
            <div className="text-[11px] uppercase tracking-wide opacity-70">Observação</div>
            <div className="mt-0.5">{emp.observacao}</div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-12 mt-12 text-xs">
          <div>
            <div className="border-t border-black pt-1 text-center">
              {entreguePor ? <span className="font-medium">{entreguePor}</span> : <span>&nbsp;</span>}
              <div className="text-[10px] uppercase tracking-widest mt-0.5">Entregue por (sala origem)</div>
            </div>
          </div>
          <div>
            <div className="border-t border-black pt-1 text-center">
              <div>&nbsp;</div>
              <div className="text-[10px] uppercase tracking-widest mt-0.5">Recebido por (sala destino)</div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { margin: 1.2cm; }
          body { background: #fff !important; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
          .print-doc { background: #fff !important; color: #000 !important; }
          .print-doc * { color: #000 !important; background: transparent !important; box-shadow: none !important; }
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="font-medium">{children}</div>
    </div>
  );
}
