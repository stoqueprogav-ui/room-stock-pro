import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

type Linha = {
  produto_id: string;
  nome: string;
  unidade: string;
  estoque: number;
  categoria_id: string | null;
  categoria_nome: string | null;
};

export default function NovaRequisicao() {
  const { profile } = useAuth();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catFilter, setCatFilter] = useState<string>("");
  const [obs, setObs] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile?.sala_id) return;
    (async () => {
      const [{ data }, { data: cats }] = await Promise.all([
        supabase
          .from("estoque")
          .select("produto_id, quantidade, produtos!inner(nome, unidade, ativo, categoria_id, categoria:categorias(nome))")
          .eq("sala_id", profile.sala_id)
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
    })();
  }, [profile]);

  const setQtd = (id: string, q: number) => setCarrinho((c) => ({ ...c, [id]: q }));

  const enviar = async () => {
    const itens = Object.entries(carrinho)
      .map(([produto_id, quantidade]) => ({ produto_id, quantidade: Number(quantidade) }))
      .filter((i) => i.quantidade > 0);
    if (itens.length === 0) return toast.error("Adicione ao menos um item");
    setEnviando(true);
    const { error } = await supabase.rpc("criar_solicitacao", { _itens: itens, _observacao: obs || null });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Requisição enviada · aguardando aprovação do Master");
    navigate("/app/minhas-requisicoes");
  };

  const filtered = useMemo(() => {
    return linhas
      .filter((l) => !catFilter || l.categoria_id === catFilter)
      .filter((l) => !busca || l.nome.toLowerCase().includes(busca.toLowerCase()));
  }, [linhas, busca, catFilter]);
  const totalSelecionados = Object.values(carrinho).filter((q) => q > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Nova requisição ao Master" description="Selecione uma categoria e escolha os produtos. A baixa no estoque ocorre apenas após a aprovação do Master." />

      {!catFilter ? (
        <div className="panel p-6">
          <h3 className="font-semibold mb-1">Escolha uma categoria</h3>
          <p className="text-sm text-muted-foreground mb-4">Filtre os produtos pela categoria desejada.</p>
          <div className="flex flex-wrap gap-2">
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
                {categorias.map((c) => (
                  <Button key={c.id} size="sm" variant={catFilter === c.id ? "default" : "outline"} onClick={() => setCatFilter(c.id)}>
                    <Tag className="size-3" /> {c.nome}
                  </Button>
                ))}
              </div>
              <Input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
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
                  {filtered.map((l) => (
                    <TableRow key={l.produto_id} className="table-row-hover">
                      <TableCell className="font-medium">{l.nome} <span className="text-muted-foreground text-xs">({l.unidade})</span></TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1"><Tag className="size-3" />{l.categoria_nome ?? "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono">{l.estoque}</TableCell>
                      <TableCell>
                        <Input type="number" min={0} value={carrinho[l.produto_id] ?? ""} onChange={(e) => setQtd(l.produto_id, Number(e.target.value))} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum produto nesta categoria.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="panel p-4 space-y-3 h-fit">
            <h3 className="font-semibold">Resumo</h3>
            <div className="text-sm text-muted-foreground">{totalSelecionados} item(ns) selecionado(s)</div>
            <div className="space-y-2">
              <Label>Observação</Label>
              <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Justificativa, finalidade…" />
            </div>
            <Button className="w-full" onClick={enviar} disabled={enviando}>
              <Send className="size-4" /> {enviando ? "Enviando..." : "Enviar requisição"}
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setCarrinho({})}><Trash2 className="size-4" /> Limpar</Button>
          </div>
        </div>
      )}
    </div>
  );
}
