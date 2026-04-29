import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Send, Trash2, Loader2, AlertTriangle, Tag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import type { Sala, Produto, Categoria } from "@/lib/types";

export default function NovoEmprestimo() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [catFilter, setCatFilter] = useState<string>("");
  const [salaOrigem, setSalaOrigem] = useState("");
  const [obs, setObs] = useState("");
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});
  const [estoqueOrigem, setEstoqueOrigem] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const [{ data: ss }, { data: pp }, { data: cc }] = await Promise.all([
        supabase.from("salas").select("*").order("nome"),
        supabase.from("produtos").select("*, categoria:categorias(id, nome)").order("nome"),
        supabase.from("categorias").select("*").order("nome"),
      ]);
      setSalas((ss as Sala[]) ?? []);
      setProdutos((pp as any) ?? []);
      setCategorias((cc as Categoria[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    if (!salaOrigem) return setEstoqueOrigem({});
    // Como Admin/Analista não têm RLS para ler estoque de outra sala, só mostraremos o catálogo (sem qtd visível).
    // Tentar mesmo assim caso tenha permissão:
    (async () => {
      const { data } = await supabase.from("estoque").select("produto_id, quantidade").eq("sala_id", salaOrigem);
      const map: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { map[r.produto_id] = r.quantidade; });
      setEstoqueOrigem(map);
    })();
  }, [salaOrigem]);

  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    if (!salaOrigem) return toast.error("Escolha a sala de origem");
    const itens = Object.entries(carrinho)
      .map(([produto_id, quantidade]) => ({ produto_id, quantidade: Number(quantidade) }))
      .filter((i) => i.quantidade > 0);
    if (itens.length === 0) return toast.error("Selecione ao menos um produto");

    // Validação extra: se temos visibilidade do estoque origem, não permitir pedir mais do que existe.
    if (Object.keys(estoqueOrigem).length > 0) {
      for (const i of itens) {
        const disp = estoqueOrigem[i.produto_id] ?? 0;
        if (i.quantidade > disp) {
          const prod = produtos.find((p) => p.id === i.produto_id);
          return toast.error(`Quantidade pedida (${i.quantidade}) excede o estoque de ${prod?.nome ?? "produto"} na sala origem (${disp}).`);
        }
      }
    }

    setEnviando(true);
    const { error } = await supabase.rpc("criar_emprestimo", { _sala_origem: salaOrigem, _itens: itens, _observacao: obs || null });
    setEnviando(false);
    if (error) return toast.error(error.message);
    toast.success("Empréstimo solicitado. Aguardando aprovação da sala de origem.");
    navigate("/app/emprestimos");
  };

  const outrasSalas = salas.filter((s) => s.id !== profile?.sala_id);

  return (
    <div className="space-y-4">
      <PageHeader title="Pedir empréstimo a outra sala" description="Sua sala receberá o produto após a aprovação. Será gerada uma dívida automaticamente." />
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 panel">
          <div className="p-3 border-b border-border grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sala de origem</Label>
              <Select value={salaOrigem} onValueChange={setSalaOrigem}>
                <SelectTrigger><SelectValue placeholder="Escolha a sala que possui o produto" /></SelectTrigger>
                <SelectContent>{outrasSalas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right w-[140px]">Estoque origem</TableHead>
                  <TableHead className="w-[160px]">Quantidade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map((p) => {
                  const disp = estoqueOrigem[p.id];
                  const qtdPedida = Number(carrinho[p.id] ?? 0);
                  const excede = disp !== undefined && qtdPedida > disp;
                  return (
                    <TableRow key={p.id} className="table-row-hover">
                      <TableCell className="font-medium">{p.nome} <span className="text-muted-foreground text-xs">({p.unidade})</span></TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{salaOrigem ? (disp ?? "—") : "—"}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          max={disp}
                          value={carrinho[p.id] ?? ""}
                          onChange={(e) => setCarrinho({ ...carrinho, [p.id]: Number(e.target.value) })}
                          className={excede ? "border-destructive focus-visible:ring-destructive" : undefined}
                        />
                        {excede && (
                          <div className="text-xs text-destructive mt-1 flex items-center gap-1">
                            <AlertTriangle className="size-3" /> Excede o estoque disponível.
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {produtos.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-12">Nenhum produto disponível.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
        <div className="panel p-4 space-y-3 h-fit">
          <h3 className="font-semibold">Resumo</h3>
          {!salaOrigem && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
              Escolha a sala de origem para liberar a seleção de produtos.
            </div>
          )}
          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Motivo / detalhes do pedido" />
          </div>
          <Button className="w-full" onClick={enviar} disabled={enviando || !salaOrigem}>
            {enviando ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Enviar pedido
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setCarrinho({})} disabled={enviando}>
            <Trash2 className="size-4" /> Limpar
          </Button>
        </div>
      </div>
    </div>
  );
}
