import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CalendarClock, CalendarDays, CalendarRange, Search, Loader2 } from "lucide-react";

type Faixa = "vencido" | "semana" | "mes" | "trimestre" | "ok" | "sem_validade";
type Lote = {
  lote_id: string;
  produto_id: string;
  produto_nome: string;
  categoria_nome: string | null;
  sala_id: string;
  sala_nome: string;
  regiao_nome: string | null;
  quantidade: number;
  validade: string | null;
  dias_para_vencer: number | null;
  faixa: Faixa;
};
type ResumoRow = { faixa: Faixa; lotes: number; quantidade: number };
type Filtro = "todos" | "vencido" | "semana" | "mes" | "trimestre";

const FAIXA_LABEL: Record<Faixa, string> = {
  vencido: "Vencido",
  semana: "≤ 30 dias",
  mes: "≤ 50 dias",
  trimestre: "≤ 90 dias",
  ok: "OK",
  sem_validade: "Sem validade",
};

const FAIXA_CLASSES: Record<Faixa, string> = {
  vencido: "bg-destructive/15 text-destructive border-destructive/40",
  semana: "bg-orange-500/15 text-orange-600 border-orange-500/40 dark:text-orange-400",
  mes: "bg-yellow-500/15 text-yellow-700 border-yellow-500/40 dark:text-yellow-400",
  trimestre: "bg-blue-500/15 text-blue-600 border-blue-500/40 dark:text-blue-400",
  ok: "bg-muted text-muted-foreground border-border",
  sem_validade: "bg-muted text-muted-foreground border-border",
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export default function ValidadesPage() {
  const { scopeSalaId } = useMasterScope();
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [resumo, setResumo] = useState<Record<Faixa, ResumoRow>>({} as any);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: rows }, { data: sum }] = await Promise.all([
      supabase.rpc("lotes_por_validade", { _sala: scopeSalaId ?? null, _regiao: null, _dias: null }),
      supabase.rpc("resumo_validade", { _sala: scopeSalaId ?? null, _regiao: null }),
    ]);
    setLotes((rows ?? []) as Lote[]);
    const map = {} as Record<Faixa, ResumoRow>;
    for (const r of (sum ?? []) as ResumoRow[]) map[r.faixa] = r;
    setResumo(map);
    setLoading(false);
  }, [scopeSalaId]);

  useEffect(() => { load(); }, [load]);
  useRealtimeSync(["lotes", "estoque"], load, { debounceMs: 400 });

  const cards = [
    { faixa: "vencido" as Faixa, label: "Vencidos", icon: AlertTriangle, tone: "text-destructive" },
    { faixa: "semana" as Faixa, label: "Vence em 30 dias", icon: CalendarClock, tone: "text-orange-500" },
    { faixa: "mes" as Faixa, label: "Vence em 50 dias", icon: CalendarDays, tone: "text-yellow-500" },
    { faixa: "trimestre" as Faixa, label: "Vence em 90 dias", icon: CalendarRange, tone: "text-blue-500" },
  ];

  const filtrado = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lotes.filter((l) => {
      if (filtro !== "todos" && l.faixa !== filtro) return false;
      if (q && !l.produto_nome.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lotes, filtro, busca]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Validades"
        description="Acompanhe os lotes por data de vencimento. A baixa segue FEFO — o lote mais próximo do vencimento sai primeiro."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(({ faixa, label, icon: Icon, tone }) => {
          const r = resumo[faixa];
          return (
            <Card key={faixa} className="stat-card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">{label}</div>
                  <div className="font-display text-3xl font-bold mt-1">{nf.format(r?.lotes ?? 0)}</div>
                  <div className="text-xs text-muted-foreground mt-1">{nf.format(r?.quantidade ?? 0)} unidade(s)</div>
                </div>
                <div className={`size-10 rounded-md bg-muted grid place-items-center ${tone}`}>
                  <Icon className="size-5" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {(["todos", "vencido", "semana", "mes", "trimestre"] as Filtro[]).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filtro === f ? "default" : "outline"}
              onClick={() => setFiltro(f)}
            >
              {f === "todos" ? "Todos" : FAIXA_LABEL[f as Faixa]}
            </Button>
          ))}
          <div className="ml-auto relative w-full sm:w-72">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar produto..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>

        {loading ? (
          <div className="py-12 grid place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : filtrado.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Nenhum lote encontrado com os filtros atuais.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-3 py-2">Produto</th>
                  <th className="text-left px-3 py-2">Categoria</th>
                  <th className="text-left px-3 py-2">Sala</th>
                  <th className="text-right px-3 py-2">Quantidade</th>
                  <th className="text-left px-3 py-2">Validade</th>
                  <th className="text-right px-3 py-2">Dias p/ vencer</th>
                  <th className="text-left px-3 py-2">Faixa</th>
                </tr>
              </thead>
              <tbody>
                {filtrado.map((l) => (
                  <tr key={l.lote_id} className="border-b border-border/40 last:border-b-0">
                    <td className="px-3 py-2 font-medium">{l.produto_nome}</td>
                    <td className="px-3 py-2 text-muted-foreground">{l.categoria_nome ?? "—"}</td>
                    <td className="px-3 py-2">{l.sala_nome}</td>
                    <td className="px-3 py-2 text-right font-mono">{nf.format(l.quantidade)}</td>
                    <td className="px-3 py-2">{fmtDate(l.validade)}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {l.dias_para_vencer === null ? "—" : l.dias_para_vencer < 0 ? `${l.dias_para_vencer}` : l.dias_para_vencer}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant="outline" className={FAIXA_CLASSES[l.faixa]}>
                        {FAIXA_LABEL[l.faixa]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
