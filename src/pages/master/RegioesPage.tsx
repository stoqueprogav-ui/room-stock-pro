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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, MapPin, Building2, Loader2, UserPlus, X, Users } from "lucide-react";

type Regiao = { id: string; nome: string; ativo: boolean; created_at: string; salas_count?: number };
type MasterUser = { id: string; nome: string; email: string; regiao_ids: string[] };

export default function RegioesPage() {
  const { isSuperMaster } = useAuth();
  const [regioes, setRegioes] = useState<Regiao[]>([]);
  const [masters, setMasters] = useState<MasterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Regiao | null>(null);
  const [nome, setNome] = useState("");
  const [ativo, setAtivo] = useState(true);
  const [saving, setSaving] = useState(false);

  // Sub-form: criar master + região juntos (na criação) OU novo master vinculado (na edição)
  const [criarMasterJunto, setCriarMasterJunto] = useState(false);
  const [masterForm, setMasterForm] = useState({ nome: "", email: "", password: "" });

  // Sub-form (edição): vincular master existente
  const [linkExistingId, setLinkExistingId] = useState<string>("");
  const [linking, setLinking] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: regs }, { data: salas }, { data: profs }, { data: roles }, { data: mregs }] = await Promise.all([
      supabase.from("regioes").select("id, nome, ativo, created_at").order("nome"),
      supabase.from("salas").select("regiao_id"),
      supabase.from("profiles").select("id, nome, email"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("master_regioes").select("user_id, regiao_id"),
    ]);
    const cont = new Map<string, number>();
    ((salas as any[]) ?? []).forEach((s) => {
      if (s.regiao_id) cont.set(s.regiao_id, (cont.get(s.regiao_id) ?? 0) + 1);
    });
    setRegioes(((regs as any[]) ?? []).map((r) => ({ ...r, salas_count: cont.get(r.id) ?? 0 })));

    const masterIds = new Set(
      ((roles as any[]) ?? []).filter((r) => r.role === "master").map((r) => r.user_id)
    );
    const regByUser = new Map<string, string[]>();
    ((mregs as any[]) ?? []).forEach((r) => {
      regByUser.set(r.user_id, [...(regByUser.get(r.user_id) ?? []), r.regiao_id]);
    });
    const list: MasterUser[] = ((profs as any[]) ?? [])
      .filter((p) => masterIds.has(p.id))
      .map((p) => ({ id: p.id, nome: p.nome, email: p.email, regiao_ids: regByUser.get(p.id) ?? [] }))
      .sort((a, b) => a.nome.localeCompare(b.nome));
    setMasters(list);

    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const resetSubforms = () => {
    setCriarMasterJunto(false);
    setMasterForm({ nome: "", email: "", password: "" });
    setLinkExistingId("");
  };

  const openNew = () => { setEditing(null); setNome(""); setAtivo(true); resetSubforms(); setOpen(true); };
  const openEdit = (r: Regiao) => { setEditing(r); setNome(r.nome); setAtivo(r.ativo); resetSubforms(); setOpen(true); };

  // Masters ligados à região que está sendo editada
  const mastersDaRegiao = useMemo(
    () => editing ? masters.filter((m) => m.regiao_ids.includes(editing.id)) : [],
    [masters, editing]
  );
  // Masters disponíveis para vincular (não estão ligados a esta região)
  const mastersDisponiveis = useMemo(
    () => editing ? masters.filter((m) => !m.regiao_ids.includes(editing.id)) : [],
    [masters, editing]
  );

  const criarMasterVinculado = async (regiaoId: string) => {
    if (!masterForm.nome || !masterForm.email || !masterForm.password) {
      toast.error("Preencha nome, email e senha do master");
      return false;
    }
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        nome: masterForm.nome,
        email: masterForm.email.trim(),
        password: masterForm.password,
        role: "master",
        sala_id: null,
      },
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string; user_id?: string };
    if (error) { toast.error(`Erro de rede: ${error.message}`); return false; }
    if (!payload.ok || !payload.user_id) { toast.error(payload.error ?? "Falha ao criar master"); return false; }
    const { error: e2 } = await supabase.rpc("admin_set_master_regioes" as any, {
      _user: payload.user_id, _regioes: [regiaoId],
    });
    if (e2) { toast.error(e2.message); return false; }
    return true;
  };

  const salvar = async () => {
    const n = nome.trim();
    if (!n) return toast.error("Informe o nome da região");
    setSaving(true);
    let regiaoId = editing?.id;
    let error: any;
    if (editing) {
      ({ error } = await supabase.from("regioes").update({ nome: n, ativo }).eq("id", editing.id));
    } else {
      const { data, error: e } = await supabase.from("regioes").insert({ nome: n }).select("id").maybeSingle();
      error = e;
      regiaoId = (data as any)?.id;
    }
    if (error) { setSaving(false); return toast.error(error.message); }

    if (criarMasterJunto && regiaoId) {
      const ok = await criarMasterVinculado(regiaoId);
      if (!ok) { setSaving(false); return; }
    }

    setSaving(false);
    toast.success(editing ? "Região atualizada" : "Região criada");
    setOpen(false);
    load();
  };

  const vincularMasterExistente = async () => {
    if (!editing || !linkExistingId) return;
    const master = masters.find((m) => m.id === linkExistingId);
    if (!master) return;
    setLinking(true);
    const novas = Array.from(new Set([...master.regiao_ids, editing.id]));
    const { error } = await supabase.rpc("admin_set_master_regioes" as any, { _user: master.id, _regioes: novas });
    setLinking(false);
    if (error) return toast.error(error.message);
    toast.success(`${master.nome} vinculado(a) à região`);
    setLinkExistingId("");
    load();
  };

  const desvincularMaster = async (master: MasterUser) => {
    if (!editing) return;
    const novas = master.regiao_ids.filter((r) => r !== editing.id);
    const { error } = await supabase.rpc("admin_set_master_regioes" as any, { _user: master.id, _regioes: novas });
    if (error) return toast.error(error.message);
    toast.success(`${master.nome} desvinculado(a) da região`);
    load();
  };

  const criarNovoMasterNaEdicao = async () => {
    if (!editing) return;
    setSaving(true);
    const ok = await criarMasterVinculado(editing.id);
    setSaving(false);
    if (!ok) return;
    toast.success("Master criado e vinculado à região");
    setMasterForm({ nome: "", email: "", password: "" });
    setCriarMasterJunto(false);
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar região" : "Nova região"}</DialogTitle>
            <DialogDescription>
              Ex.: "Gramado e Canela", "Hotel Valley", "Recife". Cada região tem seus próprios masters, salas e estoque.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={nome} onChange={(e) => setNome(e.target.value)} autoFocus placeholder="Nome da região" />
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

            {/* NA CRIAÇÃO: opção de criar master junto */}
            {!editing && (
              <div className="rounded-md border p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input type="checkbox" checked={criarMasterJunto} onChange={(e) => setCriarMasterJunto(e.target.checked)} />
                  <UserPlus className="size-4 text-primary" /> Criar master responsável junto
                </label>
                {criarMasterJunto && (
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={masterForm.nome} onChange={(e) => setMasterForm({ ...masterForm, nome: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">E-mail</Label><Input type="email" value={masterForm.email} onChange={(e) => setMasterForm({ ...masterForm, email: e.target.value })} /></div>
                    <div className="space-y-1"><Label className="text-xs">Senha provisória</Label><Input type="password" value={masterForm.password} onChange={(e) => setMasterForm({ ...masterForm, password: e.target.value })} /></div>
                  </div>
                )}
              </div>
            )}

            {/* NA EDIÇÃO: gestão dos masters desta região */}
            {editing && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Users className="size-4 text-primary" /> Masters desta região
                </div>

                <div className="space-y-1">
                  {mastersDaRegiao.length === 0 && (
                    <div className="text-xs text-muted-foreground py-1">Nenhum master vinculado ainda.</div>
                  )}
                  {mastersDaRegiao.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{m.nome}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{m.email}</div>
                      </div>
                      <Button variant="ghost" size="icon" title="Remover vínculo" onClick={() => desvincularMaster(m)}>
                        <X className="size-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t space-y-2">
                  <Label className="text-xs">Vincular master existente</Label>
                  <div className="flex gap-2">
                    <Select value={linkExistingId} onValueChange={setLinkExistingId}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um master..." /></SelectTrigger>
                      <SelectContent>
                        {mastersDisponiveis.length === 0 && <div className="px-3 py-2 text-xs text-muted-foreground">Todos os masters já estão vinculados.</div>}
                        {mastersDisponiveis.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.nome} · {m.email}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={vincularMasterExistente} disabled={!linkExistingId || linking}>
                      {linking ? <Loader2 className="size-4 animate-spin" /> : "Vincular"}
                    </Button>
                  </div>
                </div>

                <div className="pt-2 border-t space-y-2">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer">
                    <input type="checkbox" checked={criarMasterJunto} onChange={(e) => setCriarMasterJunto(e.target.checked)} />
                    <UserPlus className="size-3.5 text-primary" /> Criar novo master vinculado a esta região
                  </label>
                  {criarMasterJunto && (
                    <div className="space-y-2 pl-6">
                      <div className="space-y-1"><Label className="text-xs">Nome</Label><Input value={masterForm.nome} onChange={(e) => setMasterForm({ ...masterForm, nome: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">E-mail</Label><Input type="email" value={masterForm.email} onChange={(e) => setMasterForm({ ...masterForm, email: e.target.value })} /></div>
                      <div className="space-y-1"><Label className="text-xs">Senha provisória</Label><Input type="password" value={masterForm.password} onChange={(e) => setMasterForm({ ...masterForm, password: e.target.value })} /></div>
                      <Button size="sm" onClick={criarNovoMasterNaEdicao} disabled={saving}>
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                        Criar e vincular
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
            <Button onClick={salvar} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
