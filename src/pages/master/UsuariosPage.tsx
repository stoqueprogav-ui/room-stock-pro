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

type UserRow = { id: string; nome: string; email: string; sala_id: string | null; role: AppRole; must_change_password?: boolean; sala?: { nome: string } | null };

export default function UsuariosPage() {
  const { profile } = useAuth();
  const { scopeSalaId } = useMasterScope();
  const isGlobal = scopeSalaId === null;
  const [users, setUsers] = useState<UserRow[]>([]);
  const [salas, setSalas] = useState<Sala[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", password: "", role: "analista" as AppRole, sala_id: "" });
  const [saving, setSaving] = useState(false);
  const [createdInfo, setCreatedInfo] = useState<{ nome: string; email: string; password: string } | null>(null);
  const [resetOpen, setResetOpen] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [resetting, setResetting] = useState(false);

  const load = async () => {
    const [{ data: profs }, { data: roles }, { data: ss }] = await Promise.all([
      supabase.from("profiles").select("id, nome, email, sala_id, must_change_password, sala:salas(nome)"),
      supabase.from("user_roles").select("user_id, role"),
      supabase.from("salas").select("*").order("nome"),
    ]);
    const order: AppRole[] = ["master", "admin", "analista"];
    const list: UserRow[] = (profs ?? []).map((p: any) => {
      const userRoles = (roles ?? []).filter((r: any) => r.user_id === p.id).map((r: any) => r.role);
      const role = (order.find((o) => userRoles.includes(o)) ?? "analista") as AppRole;
      return { ...p, role };
    });
    list.sort((a, b) => a.nome.localeCompare(b.nome));
    setUsers(list);
    setSalas((ss as Sala[]) ?? []);
  };
  useEffect(() => { load(); }, []);

  // Lista visível conforme escopo: em sala específica, mostra masters + usuários daquela sala
  const visibleUsers = useMemo(() => {
    if (isGlobal) return users;
    return users.filter((u) => u.role === "master" || u.sala_id === scopeSalaId);
  }, [users, isGlobal, scopeSalaId]);

  const salaAtualNome = useMemo(
    () => (scopeSalaId ? salas.find((s) => s.id === scopeSalaId)?.nome : null),
    [scopeSalaId, salas]
  );

  const openNovo = () => {
    // Em sala específica, pré-vincula automaticamente
    setForm({ nome: "", email: "", password: "", role: "analista", sala_id: isGlobal ? "" : (scopeSalaId ?? "") });
    setOpen(true);
  };

  const criar = async () => {
    if (!form.email || !form.password || !form.nome) return toast.error("Preencha nome, email e senha");
    if (form.role !== "master" && !form.sala_id) return toast.error("Admin/Analista exige sala");
    setSaving(true);
    const { data, error } = await supabase.functions.invoke("admin-create-user", {
      body: {
        nome: form.nome,
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        sala_id: form.role === "master" ? null : form.sala_id,
      },
    });
    setSaving(false);
    if (error || (data as any)?.error) {
      return toast.error((data as any)?.error ?? error?.message ?? "Falha ao criar");
    }
    // Master continua logado — não trocamos sessão
    setCreatedInfo({ nome: form.nome, email: form.email.trim(), password: form.password });
    setOpen(false);
    setForm({ nome: "", email: "", password: "", role: "analista", sala_id: "" });
    setTimeout(load, 400);
  };

  const updateRole = async (u: UserRow, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", u.id);
    const { error } = await supabase.from("user_roles").insert({ user_id: u.id, role: newRole });
    if (error) return toast.error(error.message);
    toast.success("Perfil atualizado"); load();
  };

  const updateSala = async (u: UserRow, salaId: string | null) => {
    const { error } = await supabase.from("profiles").update({ sala_id: salaId }).eq("id", u.id);
    if (error) return toast.error(error.message);
    toast.success("Sala atualizada"); load();
  };

  const remover = async (u: UserRow) => {
    const { error } = await supabase.functions.invoke("admin-delete-user", {
      body: { target_user_id: u.id },
    });
    if (error) return toast.error(error.message);
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
                  <Select
                    value={u.sala_id ?? "none"}
                    onValueChange={(v) => updateSala(u, v === "none" ? null : v)}
                    disabled={u.role === "master"}
                  >
                    <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— sem sala —</SelectItem>
                      {salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
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
            <div className="space-y-2"><Label>Nome</Label><Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
            <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-2"><Label>Senha provisória</Label><Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Perfil</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Em modo sala, não permite criar Master por aqui (Master é global) */}
                    {isGlobal && <SelectItem value="master">Master</SelectItem>}
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="analista">Analista</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Sala</Label>
                <Select
                  value={form.sala_id}
                  onValueChange={(v) => setForm({ ...form, sala_id: v })}
                  disabled={form.role === "master" || !isGlobal}
                >
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{salas.map((s) => <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
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
    </div>
  );
}
