import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveSala } from "@/contexts/ActiveSalaContext";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Send, Trash2, Tag } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Categoria } from "@/lib/types";
import ConfirmarRequisicaoDialog from "@/components/ConfirmarRequisicaoDialog";

type Linha = {
  produto_id: string;
  nome: string;
  unidade: string;
  estoque: number;
  categoria_id: string | null;
  categoria_nome: string | null;
};

export default function NovaRequisicao() {
  const { activeSalaId, activeSalaName } = useActiveSala();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catFilter, setCatFilter] = useState<string>(""); // "" = nenhum (tela inicial), "all" = todas, ou id
  const [obs, setObs] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [salaNome, setSalaNome] = useState<string>("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeSalaId) return;
    (async () => {
      const [{ data }, { data: cats }] = await Promise.all([
        supabase
          .from("estoque")
          .select("produto_id, quantidade, produtos!inner(nome, unidade, ativo, categoria_id, categoria:categorias(nome))")
          .eq("sala_id", activeSalaId)
          .eq("produtos.ativo", true),
        supabase.from("categorias").select("*").order("nome"),
      ]);
      const list: Linha[] = (data ?? []).map((r: any) => ({
        produto_id: r.produto_id,
        nome: r.produtos.nome,
        unidade: r.produtos.unidade,
        estoque: r.quantidade,
        categoria_id: r.produtos.categoria_id,
        categoria_nome: r.produtos.categoria?.nome ?? null,
      })).sort((a: Linha, b: Linha) => a.nome.localeCompare(b.nome));
      setLinhas(list);
      setCategorias((cats as Categoria[]) ?? []);
      setSalaNome(activeSalaName ?? "");
    })();
  }, [activeSalaId, activeSalaName]);

  const setQtd = (id: string, q: number) => setCarrinho((c) => ({ ...c, [id]: q }));

  const abrirConfirmacao = () => {
    const itens = Object.entries(carrinho)
      .map(([produto_id, quantidade]) => ({ produto_id, quantidade: Number(quantidade) }))
      .filter((i) => i.quantidade > 0);
    if (itens.length === 0) return toast.error("Adicione ao menos um item");
    setConfirmOpen(true);
  };

  const enviar = async () => {
    const itens = Object.entries(carrinho)
      .map(([produto_id, quantidade]) => ({ produto_id, quantidade: Number(quantidade) }))
      .filter((i) => i.quantidade > 0);
    if (itens.length === 0) return toast.error("Adicione ao menos um item");
    setEnviando(true);
    const { error } = await supabase.rpc("criar_solicitacao", { _itens: itens, _observacao: obs || null });
    setEnviando(false);
    if (error) return toast.error(error.message);
    setConfirmOpen(false);
    toast.success("Requisição enviada · aguardando aprovação do Master");
    navigate("/app/minhas-requisicoes");
  };

  const filtered = useMemo(() => {
    return linhas
      .filter((l) => !catFilter || catFilter === "all" || l.categoria_id === catFilter)
      .filter((l) => !busca || l.nome.toLowerCase().includes(busca.toLowerCase()));
  }, [linhas, busca, catFilter]);

  // Quando categoria = "all", agrupa visualmente por categoria
  const grouped = useMemo(() => {
    if (catFilter !== "all") return null;
    const map = new Map<string, { nome: string; itens: Linha[] }>();
    for (const l of filtered) {
      const key = l.categoria_id ?? "__none__";
      const nome = l.categoria_nome ?? "Sem categoria";
      if (!map.has(key)) map.set(key, { nome, itens: [] });
      map.get(key)!.itens.push(l);
    }
    return [...map.values()].sort((a, b) => a.nome.localeCompare(b.nome));
  }, [filtered, catFilter]);

  // Itens no carrinho com detalhes (para o resumo)
  const carrinhoDetalhado = useMemo(() => {
    return Object.entries(carrinho)
      .filter(([, q]) => q > 0)
      .map(([produto_id, quantidade]) => {
        const l = linhas.find((x) => x.produto_id === produto_id);
        return l ? { ...l, quantidade } : null;
      })
      .filter(Boolean) as (Linha & { quantidade: number })[];
  }, [carrinho, linhas]);

  const totalSelecionados = carrinhoDetalhado.length;

  // Validação de estoque ao digitar
  const setQtdValidado = (l: Linha, q: number) => {
    if (q < 0) q = 0;
    if (q > l.estoque) {
      toast.warning(`Disponível: ${l.estoque} ${l.unidade}`);
      q = l.estoque;
    }
    setQtd(l.produto_id, q);
  };

  const renderLinha = (l: Linha) => (
    <TableRow key={l.produto_id} className="table-row-hover">
      <TableCell className="font-medium">{l.nome} <span className="text-muted-foreground text-xs">({l.unidade})</span></TableCell>
      <TableCell>
        <Badge variant="secondary" className="gap-1"><Tag className="size-3" />{l.categoria_nome ?? "—"}</Badge>
      </TableCell>
      <TableCell className="text-right font-mono">{l.estoque}</TableCell>
      <TableCell>
        <Input
          type="number"
          min={0}
          max={l.estoque}
          value={carrinho[l.produto_id] ?? ""}
          onChange={(e) => setQtdValidado(l, Number(e.target.value))}
          className={carrinho[l.produto_id] > 0 ? "border-primary" : ""}
        />
      </TableCell>
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Nova requisição ao Master" description="Escolha uma categoria — ou 'Todos' para misturar várias. A baixa no estoque ocorre apenas após a aprovação do Master." />

      {!catFilter ? (
        <div className="panel p-6">
          <h3 className="font-semibold mb-1">Escolha uma categoria</h3>
          <p className="text-sm text-muted-foreground mb-4">Filtre por categoria, ou use "Todos" para criar uma requisição com produtos de várias categorias.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={() => setCatFilter("all")} className="gap-2">
              <Tag className="size-4" /> Todos (várias categorias)
            </Button>
            {categorias.map((c) => (
              <Button key={c.id} size="lg" variant="outline" onClick={() => setCatFilter(c.id)} className="gap-2">
                <Tag className="size-4" /> {c.nome}
              </Button>
            ))}
            {categorias.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma categoria cadastrada.</p>}
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 panel overflow-hidden">
            <div className="p-3 border-b border-border space-y-2">
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-muted-foreground mr-1">Categoria:</span>
                <Button size="sm" variant={catFilter === "all" ? "default" : "outline"} onClick={() => setCatFilter("all")}>
                  Todos
                </Button>
                {categorias.map((c) => (
                  <Button key={c.id} size="sm" variant={catFilter === c.id ? "default" : "outline"} onClick={() => setCatFilter(c.id)}>
                    <Tag className="size-3" /> {c.nome}
                  </Button>
                ))}
              </div>
              <Input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              {grouped ? (
                grouped.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground text-sm">Nenhum produto disponível.</div>
                ) : (
                  grouped.map((g) => (
                    <div key={g.nome} className="border-b border-border last:border-b-0">
                      <div className="px-4 py-2 bg-muted/40 flex items-center gap-2 text-sm font-semibold">
                        <Tag className="size-3.5 text-primary" /> {g.nome}
                        <Badge variant="secondary" className="text-[10px] h-5">{g.itens.length}</Badge>
                      </div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Produto</TableHead>
                            <TableHead className="w-[110px]">Categoria</TableHead>
                            <TableHead className="text-right w-[120px]">Em estoque</TableHead>
                            <TableHead className="w-[160px]">Quantidade</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>{g.itens.map(renderLinha)}</TableBody>
                      </Table>
                    </div>
                  ))
                )
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produto</TableHead>
                      <TableHead className="w-[110px]">Categoria</TableHead>
                      <TableHead className="text-right w-[120px]">Em estoque</TableHead>
                      <TableHead className="w-[160px]">Quantidade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(renderLinha)}
                    {filtered.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum produto nesta categoria.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
          <div className="panel p-4 space-y-3 h-fit sticky top-4">
            <h3 className="font-semibold flex items-center gap-2">
              Resumo do pedido
              <Badge variant="secondary">{totalSelecionados}</Badge>
            </h3>
            {carrinhoDetalhado.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum item selecionado.</p>
            ) : (
              <ul className="space-y-1.5 max-h-64 overflow-y-auto pr-1 text-sm">
                {carrinhoDetalhado.map((it) => (
                  <li key={it.produto_id} className="flex items-start justify-between gap-2 p-2 rounded border border-border">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{it.nome}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Tag className="size-2.5" /> {it.categoria_nome ?? "—"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-semibold">{it.quantidade}</div>
                      <button onClick={() => setQtd(it.produto_id, 0)} className="text-[10px] text-destructive hover:underline">remover</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Justificativa, finalidade…" />
            </div>
            <Button className="w-full" onClick={abrirConfirmacao} disabled={enviando || totalSelecionados === 0}>
              <Send className="size-4" /> Revisar e enviar
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setCarrinho({})} disabled={totalSelecionados === 0}>
              <Trash2 className="size-4" /> Limpar
            </Button>
          </div>
        </div>
      )}

      <ConfirmarRequisicaoDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        salaNome={salaNome}
        itens={carrinhoDetalhado.map((it) => ({
          produto_id: it.produto_id,
          nome: it.nome,
          unidade: it.unidade,
          quantidade: it.quantidade,
          categoria_nome: it.categoria_nome,
        }))}
        observacao={obs}
        enviando={enviando}
        onConfirmar={enviar}
      />
    </div>
  );
}
