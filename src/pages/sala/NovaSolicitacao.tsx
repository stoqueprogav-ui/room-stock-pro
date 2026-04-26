import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Send, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Linha = { produto_id: string; nome: string; unidade: string; estoque: number; quantidade: number };

export default function NovaSolicitacao() {
  const { profile } = useAuth();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [obs, setObs] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!profile?.sala_id) return;
    (async () => {
      const { data } = await supabase
        .from("estoque")
        .select("produto_id, quantidade, produtos(nome, unidade)")
        .eq("sala_id", profile.sala_id);
      const list: Linha[] = (data ?? []).map((r: any) => ({
        produto_id: r.produto_id, nome: r.produtos.nome, unidade: r.produtos.unidade, estoque: r.quantidade, quantidade: 0,
      })).sort((a: Linha, b: Linha) => a.nome.localeCompare(b.nome));
      setLinhas(list);
    })();
  }, [profile]);

  const setQtd = (id: string, q: number) => setCarrinho((c) => ({ ...c, [id]: q }));

  const enviar = async () => {
    const itens = Object.entries(carrinho)
      .map(([produto_id, quantidade]) => ({ produto_id, quantidade: Number(quantidade) }))
      .filter((i) => i.quantidade > 0);
    if (itens.length === 0) return toast.error("Adicione ao menos um item");
    const { error } = await supabase.rpc("criar_solicitacao", { _itens: itens, _observacao: obs || null });
    if (error) return toast.error(error.message);
    toast.success("Solicitação enviada · estoque dado baixa");
    navigate("/app/minhas-solicitacoes");
  };

  const filtered = linhas.filter((l) => !busca || l.nome.toLowerCase().includes(busca.toLowerCase()));
  const totalSelecionados = Object.values(carrinho).filter((q) => q > 0).length;

  return (
    <div className="space-y-4">
      <PageHeader title="Nova solicitação ao Master" description="A baixa no estoque é imediata. Em caso de rejeição, há estorno automático." />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 panel overflow-hidden">
          <div className="p-3 border-b border-border">
            <Input placeholder="Buscar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right w-[120px]">Em estoque</TableHead>
                  <TableHead className="w-[160px]">Quantidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((l) => (
                  <TableRow key={l.produto_id} className="table-row-hover">
                    <TableCell className="font-medium">{l.nome} <span className="text-muted-foreground text-xs">({l.unidade})</span></TableCell>
                    <TableCell className="text-right font-mono">{l.estoque}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} max={l.estoque} value={carrinho[l.produto_id] ?? ""} onChange={(e) => setQtd(l.produto_id, Number(e.target.value))} />
                    </TableCell>
                  </TableRow>
                ))}
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
          <Button className="w-full" onClick={enviar}><Send className="size-4" /> Enviar solicitação</Button>
          <Button variant="ghost" className="w-full" onClick={() => setCarrinho({})}><Trash2 className="size-4" /> Limpar</Button>
        </div>
      </div>
    </div>
  );
}
