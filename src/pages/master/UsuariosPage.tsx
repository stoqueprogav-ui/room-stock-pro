import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Trash2, Globe2, Building2, KeyRound } from "lucide-react";
import { RoleBadge } from "@/components/StatusBadge";
import type { Sala, AppRole } from "@/lib/types";
import { useAuth } from "@/contexts/AuthContext";
import { useMasterScope } from "@/contexts/MasterScopeContext";
import CompanyLogoUploader from "@/components/CompanyLogoUploader";
import { Checkbox } from "@/components/ui/checkbox";
import UserSalasDialog from "@/components/UserSalasDialog";

type UserRow = { id: string; nome: string; email: string; sala_id: string | null; role: AppRole; must_change_password?: boolean; sala?: { nome: string } | null; salas_count?: number; sala_ids?: string[] };

export default function UsuariosPage() {
  const { profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const isGlobal = scopeSalaId === null;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", password: "", role: "analista" as AppRole, salas: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ nome: string; email: string; password: string } | null>(null);
  const [resetOpen, setResetOpen] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetting, setResetting] = useState(false);
  const [salasDialog, setSalasDialog] = useState<UserRow | null>(null);

  const load = async () => {
    const [{ data: profs }, { data: roles }, { data: ss }, { data: us }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, sala_id, must_change_password, sala:salas(nome)"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("salas").select("*").order("nome"),
      supabase.from("user_salas").select("user_id, sala_id"),
    ]);
    const order: AppRole[] = ["master", "admin", "analista"];
    const counts = new Map<string, number>();
    const salasByUser = new Map<string, string[]>();
    (us ?? []).forEach((r: any) => {
      counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
      salasByUser.set(r.user_id, [...(salasByUser.get(r.user_id) ?? []), r.sala_id]);
    });
    const list: UserRow[] = (profs ?? []).map((p: any) => {
      const userRoles = (roles ?? []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role);
      const role = (order.find((o) => userRoles.includes(o)) ?? "analista") as AppRole;
      return { ...p, role, salas_count: counts.get(p.id) ?? 0, sala_ids: salasByUser.get(p.id) ?? [] };
    });
    list.sort((a, b) => a.nome.localeCompare(b.nome));
    setUsers(list);
    setSalas((ss as Sala[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  // Lista visível conforme escopo: em sala específica, mostra masters + usuários daquela sala
  const visibleUsers = useMemo(() => {
    if (isGlobal) return users;
    return users.filter((u) => u.role === "master" || u.sala_ids?.includes(scopeSalaId ?? ""));
  }, [users, isGlobal, scopeSalaId]);

  const salaAtualNome = useMemo(
    () => (scopeSalaId ? salas.find((s) => s.id === scopeSalaId)?.nome : null),
    [scopeSalaId, salas]
  );

  const openNovo = () => {
    // Em sala específica, pré-vincula automaticamente
    setForm({ nome: "", email: "", password: "", role: "analista", salas: isGlobal ? [] : (scopeSalaId ? [scopeSalaId] : []) });
    setOpen(true);
  };

  const toggleFormSala = (id: string) => {
    setForm((f) => ({ ...f, salas: f.salas.includes(id) ? f.salas.filter((x) => x !== id) : [...f.salas, id] }));
  };

  const criar = async () => {
    if (!form.email || !form.password || !form.nome) return toast.error("Preencha nome, email e senha");
    if (form.role !== "master" && form.salas.length === 0) return toast.error("Selecione ao menos uma sala");
    setSaving(true);
    const primary = form.role === "master" ? null : form.salas[0];
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        nome: form.nome,
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        sala_id: primary,
      },
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string; step?: string; user_id?: string };
    if (error) { setSaving(false); return toast.error(`Erro de rede: ${error.message}`); }
    if (!payload.ok) { setSaving(false); return toast.error(payload.error ?? "Falha ao criar usuário"); }
    // Atribui todas as salas autorizadas
    if (form.role !== "master" && payload.user_id) {
      await supabase.rpc("admin_set_user_salas", { _user: payload.user_id, _salas: form.salas });
    }
    setSaving(false);
    setCreatedInfo({ nome: form.nome, email: form.email.trim(), password: form.password });
    setOpen(false);
    setForm({ nome: "", email: "", password: "", role: "analista", salas: [] });
    setTimeout(load, 400);
  };

  const updateRole = async (u: UserRow, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", u.id);
    const { error } = await supabase.from("user_roles").insert({ user_id: u.id, role: newRole });
    if (error) return toast.error(error.message);
    toast.success("Perfil atualizado"); load();
  };


  const remover = async (u: UserRow) => {
    const { data, error } = await supabase.functions.invoke("admin-delete-user", {
      body: { target_user_id: u.id },
    });
    const payload = (data ?? {}) as { ok?: boolean; error?: string };
    if (error) return toast.error(`Erro de rede: ${error.message}`);
    if (!payload.ok) return toast.error(payload.error ?? "Falha ao excluir");
    toast.success("Usuário excluído permanentemente");
    load();
  };

  const resetarSenha = async () => {
    if (!resetOpen) return;
    if (resetPwd.length < 6) return toast.error("Senha deve ter ao menos 6 caracteres");
    setResetting(true);
    const { error } = await supabase.functions.invoke("admin-reset-password", {
      body: { target_user_id: resetOpen.id, new_password: resetPwd },
    });
    setResetting(false);
    if (error) return toast.error(error.message);
    toast.success("Senha redefinida. Usuário deverá trocar no próximo login.");
    setResetOpen(null);
    setResetPwd("");
    load();
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuários"
        description={
          isGlobal
            ? "Gestão global de contas, perfis e vínculo com salas."
            : `Usuários da sala ${salaAtualNome ?? "—"} (e administradores Master).`
        }
        actions={
          <Button onClick={openNovo}>
            <Plus className="size-4" /> Novo usuário
          </Button>
        }
      />
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {isGlobal
          ? <><Globe2 className="size-3.5 text-primary" /> Modo global — você vê todos os usuários do sistema.</>
          : <><Building2 className="size-3.5 text-primary" /> Sala em foco — apenas usuários vinculados a esta sala.</>}
      </div>
      {isGlobal && <CompanyLogoUploader />}
      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead className="w-[180px]">Perfil</TableHead>
              <TableHead className="w-[200px]">Sala</TableHead>
              <TableHead className="w-[120px]">Status</TableHead>
              <TableHead className="w-[140px] text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleUsers.map((u) => (
              <TableRow key={u.id} className="table-row-hover">
                <TableCell className="font-medium flex items-center gap-2">{u.nome} {u.id === profile?.id && <span className="text-xs text-muted-foreground">(você)</span>}</TableCell>
                <TableCell className="text-muted-foreground">{u.email}</TableCell>
                <TableCell>
                  <Select value={u.role} onValueChange={(v) => updateRole(u, v as AppRole)} disabled={u.id === profile?.id}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="master">Master</SelectItem>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="analista">Analista</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  {u.role === "master" ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Globe2 className="size-3.5" /> Todas as salas</span>
                  ) : (
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setSalasDialog(u)}>
                      <Building2 className="size-3.5" />
                      {u.salas_count ? `${u.salas_count} sala${u.salas_count > 1 ? "s" : ""}` : "Definir salas"}
                    </Button>
                  )}
                </TableCell>
                <TableCell>
                  {u.must_change_password ? (
                    <span className="inline-flex items-center rounded-full bg-warning/15 text-warning px-2 py-0.5 text-xs font-medium">Trocar senha</span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-success/15 text-success px-2 py-0.5 text-xs font-medium">Ativo</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {u.id !== profile?.id && (
                      <Button variant="ghost" size="icon" title="Redefinir senha" onClick={() => { setResetOpen(u); setResetPwd(""); }}>
                        <KeyRound className="size-4 text-primary" />
                      </Button>
                    )}
                    {u.id !== profile?.id && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon"><Trash2 className="size-4 text-destructive" /></Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Excluir permanentemente {u.nome}?</AlertDialogTitle>
                            <AlertDialogDescription>O usuário será removido do sistema, perderá o login e o acesso. O histórico de movimentações é preservado para auditoria. Esta ação é irreversível.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction onClick={() => remover(u)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Excluir definitivamente</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {!isGlobal && (
              <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Building2 className="size-3.5 text-primary" />
                Será vinculado automaticamente à sala <span className="font-medium text-foreground">{salaAtualNome}</span>.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {isGlobal && <SelectItem value="master">Master</SelectItem>}
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="analista">Analista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Senha provisória</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            {form.role !== "master" && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2"><Building2 className="size-3.5 text-primary" /> Salas autorizadas</Label>
                <div className="max-h-48 overflow-y-auto rounded-md border p-2 space-y-1">
                  {salas.length === 0 && <div className="text-xs text-muted-foreground px-2 py-2">Nenhuma sala cadastrada.</div>}
                  {salas.map((s) => (
                    <label key={s.id} className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50 cursor-pointer">
                      <Checkbox
                        checked={form.salas.includes(s.id)}
                        onCheckedChange={() => toggleFormSala(s.id)}
                        disabled={!isGlobal && s.id !== scopeSalaId && !form.salas.includes(s.id)}
                      />
                      <span className="text-sm flex-1">{s.nome}</span>
                    </label>
                  ))}
                </div>
                <div className="text-xs text-muted-foreground">{form.salas.length} sala{form.salas.length === 1 ? "" : "s"} selecionada{form.salas.length === 1 ? "" : "s"}.</div>
              </div>
            )}
            <div className="text-xs text-muted-foreground flex items-center gap-2">Pré-visualização: <RoleBadge role={form.role} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={criar} disabled={saving}>{saving ? "Criando…" : "Criar usuário"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetOpen} onOpenChange={(o) => !o && setResetOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Redefinir senha de {resetOpen?.nome}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Defina uma nova senha provisória. O usuário será obrigado a trocá-la no próximo login.</p>
            <div className="space-y-2">
              <Label>Nova senha provisória</Label>
              <Input type="password" value={resetPwd} onChange={(e) => setResetPwd(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(null)}>Cancelar</Button>
            <Button onClick={resetarSenha} disabled={resetting}>{resetting ? "Salvando…" : "Redefinir"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!createdInfo} onOpenChange={(o) => !o && setCreatedInfo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Usuário criado com sucesso</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">Sua sessão Master não foi alterada. Envie estas credenciais ao novo usuário — ele deverá trocar a senha no primeiro login.</p>
            <div className="rounded-md border bg-muted/30 p-3 space-y-1 font-mono text-xs">
              <div><span className="text-muted-foreground">Nome:</span> {createdInfo?.nome}</div>
              <div><span className="text-muted-foreground">Login:</span> {createdInfo?.email}</div>
              <div><span className="text-muted-foreground">Senha provisória:</span> {createdInfo?.password}</div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreatedInfo(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UserSalasDialog
        open={!!salasDialog}
        onOpenChange={(o) => !o && setSalasDialog(null)}
        userId={salasDialog?.id ?? null}
        userNome={salasDialog?.nome}
        salas={salas}
        onSaved={load}
      />
    </div>
  );
}
