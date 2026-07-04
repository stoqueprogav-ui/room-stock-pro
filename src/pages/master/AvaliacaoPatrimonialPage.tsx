import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  ShieldCheck, Scale as ScaleIcon, PackageSearch, Loader2, Save, Trash2, ClipboardList, BadgeCheck, BadgeAlert,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import { toast } from "sonner";

const BRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(n) ? n : 0);
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR") : "—";

type Totais = {
  valor_confirmado: number;
  valor_estimado: number;
  valor_patrimonial: number;
  valor_compras: number;
  valor_total_estoque: number;
  quantidade_avaliada: number;
  quantidade_estoque: number;
  produtos_confirmados: number;
  produtos_estimados: number;
  produtos_sem_avaliacao: number;
  cobertura_pct: number;
};

type SemAvalRow = {
  produto_id: string; produto_nome: string;
  categoria_nome: string | null;
  sala_id: string; sala_nome: string;
  quantidade: number;
  custo_unitario_ref: number;
  valor_total_atual: number;
};

type AvalRow = {
  id: string;
  produto_id: string; produto_nome: string;
  categoria_nome: string | null;
  sala_id: string; sala_nome: string;
  quantidade_avaliada: number;
  quantidade_restante: number;
  valor_unitario: number;
  valor_total: number;
  tipo: "estimado" | "confirmado";
  responsavel_id: string | null;
  responsavel_nome: string | null;
  observacao: string | null;
  created_at: string;
  updated_at: string;
};

type LoteItemDraft = {
  valor?: string;
  tipo: "estimado" | "confirmado";
  selecionado: boolean;
};

export default function AvaliacaoPatrimonialPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { role } = useAuth();
  const { scopeSalaId } = useMasterScope();

  const [loading, setLoading] = useState(true);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [semAval, setSemAval] = useState<SemAvalRow[]>([]);
  const [historico, setHistorico] = useState<AvalRow[]>([]);
  const [busca, setBusca] = useState("");
  const [buscaHist, setBuscaHist] = useState("");

  // Lote
  const [drafts, setDrafts] = useState<Record<string, LoteItemDraft>>({});
  const [salvandoLote, setSalvandoLote] = useState(false);
  const [tipoPadrao, setTipoPadrao] = useState<"estimado" | "confirmado">("estimado");

  // Nova avaliação individual
  const [novoOpen, setNovoOpen] = useState(false);
  const [novoForm, setNovoForm] = useState<{ row?: SemAvalRow; qtd: string; valor: string; tipo: "estimado"|"confirmado"; obs: string }>({
    qtd: "", valor: "", tipo: "estimado", obs: "",
  });
  const [salvandoNovo, setSalvandoNovo] = useState(false);

  const isMaster = role === "master";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: tot }, { data: sem }, { data: hist }] = await Promise.all([
        (supabase as any).rpc("patrimonio_totais", { _sala: scopeSalaId ?? null }),
        (supabase as any).rpc("produtos_sem_avaliacao", { _sala: scopeSalaId ?? null }),
        (supabase as any).rpc("listar_avaliacoes_patrimoniais", { _sala: scopeSalaId ?? null }),
      ]);
      setTotais((tot?.[0] as Totais) ?? null);
      setSemAval((sem as SemAvalRow[]) ?? []);
      setHistorico((hist as AvalRow[]) ?? []);
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao carregar avaliação patrimonial");
    } finally {
      setLoading(false);
    }
  }, [scopeSalaId]);

  useEffect(() => { if (isMaster) load(); }, [isMaster, load]);

  const semAvalFiltered = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return semAval;
    return semAval.filter((r) =>
      [r.produto_nome, r.sala_nome, r.categoria_nome].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [semAval, busca]);

  const histFiltered = useMemo(() => {
    const q = buscaHist.trim().toLowerCase();
    if (!q) return historico;
    return historico.filter((r) =>
      [r.produto_nome, r.sala_nome, r.categoria_nome, r.responsavel_nome, r.tipo].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [historico, buscaHist]);

  const draftKey = (r: SemAvalRow) => `${r.sala_id}:${r.produto_id}`;

  const setDraft = (r: SemAvalRow, patch: Partial<LoteItemDraft>) => {
    setDrafts((d) => ({
      ...d,
      [draftKey(r)]: { valor: "", tipo: tipoPadrao, selecionado: false, ...(d[draftKey(r)] ?? {}), ...patch },
    }));
  };

  const marcarTodos = (checked: boolean) => {
    setDrafts((d) => {
      const next = { ...d };
      semAvalFiltered.forEach((r) => {
        const k = draftKey(r);
        next[k] = { valor: r.custo_unitario_ref > 0 ? String(r.custo_unitario_ref) : (next[k]?.valor ?? ""), tipo: next[k]?.tipo ?? tipoPadrao, selecionado: checked };
      });
      return next;
    });
  };

  const preencherCustoRef = () => {
    setDrafts((d) => {
      const next = { ...d };
      semAvalFiltered.forEach((r) => {
        if (r.custo_unitario_ref > 0) {
          const k = draftKey(r);
          next[k] = { valor: String(r.custo_unitario_ref), tipo: next[k]?.tipo ?? tipoPadrao, selecionado: true };
        }
      });
      return next;
    });
  };

  const totalSelecionado = useMemo(() => {
    let count = 0, valor = 0;
    semAvalFiltered.forEach((r) => {
      const d = drafts[draftKey(r)];
      if (d?.selecionado) {
        const v = parseFloat(String(d.valor ?? "").replace(",", "."));
        if (v > 0) { count += 1; valor += r.quantidade * v; }
      }
    });
    return { count, valor };
  }, [drafts, semAvalFiltered]);

  const salvarLote = async () => {
    const itens = semAvalFiltered
      .map((r) => ({ r, d: drafts[draftKey(r)] }))
      .filter(({ d }) => d?.selecionado)
      .map(({ r, d }) => ({
        produto_id: r.produto_id,
        sala_id: r.sala_id,
        quantidade: r.quantidade,
        valor_unitario: parseFloat(String(d!.valor ?? "").replace(",", ".")),
        tipo: d!.tipo ?? tipoPadrao,
        observacao: "Regularização em lote — implantação do módulo de custos",
      }))
      .filter((i) => Number.isFinite(i.valor_unitario) && i.valor_unitario >= 0 && i.quantidade > 0);

    if (itens.length === 0) {
      toast.error("Selecione ao menos um item com valor válido");
      return;
    }
    setSalvandoLote(true);
    try {
      const { data, error } = await (supabase as any).rpc("regularizar_avaliacoes_lote", { _itens: itens });
      if (error) throw error;
      toast.success(`${data ?? itens.length} avaliação(ões) registrada(s) com sucesso.`);
      setDrafts({});
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao registrar avaliações");
    } finally {
      setSalvandoLote(false);
    }
  };

  const abrirNovo = (r: SemAvalRow) => {
    setNovoForm({
      row: r,
      qtd: String(r.quantidade),
      valor: r.custo_unitario_ref > 0 ? String(r.custo_unitario_ref) : "",
      tipo: "estimado",
      obs: "",
    });
    setNovoOpen(true);
  };

  const salvarNovo = async () => {
    if (!novoForm.row) return;
    const qtd = parseInt(novoForm.qtd, 10);
    const valor = parseFloat(String(novoForm.valor).replace(",", "."));
    if (!Number.isFinite(qtd) || qtd <= 0) return toast.error("Quantidade inválida");
    if (!Number.isFinite(valor) || valor < 0) return toast.error("Valor inválido");
    setSalvandoNovo(true);
    try {
      const { error } = await (supabase as any).rpc("criar_avaliacao_patrimonial", {
        _produto: novoForm.row.produto_id,
        _sala: novoForm.row.sala_id,
        _quantidade: qtd,
        _valor_unitario: valor,
        _tipo: novoForm.tipo,
        _observacao: novoForm.obs || null,
      });
      if (error) throw error;
      toast.success("Avaliação patrimonial registrada.");
      setNovoOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar avaliação");
    } finally {
      setSalvandoNovo(false);
    }
  };

  const excluirAval = async (id: string) => {
    if (!confirm("Excluir esta avaliação patrimonial? Esta ação é registrada em auditoria.")) return;
    try {
      const { error } = await (supabase as any).rpc("excluir_avaliacao_patrimonial", { _id: id });
      if (error) throw error;
      toast.success("Avaliação excluída.");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao excluir avaliação");
    }
  };

  if (!isMaster) {
    return (
      <div className="p-6">
        <PageHeader title="Avaliação Patrimonial" description="Acesso restrito ao Master." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!embedded && (
        <PageHeader
          title="Avaliação Patrimonial"
          description="Atribua valor financeiro ao estoque existente sem alterar compras, custo médio ou movimentações."
        />
      )}


      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <BadgeCheck className="size-4 text-primary" /> Valor confirmado
          </div>
          <div className="mt-2 text-xl font-semibold">{BRL(totais?.valor_confirmado ?? 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <BadgeAlert className="size-4 text-warning" /> Valor estimado
          </div>
          <div className="mt-2 text-xl font-semibold">{BRL(totais?.valor_estimado ?? 0)}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ScaleIcon className="size-4 text-primary" /> Valor total do estoque
          </div>
          <div className="mt-2 text-xl font-semibold">{BRL(totais?.valor_total_estoque ?? 0)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Estimado {BRL(totais?.valor_patrimonial ?? 0)} + Confirmado {BRL(totais?.valor_compras ?? 0)}
          </div>

        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <ShieldCheck className="size-4 text-primary" /> Cobertura patrimonial
          </div>
          <div className="mt-2 text-xl font-semibold">{(totais?.cobertura_pct ?? 0).toFixed(1)}%</div>
          <Progress value={totais?.cobertura_pct ?? 0} className="mt-2 h-1.5" />
          <div className="text-[11px] text-muted-foreground mt-1">
            {totais?.produtos_confirmados ?? 0} conf. · {totais?.produtos_estimados ?? 0} est. · {totais?.produtos_sem_avaliacao ?? 0} sem aval.
          </div>
        </Card>
      </div>

      <Tabs defaultValue="regularizar">
        <TabsList>
          <TabsTrigger value="regularizar">
            <PackageSearch className="size-4 mr-1.5" /> Regularizar em lote
            {semAval.length > 0 && (
              <Badge variant="secondary" className="ml-2">{semAval.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico">
            <ClipboardList className="size-4 mr-1.5" /> Histórico de avaliações
          </TabsTrigger>
        </TabsList>

        {/* ================= REGULARIZAR EM LOTE ================= */}
        <TabsContent value="regularizar" className="mt-4">
          <Card className="p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  placeholder="Buscar produto ou sala…"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  className="w-64"
                />
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground">Tipo padrão</Label>
                  <Select value={tipoPadrao} onValueChange={(v: any) => setTipoPadrao(v)}>
                    <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="estimado">Estimado</SelectItem>
                      <SelectItem value="confirmado">Confirmado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" variant="outline" onClick={() => marcarTodos(true)}>Marcar todos</Button>
                <Button size="sm" variant="ghost" onClick={() => marcarTodos(false)}>Limpar</Button>
                <Button size="sm" variant="secondary" onClick={preencherCustoRef}>
                  Sugerir custo de referência
                </Button>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-sm text-muted-foreground">
                  {totalSelecionado.count} selecionado(s) · {BRL(totalSelecionado.valor)}
                </div>
                <Button onClick={salvarLote} disabled={salvandoLote || totalSelecionado.count === 0}>
                  {salvandoLote ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Save className="size-4 mr-1.5" />}
                  Regularizar selecionados
                </Button>
              </div>
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[36px]"></TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Sala</TableHead>
                    <TableHead className="text-right w-[90px]">Qtd atual</TableHead>
                    <TableHead className="text-right w-[130px]">Custo ref.</TableHead>
                    <TableHead className="w-[160px]">Valor unitário</TableHead>
                    <TableHead className="w-[140px]">Tipo</TableHead>
                    <TableHead className="text-right w-[130px]">Valor total</TableHead>
                    <TableHead className="w-[110px]">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8"><Loader2 className="size-5 animate-spin inline" /></TableCell></TableRow>
                  ) : semAvalFiltered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      Nenhum produto pendente de avaliação. Todo o estoque possui valor patrimonial.
                    </TableCell></TableRow>
                  ) : semAvalFiltered.map((r) => {
                    const d = drafts[draftKey(r)] ?? { valor: "", tipo: tipoPadrao, selecionado: false };
                    const v = parseFloat(String(d.valor ?? "").replace(",", "."));
                    const total = Number.isFinite(v) ? r.quantidade * v : 0;
                    return (
                      <TableRow key={draftKey(r)}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={!!d.selecionado}
                            onChange={(e) => setDraft(r, { selecionado: e.target.checked })}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{r.produto_nome}</TableCell>
                        <TableCell className="text-muted-foreground">{r.categoria_nome ?? "—"}</TableCell>
                        <TableCell>{r.sala_nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.quantidade}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {r.custo_unitario_ref > 0 ? BRL(r.custo_unitario_ref) : "—"}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0,00"
                            value={d.valor ?? ""}
                            onChange={(e) => setDraft(r, { valor: e.target.value })}
                            className="h-9"
                          />
                        </TableCell>
                        <TableCell>
                          <Select value={d.tipo ?? tipoPadrao} onValueChange={(v: any) => setDraft(r, { tipo: v })}>
                            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="estimado">Estimado</SelectItem>
                              <SelectItem value="confirmado">Confirmado</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {BRL(total)}
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" onClick={() => abrirNovo(r)}>Personalizar</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ================= HISTÓRICO ================= */}
        <TabsContent value="historico" className="mt-4">
          <Card className="p-3 space-y-3">
            <div className="flex items-center gap-2 justify-between">
              <Input
                placeholder="Buscar produto, sala, responsável…"
                value={buscaHist}
                onChange={(e) => setBuscaHist(e.target.value)}
                className="w-72"
              />
              <div className="text-sm text-muted-foreground">
                {historico.length} avaliação(ões) registrada(s)
              </div>
            </div>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Data</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Sala</TableHead>
                    <TableHead className="text-right w-[80px]">Qtd</TableHead>
                    <TableHead className="text-right w-[80px]">Restante</TableHead>
                    <TableHead className="text-right w-[120px]">Vlr. unit.</TableHead>
                    <TableHead className="text-right w-[130px]">Vlr. total</TableHead>
                    <TableHead className="w-[110px]">Tipo</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="w-[70px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={10} className="text-center py-8"><Loader2 className="size-5 animate-spin inline" /></TableCell></TableRow>
                  ) : histFiltered.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                      Nenhuma avaliação registrada.
                    </TableCell></TableRow>
                  ) : histFiltered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{fmtDate(r.created_at)}</TableCell>
                      <TableCell className="font-medium">
                        {r.produto_nome}
                        {r.observacao && (
                          <div className="text-[11px] text-muted-foreground truncate max-w-[280px]" title={r.observacao}>
                            {r.observacao}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{r.sala_nome}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantidade_avaliada}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.quantidade_restante}</TableCell>
                      <TableCell className="text-right tabular-nums">{BRL(Number(r.valor_unitario))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{BRL(Number(r.valor_total))}</TableCell>
                      <TableCell>
                        {r.tipo === "confirmado" ? (
                          <Badge variant="default" className="gap-1"><BadgeCheck className="size-3" />Confirmado</Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1"><BadgeAlert className="size-3" />Estimado</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.responsavel_nome ?? "—"}</TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" onClick={() => excluirAval(r.id)} title="Excluir avaliação">
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog nova/personalizar */}
      <Dialog open={novoOpen} onOpenChange={setNovoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Avaliar patrimônio</DialogTitle>
            <DialogDescription>
              {novoForm.row?.produto_nome} — {novoForm.row?.sala_nome}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Quantidade avaliada</Label>
              <Input type="number" min="1" value={novoForm.qtd} onChange={(e) => setNovoForm((f) => ({ ...f, qtd: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Valor unitário (R$)</Label>
              <Input type="number" step="0.01" min="0" value={novoForm.valor} onChange={(e) => setNovoForm((f) => ({ ...f, valor: e.target.value }))} />
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Tipo</Label>
              <Select value={novoForm.tipo} onValueChange={(v: any) => setNovoForm((f) => ({ ...f, tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="estimado">Estimado</SelectItem>
                  <SelectItem value="confirmado">Confirmado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label>Observação</Label>
              <Textarea rows={3} value={novoForm.obs} onChange={(e) => setNovoForm((f) => ({ ...f, obs: e.target.value }))} placeholder="Contexto opcional (ex: regularização financeira após implantação do módulo de custos)" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNovoOpen(false)}>Cancelar</Button>
            <Button onClick={salvarNovo} disabled={salvandoNovo}>
              {salvandoNovo ? <Loader2 className="size-4 animate-spin mr-1.5" /> : <Save className="size-4 mr-1.5" />}
              Salvar avaliação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
