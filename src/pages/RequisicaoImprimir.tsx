import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { useAuth } from "@/contexts/AuthContext";

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
  const { profile, role } = useAuth();
  const [req, setReq] = useState<Req | null>(null);
  const [loading, setLoading] = useState(true);
  const [entreguePor, setEntreguePor] = useState("");

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

  // Auto-preencher "Entregue por" com nome do Master logado
  useEffect(() => {
    if (!entreguePor && role === "master" && profile?.nome) setEntreguePor(profile.nome);
  }, [profile?.nome, role, entreguePor]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center"><Loader2 className="size-6 animate-spin text-black" /></div>;
  }
  if (!req) {
    return <div className="min-h-screen grid place-items-center text-black">Requisição não encontrada.</div>;
  }

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

        {/* Cabeçalho minimalista */}
        <div className="border-b border-black pb-3 mb-5">
          <div className="text-[10px] uppercase tracking-widest">Estoque Pro</div>
          <h1 className="text-2xl font-bold mt-1">Requisição de produtos</h1>
          <div className="text-xs mt-1">Nº <span className="font-mono">{req.id.slice(0, 8).toUpperCase()}</span></div>
        </div>

        {/* Resumo visual */}
        {(() => {
          const cats = new Set(req.itens.map((it) => it.produto.categoria?.nome ?? "Sem categoria"));
          return (
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-xs border border-black/30 rounded px-3 py-2">
              <span>📦 <strong>{req.itens.length}</strong> produto(s)</span>
              <span>📂 <strong>{cats.size}</strong> categoria(s)</span>
              <span>📋 Requisição <span className="font-mono">#{req.id.slice(0, 8).toUpperCase()}</span></span>
            </div>
          );
        })()}

        <div className="grid grid-cols-2 gap-3 mb-5 text-sm">
          <Field label="Sala">{req.sala.nome}</Field>
          <Field label="Solicitante">
            {req.usuario?.nome ?? "—"}
            <div className="text-[11px] text-black/60">{req.usuario?.email}</div>
          </Field>
          <Field label="Criada em">{formatDateTime(req.created_at)}</Field>
          {req.retirado_por && (
            <div className="col-span-2 mt-1 border border-black/40 rounded p-2 text-xs">
              <span className="font-semibold">Retirada:</span> {req.retirado_por}
              {req.retirado_em && <> · {formatDateTime(req.retirado_em)}</>}
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
          ));
        })()}

        {req.observacao && (
          <div className="mb-5 text-xs">
            <div className="text-[11px] uppercase tracking-wide opacity-70">Observação</div>
            <div className="mt-0.5">{req.observacao}</div>
          </div>
        )}

        {/* Assinaturas */}
        <div className="grid grid-cols-2 gap-12 mt-12 text-xs">
          <div>
            <div className="border-t border-black pt-1 text-center">
              {entreguePor ? <span className="font-medium">{entreguePor}</span> : <span>&nbsp;</span>}
              <div className="text-[10px] uppercase tracking-widest mt-0.5">Entregue por</div>
            </div>
          </div>
          <div>
            <div className="border-t border-black pt-1 text-center">
              <div>&nbsp;</div>
              <div className="text-[10px] uppercase tracking-widest mt-0.5">Recebido por</div>
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
