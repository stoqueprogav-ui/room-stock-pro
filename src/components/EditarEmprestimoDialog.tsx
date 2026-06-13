import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Plus, Minus, Trash2, Save, Tag, Search } from "lucide-react";
import type { Sala, Produto, Categoria } from "@/lib/types";
import { useDraft } from "@/hooks/useDraft";
import DraftStatusBadge from "@/components/DraftStatusBadge";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  emprestimoId: string | null;
  onSaved: () => void;
};

type Linha = { produto_id: string; quantidade: number };

export default function EditarEmprestimoDialog({ open, onOpenChange, emprestimoId, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [salaOrigem, setSalaOrigem] = useState<string>("");
  const [salaDestino, setSalaDestino] = useState<string>("");
  const [obs, setObs] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [catFilter, setCatFilter] = useState<string>("");

  useEffect(() => {
    if (!open || !emprestimoId) return;
    (async () => {
      setLoading(true);
      const [{ data: emp }, { data: itens }, { data: ss }, { data: pp }, { data: cc }] = await Promise.all([
        supabase.from("emprestimos").select("id, status, observacao, sala_origem_id, sala_destino_id").eq("id", emprestimoId).maybeSingle(),
        supabase.from("emprestimo_itens").select("produto_id, quantidade").eq("emprestimo_id", emprestimoId),
        supabase.from("salas").select("*").order("nome"),
        supabase.from("produtos").select("*, categoria:categorias(id, nome)").eq("ativo", true).order("nome"),
        supabase.from("categorias").select("*").order("nome"),
      ]);
      setLoading(false);
      if (!emp) { toast.error("Empréstimo não encontrado"); onOpenChange(false); return; }
      if (emp.status !== "pendente") { toast.error("Apenas empréstimos pendentes podem ser editados"); onOpenChange(false); return; }
      setSalaOrigem(emp.sala_origem_id);
      setSalaDestino(emp.sala_destino_id);
      setObs(emp.observacao ?? "");
      const c: Record<string, number> = {};
      (itens ?? []).forEach((it: any) => { c[it.produto_id] = it.quantidade; });
      setCarrinho(c);
      setSalas((ss as Sala[]) ?? []);
      setProdutos((pp as any) ?? []);
      setCategorias((cc as Categoria[]) ?? []);
      setBusca(""); setCatFilter("");
    })();
  }, [open, emprestimoId, onOpenChange]);

  const setQtd = (id: string, q: number) => {
    const nv = Math.max(0, Math.floor(q || 0));
    setCarrinho((c) => {
      const next = { ...c };
      if (nv === 0) delete next[id]; else next[id] = nv;
      return next;
    });
  };

  const produtosFiltrados = useMemo(() =>
    produtos
      .filter((p) => !catFilter || p.categoria_id === catFilter)
      .filter((p) => !busca || p.nome.toLowerCase().includes(busca.toLowerCase())),
    [produtos, catFilter, busca]
  );

  const itensCarrinho = useMemo(() =>
    Object.entries(carrinho)
      .map(([id, q]) => ({ produto: produtos.find((p) => p.id === id), quantidade: q }))
      .filter((i) => i.produto && i.quantidade > 0) as { produto: Produto; quantidade: number }[],
    [carrinho, produtos]
  );

  const salasOrigemOpcoes = salas.filter((s) => s.id !== salaDestino);

  const salvar = async () => {
    if (!emprestimoId) return;
    if (!salaOrigem) return toast.error("Selecione a sala de origem");
    if (itensCarrinho.length === 0) return toast.error("Adicione ao menos um item");
    const itens = itensCarrinho.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade }));
    setSaving(true);
    const { error } = await supabase.rpc("editar_emprestimo" as any, {
      _emp: emprestimoId,
      _sala_origem: salaOrigem,
      _itens: itens,
      _observacao: obs?.trim() || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Solicitação atualizada");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar solicitação de empréstimo</DialogTitle>
          <DialogDescription>
            Você pode alterar a sala de origem, produtos, quantidades e observação enquanto o pedido estiver pendente.
            O número da solicitação não muda.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-12 flex justify-center"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Sala de origem (quem vai emprestar) *</Label>
                <Select value={salaOrigem} onValueChange={setSalaOrigem}>
                  <SelectTrigger><SelectValue placeholder="Selecione a sala" /></SelectTrigger>
                  <SelectContent>
                    {salasOrigemOpcoes.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Observação / justificativa</Label>
                <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo, detalhes..." rows={2} />
              </div>
            </div>

            <div className="grid lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2 panel overflow-hidden">
                <div className="p-3 border-b border-border grid sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto" className="pl-8" />
                  </div>
                  <Select value={catFilter || "all"} onValueChange={(v) => setCatFilter(v === "all" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      {categorias.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="max-h-[360px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Produto</TableHead>
                        <TableHead className="w-[120px]">Categoria</TableHead>
                        <TableHead className="w-[170px]">Quantidade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {produtosFiltrados.map((p) => {
                        const q = carrinho[p.id] ?? 0;
                        return (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium">{p.nome} <span className="text-xs text-muted-foreground">({p.unidade})</span></TableCell>
                            <TableCell>
                              {p.categoria?.nome
                                ? <Badge variant="secondary" className="gap-1"><Tag className="size-3" />{p.categoria.nome}</Badge>
                                : <span className="text-xs text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1">
                                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQtd(p.id, q - 1)} disabled={q <= 0}><Minus className="size-3" /></Button>
                                <Input type="number" min={0} value={q || ""} onChange={(e) => setQtd(p.id, Number(e.target.value))} className="h-8 w-20 text-center" />
                                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setQtd(p.id, q + 1)}><Plus className="size-3" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {produtosFiltrados.length === 0 && (
                        <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nenhum produto.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="panel p-3 h-fit">
                <h4 className="font-semibold mb-2 flex items-center gap-2">Carrinho <Badge variant="secondary">{itensCarrinho.length}</Badge></h4>
                {itensCarrinho.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum item.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-[300px] overflow-auto">
                    {itensCarrinho.map((i) => (
                      <li key={i.produto.id} className="flex items-center justify-between text-sm rounded border border-border px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{i.produto.nome}</div>
                          <div className="text-xs text-muted-foreground">{i.quantidade} {i.produto.unidade}</div>
                        </div>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setQtd(i.produto.id, 0)}><Trash2 className="size-3.5" /></Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || loading || itensCarrinho.length === 0 || !salaOrigem}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
