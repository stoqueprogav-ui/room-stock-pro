import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, MapPin, Building2, Loader2 } from "lucide-react";

type Regiao = { id: string; nome: string; ativo: boolean; created_at: string; salas_count?: number };

export default function RegioesPage() {
  const { isSuperMaster } = useAuth();
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Regiao | null>(null);
  const [nome, setNome] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: regs }, { data: salas }] = await Promise.all([
      supabase.from("regioes").select("id, nome, ativo, created_at").order("nome"),
      supabase.from("salas").select("regiao_id"),
    ]);
    const cont = new Map<string, number>();
    ((salas as any[]) ?? []).forEach((s) => {
      if (s.regiao_id) cont.set(s.regiao_id, (cont.get(s.regiao_id) ?? 0) + 1);
    });
    setRegioes(((regs as any[]) ?? []).map((r) => ({ ...r, salas_count: cont.get(r.id) ?? 0 })));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setNome(""); setAtivo(true); setOpen(true); };
  const openEdit = (r: Regiao) => { setEditing(r); setNome(r.nome); setAtivo(r.ativo); setOpen(true); };

  const salvar = async () => {
    const n = nome.trim();
    if (!n) return toast.error("Informe o nome da região");
    setSaving(true);
    let error;
    if (editing) ({ error } = await supabase.from("regioes").update({ nome: n, ativo }).eq("id", editing.id));
    else ({ error } = await supabase.from("regioes").insert({ nome: n }));
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Região atualizada" : "Região criada");
    setOpen(false);
    load();
  };

  const totalSalas = useMemo(() => regioes.reduce((s, r) => s + (r.salas_count ?? 0), 0), [regioes]);

  if (!isSuperMaster) return <Navigate to="/app" replace />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regiões"
        description="Cada região tem seus próprios masters, salas e estoque, totalmente isolados. Empréstimos só ocorrem dentro da mesma região."
        actions={<Button onClick={openNew}><Plus className="size-4" /> Nova região</Button>}
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="panel p-4">
          <div className="text-xs text-muted-foreground">Regiões</div>
          <div className="text-2xl font-semibold">{regioes.length}</div>
        </div>
        <div className="panel p-4">
          <div className="text-xs text-muted-foreground">Ativas</div>
          <div className="text-2xl font-semibold">{regioes.filter((r) => r.ativo).length}</div>
        </div>
        <div className="panel p-4">
          <div className="text-xs text-muted-foreground">Total de salas</div>
          <div className="text-2xl font-semibold">{totalSalas}</div>
        </div>
      </div>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Região</TableHead>
              <TableHead className="w-[140px] text-right">Salas</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={4} className="text-center py-10">
                <Loader2 className="size-5 animate-spin mx-auto text-primary" />
              </TableCell></TableRow>
            )}
            {!loading && regioes.map((r) => (
              <TableRow key={r.id} className={`table-row-hover ${!r.ativo ? "opacity-60" : ""}`}>
                <TableCell className="font-medium">
                  <span className="inline-flex items-center gap-2"><MapPin className="size-4 text-primary" /> {r.nome}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline" className="gap-1"><Building2 className="size-3" /> {r.salas_count ?? 0}</Badge>
                </TableCell>
                <TableCell>
                  {r.ativo
                    ? <Badge className="bg-success/15 text-success border border-success/30">Ativa</Badge>
                    : <Badge className="bg-muted text-muted-foreground border">Inativa</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" aria-label="Editar região" onClick={() => openEdit(r)}>
                    <Pencil className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!loading && regioes.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-12">
                <MapPin className="size-6 mx-auto mb-2 opacity-40" /> Nenhuma região cadastrada.
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar região" : "Nova região"}</DialogTitle>
            <DialogDescription>
              Ex.: "Gramado e Canela", "Hotel Valley", "Recife". Depois de criar, associe as salas e o master responsável.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus
                onKeyDown={(e) => { if (e.key === "Enter") salvar(); }} placeholder="Nome da região" />
            </div>
            {editing && (
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Região ativa</div>
                  <div className="text-xs text-muted-foreground">Inativa deixa de aparecer em novas operações.</div>
                </div>
                <Switch checked={ativo} onCheckedChange={setAtivo} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
