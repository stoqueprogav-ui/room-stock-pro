import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { AlertTriangle, Pencil } from "lucide-react";
import type { Sala, Produto } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";

type Row = { produto_id: string; sala_id: string; quantidade: number; produto: Produto; sala: Sala };

export default function EstoquePage() {
  const { role, profile } = useAuth();
  const [salas, setSalas] = useState<Sala[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [salaFilter, setSalaFilter] = useState<string>("all");
  const [busca, setBusca] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [editValue, setEditValue] = useState(0);
  const [obs, setObs] = useState("");

  const load = async () => {
    const [{ data: s }, { data: p }, { data: e }] = await Promise.all([
      supabase.from("salas").select("*").order("nome"),
      supabase.from("produtos").select("*").order("nome"),
      supabase.from("estoque").select("produto_id, sala_id, quantidade, produtos(*), salas(*)"),
    ]);
    setSalas((s as Sala[]) ?? []);
    setProdutos((p as Produto[]) ?? []);
    const mapped: Row[] = (e ?? []).map((r: any) => ({
      produto_id: r.produto_id, sala_id: r.sala_id, quantidade: r.quantidade,
      produto: r.produtos, sala: r.salas,
    }));
    setRows(mapped);
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (role !== "master" && profile?.sala_id) setSalaFilter(profile.sala_id);
  }, [role, profile]);

  const filtered = useMemo(() => {
    return rows
      .filter((r) => salaFilter === "all" || r.sala_id === salaFilter)
      .filter((r) => !busca || r.produto.nome.toLowerCase().includes(busca.toLowerCase()))
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome) || a.sala.nome.localeCompare(b.sala.nome));
  }, [rows, salaFilter, busca]);

  const ajustar = async () => {
    if (!editing) return;
    const { error } = await supabase.rpc("ajustar_estoque", {
      _produto: editing.produto_id, _sala: editing.sala_id, _quantidade: Number(editValue), _observacao: obs || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Estoque ajustado"); setEditing(null); setObs(""); load();
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Controle de estoque" description="Quantidades por produto em cada sala. Ajustes registrados em movimentações." />

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
          <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome do produto…" />
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead>Sala</TableHead>
              <TableHead className="text-right w-[140px]">Quantidade</TableHead>
              <TableHead className="text-right w-[140px]">Mínimo</TableHead>
              <TableHead className="w-[140px]">Status</TableHead>
              {role === "master" && <TableHead className="w-[80px] text-right">Ação</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const baixo = r.quantidade <= r.produto.estoque_minimo;
              return (
                <TableRow key={`${r.produto_id}-${r.sala_id}`} className="table-row-hover">
                  <TableCell className="font-medium">{r.produto.nome} <span className="text-muted-foreground text-xs">({r.produto.unidade})</span></TableCell>
                  <TableCell>{r.sala.nome}</TableCell>
                  <TableCell className="text-right font-mono">{r.quantidade}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{r.produto.estoque_minimo}</TableCell>
                  <TableCell>
                    {baixo
                      ? <Badge className="bg-warning/15 text-warning border border-warning/30 gap-1"><AlertTriangle className="size-3" /> Estoque baixo</Badge>
                      : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                  {role === "master" && (
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(r); setEditValue(r.quantidade); setObs(""); }}>
                        <Pencil className="size-4" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {filtered.length === 0 && <TableRow><TableCell colSpan={role === "master" ? 6 : 5} className="text-center text-muted-foreground py-12">Sem resultados.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ajustar estoque · {editing?.produto.nome}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">Sala: <span className="text-foreground font-medium">{editing?.sala.nome}</span></div>
            <div className="space-y-2"><Label>Nova quantidade</Label><Input type="number" min={0} value={editValue} onChange={(e) => setEditValue(Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Observação (opcional)</Label><Input value={obs} onChange={(e) => setObs(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
            <Button onClick={ajustar}>Salvar ajuste</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
