import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { formatDateTime } from "@/lib/format";
import type { Sala } from "@/lib/types";

type Mov = {
  id: string; created_at: string; tipo: string; quantidade: number; saldo_apos: number;
  observacao: string | null;
  produto: { nome: string; unidade: string };
  sala: { nome: string };
  usuario: { nome: string } | null;
};

const TIPO_LABEL: Record<string, { label: string; cls: string }> = {
  solicitacao: { label: "Solicitação", cls: "bg-warning/15 text-warning border-warning/30" },
  estorno: { label: "Estorno", cls: "bg-secondary text-secondary-foreground" },
  ajuste: { label: "Ajuste", cls: "bg-accent/15 text-accent border-accent/30" },
  emprestimo_saida: { label: "Empréstimo (saída)", cls: "bg-destructive/15 text-destructive border-destructive/30" },
  emprestimo_entrada: { label: "Empréstimo (entrada)", cls: "bg-success/15 text-success border-success/30" },
  entrada: { label: "Entrada", cls: "bg-success/15 text-success border-success/30" },
  saida: { label: "Saída", cls: "bg-destructive/15 text-destructive border-destructive/30" },
};

export default function MovimentacoesPage() {
  const { role, profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const [rows, setRows] = useState<Mov[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [salaFilter, setSalaFilter] = useState("all");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data }, { data: ss }] = await Promise.all([
        supabase
          .from("movimentacoes")
          .select(`id, created_at, tipo, quantidade, saldo_apos, observacao,
                   produto:produtos(nome, unidade), sala:salas(nome),
                   usuario:profiles!movimentacoes_usuario_id_fkey(nome)`)
          .order("created_at", { ascending: false })
          .limit(500),
        supabase.from("salas").select("*").order("nome"),
      ]);
      setRows((data as any) ?? []);
      setSalas((ss as Sala[]) ?? []);
    })();
  }, []);

  // Sincroniza filtro com escopo do master / sala do user
  useEffect(() => {
    if (role === "master") {
      setSalaFilter(scopeSalaId ?? "all");
    } else if (profile?.sala_id) {
      setSalaFilter(profile.sala_id);
    }
  }, [role, profile, scopeSalaId]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => salaFilter === "all" || r.sala.nome === salas.find((s) => s.id === salaFilter)?.nome)
      .filter((r) => !busca || r.produto.nome.toLowerCase().includes(busca.toLowerCase()));
  }, [rows, salaFilter, salas, busca]);

  return (
    <div className="space-y-4">
      <PageHeader title="Movimentações" description="Log completo de toda alteração de estoque (rastreabilidade)." />
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1.5">
          <Label className="text-xs">Sala</Label>
          <Select value={salaFilter} onValueChange={setSalaFilter} disabled={role !== "master"}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {role === "master" && <SelectItem value="all">Todas as salas</SelectItem>}
              {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 flex-1 min-w-60">
          <Label className="text-xs">Buscar produto</Label>
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} />
        </div>
      </div>
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[170px]">Quando</TableHead>
              <TableHead className="w-[170px]">Tipo</TableHead>
              <TableHead>Produto</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right w-[100px]">Qtd.</TableHead>
              <TableHead className="text-right w-[100px]">Saldo</TableHead>
              <TableHead>Usuário</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => {
              const tipoCfg = TIPO_LABEL[m.tipo] ?? { label: m.tipo, cls: "" };
              return (
                <TableRow key={m.id} className="table-row-hover">
                  <TableCell className="text-muted-foreground">{formatDateTime(m.created_at)}</TableCell>
                  <TableCell><Badge variant="outline" className={tipoCfg.cls}>{tipoCfg.label}</Badge></TableCell>
                  <TableCell>{m.produto.nome}</TableCell>
                  <TableCell>{m.sala.nome}</TableCell>
                  <TableCell className={`text-right font-mono ${m.quantidade < 0 ? "text-destructive" : "text-success"}`}>{m.quantidade > 0 ? "+" : ""}{m.quantidade}</TableCell>
                  <TableCell className="text-right font-mono">{m.saldo_apos}</TableCell>
                  <TableCell>{m.usuario?.nome ?? "—"}</TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-12">Nenhuma movimentação.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
