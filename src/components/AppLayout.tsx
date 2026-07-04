import { ReactNode, useEffect, useMemo, useState, useCallback } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes, LayoutDashboard, Building2, Users, Package, Inbox, ArrowLeftRight,
  Wallet, BarChart3, History, LogOut, Send, ShieldCheck, ClipboardList, Loader2, UserCircle, Tag, ChevronDown, MessageCircle, MapPin, Settings, Globe2, Trash2, ClipboardCheck, LineChart, Scale as ScaleIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { ActiveSalaProvider, useActiveSala } from "@/contexts/ActiveSalaContext";
import { MasterScopeProvider, useMasterScope } from "@/contexts/MasterScopeContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import NotificationsBell from "@/components/NotificationsBell";
import MasterScopeSwitcher from "@/components/MasterScopeSwitcher";
import ActiveSalaSwitcher from "@/components/ActiveSalaSwitcher";
import FloatingChat from "@/components/FloatingChat";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

type BadgeKey = "requisicoes" | "emprestimosAprovar" | "chat";
type ActiveSalaOption = { sala_id: string; sala_nome: string; ativa: boolean };
type NavItem = {
  to?: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: BadgeKey;
  children?: NavItem[];
};

function navForRole(role: string | null, isGlobalScope: boolean): NavItem[] {
  if (role === "master") {
    const items: NavItem[] = [
      { to: "/app", label: "Visão geral", icon: LayoutDashboard },
    ];
    if (isGlobalScope) {
      items.push({ to: "/app/salas", label: "Salas", icon: Building2 });
      items.push({ to: "/app/categorias", label: "Categorias", icon: Tag });
    }
    items.push(
      { to: "/app/produtos", label: "Produtos", icon: Package },
      { to: "/app/estoque", label: "Estoque", icon: Boxes },
      { to: "/app/requisicoes", label: "Requisições", icon: Inbox, badgeKey: "requisicoes" },
      {
        label: "Empréstimos", icon: ArrowLeftRight,
        children: [
          { to: "/app/emprestimos", label: "Todos os empréstimos", icon: ArrowLeftRight },
          { to: "/app/dividas", label: "Dívidas da Sala", icon: Wallet },
        ],
      },
      { to: "/app/consumo-interno", label: "Consumo Interno", icon: Trash2 },
      { to: "/app/inventario", label: "Inventário", icon: ClipboardCheck },
      
      { to: "/app/usuarios", label: "Usuários", icon: Users },
      {
        label: "Relatórios", icon: BarChart3,
        children: [
          { to: "/app/relatorios", label: "Central Analítica", icon: LineChart },
          { to: "/app/movimentacoes", label: "Movimentações", icon: History },
        ],
      },
      { to: "/app/chat", label: "Chat", icon: MessageCircle, badgeKey: "chat" },
      { to: "/app/meu-perfil", label: "Meu Perfil", icon: UserCircle },
      { to: "/app/configuracoes", label: "Configurações", icon: Settings },
    );
    return items;
  }
  // admin & analista
  const emprestimosChildren: NavItem[] = [
    { to: "/app/novo-emprestimo", label: "Pedir empréstimo", icon: Send },
  ];
  if (role === "admin") {
    emprestimosChildren.push({ to: "/app/aprovar-emprestimos", label: "Aprovar empréstimos", icon: ShieldCheck, badgeKey: "emprestimosAprovar" });
  }
  emprestimosChildren.push(
    { to: "/app/emprestimos", label: "Histórico", icon: History },
    { to: "/app/dividas", label: "Dívidas da sala", icon: Wallet },
  );
  const base: NavItem[] = [
    { to: "/app", label: "Visão geral", icon: LayoutDashboard },
    { to: "/app/meu-estoque", label: "Meu estoque", icon: Boxes },
    { to: "/app/nova-requisicao", label: "Realizar requisição", icon: Send },
    { to: "/app/minhas-requisicoes", label: "Minhas requisições", icon: ClipboardList },
    { label: "Empréstimos", icon: ArrowLeftRight, children: emprestimosChildren },
    { to: "/app/movimentacoes", label: "Movimentações", icon: History },
    { to: "/app/chat", label: "Chat", icon: MessageCircle, badgeKey: "chat" },
    { to: "/app/meu-perfil", label: "Meu Perfil", icon: UserCircle },
  ];
  return base;
}

const ROLE_LABEL: Record<string, string> = { master: "Master", admin: "Administrador", analista: "Analista" };

export default function AppLayout() {
  return (
    <MasterScopeProvider>
      <ActiveSalaProvider>
        <NotificationsProvider>
          <AppLayoutInner />
        </NotificationsProvider>
      </ActiveSalaProvider>
    </MasterScopeProvider>
  );
}

function AppLayoutInner() {
  const { user, role, profile, loading, signOut } = useAuth();
  const { activeSalaId, activeSalaName, loading: salaLoading, selectionRequired, salas, chooseSala } = useActiveSala();
  const { scopeReady, scopeSalaId } = useMasterScope();
  const navigate = useNavigate();
  const location = useLocation();
  const { logoUrl } = useCompanyLogo();
  const [pendCounts, setPendCounts] = useState({ requisicoes: 0, emprestimosAprovar: 0, chat: 0 });
  const [salaNome, setSalaNome] = useState<string | null>(null);

  const items = useMemo(() => navForRole(role, scopeSalaId === null), [role, scopeSalaId]);

  // Carrega nome da sala em foco (master) ou da sala do usuário (admin/analista)
  useEffect(() => {
    if (role !== "master") { setSalaNome(activeSalaName); return; }
    const targetSala = scopeSalaId;
    if (!targetSala) { setSalaNome(null); return; }
    supabase.from("salas").select("nome").eq("id", targetSala).maybeSingle()
      .then(({ data }) => setSalaNome((data as any)?.nome ?? null));
  }, [role, scopeSalaId, activeSalaName]);

  // Carrega contadores de pendências para badges
  const loadCounts = useCallback(async () => {
    if (!role) return;
    if (role === "master") {
      let q = supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "pendente");
      if (scopeSalaId) q = q.eq("sala_id", scopeSalaId);
      const { count } = await q;
      setPendCounts((p) => ({ ...p, requisicoes: count ?? 0 }));
    } else if (role === "admin" && activeSalaId) {
      const { count } = await supabase
        .from("emprestimos")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .eq("sala_origem_id", activeSalaId);
      setPendCounts((p) => ({ ...p, emprestimosAprovar: count ?? 0 }));
    }
    // contagem global de mensagens não lidas em conversas
    try {
      const { data } = await supabase.rpc("list_my_conversations");
      const total = (data ?? []).reduce((s: number, c: any) => s + (c.unread_count ?? 0), 0);
      setPendCounts((p) => ({ ...p, chat: total }));
    } catch { /* noop */ }
  }, [role, scopeSalaId, activeSalaId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, location.pathname]);

  // Atualização em tempo real dos badges do menu
  useRealtimeSync(["solicitacoes", "emprestimos", "messages"], loadCounts, { debounceMs: 250 });

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!role) {
    return (
      <div className="min-h-screen grid place-items-center bg-background p-6 text-center">
        <div className="max-w-sm space-y-3">
          <h2 className="font-display text-xl font-semibold">Sem permissão atribuída</h2>
          <p className="text-sm text-muted-foreground">Sua conta ainda não tem um perfil de acesso. Solicite ao Master.</p>
          <Button variant="outline" onClick={signOut}>Sair</Button>
        </div>
      </div>
    );
  }

  if (role !== "master" && salaLoading) {
    return (
      <div className="min-h-screen grid place-items-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (role !== "master" && selectionRequired) {
    return <SalaSelectionScreen nome={profile?.nome ?? ""} email={profile?.email ?? ""} salas={salas} onChoose={chooseSala} onSignOut={signOut} />;
  }

  // Força troca de senha no primeiro login / após reset pelo Master
  if (profile?.must_change_password && location.pathname !== "/app/trocar-senha") {
    return <Navigate to="/app/trocar-senha" replace />;
  }

  // Master: gate de seleção de sala antes de entrar no painel.
  const isPickRoute = location.pathname === "/app/escolher-sala";
  if (role === "master" && !scopeReady && !isPickRoute) {
    return <Navigate to="/app/escolher-sala" replace />;
  }
  if (isPickRoute) return <Outlet />;

  // Em modo sala específica, página de Salas é só global → redireciona
  if (role === "master" && scopeSalaId !== null && location.pathname.startsWith("/app/salas")) {
    return <Navigate to="/app" replace />;
  }

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-sidebar-border">
          <div className="size-9 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground overflow-hidden">
            {logoUrl ? <img src={logoUrl} alt="Logotipo do Estoque Pro" className="size-full object-contain" /> : <Boxes className="size-5" />}
          </div>
          <div>
            <div className="font-display font-bold text-sidebar-accent-foreground">Estoque Pro</div>
            <div className="text-xs text-sidebar-foreground/70">{ROLE_LABEL[role]}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {items.map((item) => (
            <NavItemRender key={item.to ?? item.label} item={item} pendCounts={pendCounts} currentPath={location.pathname} />
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-2 space-y-1.5">
            <div className="text-sm font-medium text-sidebar-accent-foreground truncate">{profile?.nome}</div>
            <div className="text-xs text-sidebar-foreground/70 truncate">{profile?.email}</div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium rounded-md bg-primary/15 text-primary px-2 py-1 border border-primary/20">
              {role === "master" && scopeSalaId === null
                ? <><Globe2 className="size-3" /> {ROLE_LABEL[role]} · Visão Global</>
                : <><MapPin className="size-3" /> {ROLE_LABEL[role]} · {salaNome ?? "Sem sala"}</>}
            </div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground" onClick={handleSignOut}>
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-4 md:px-8 gap-3">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground overflow-hidden">
              {logoUrl ? <img src={logoUrl} alt="Logotipo do Estoque Pro" className="size-full object-contain" /> : <Boxes className="size-4" />}
            </div>
            <span className="font-display font-bold">Estoque Pro</span>
          </div>
          <div className="hidden md:flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Usuário: <span className="text-foreground font-medium">{profile?.nome ?? "—"}</span></span>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground">Perfil: <span className="text-foreground font-medium">{ROLE_LABEL[role]}</span></span>
            <span className="text-muted-foreground/40">·</span>
            {role === "master" && scopeSalaId === null ? (
              <Badge className="bg-primary/15 text-primary border-primary/30 gap-1">
                <Globe2 className="size-3" /> Visão Global
              </Badge>
            ) : (
              <Badge className="bg-primary/15 text-primary border-primary/30 gap-1">
                <MapPin className="size-3" /> Sala Atual: {salaNome ?? "—"}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 ml-auto">
            {role === "master" ? <MasterScopeSwitcher /> : <ActiveSalaSwitcher />}
            <NotificationsBell />
            <Badge variant="secondary" className="hidden sm:inline-flex">{ROLE_LABEL[role]}</Badge>
            <Button variant="ghost" size="sm" onClick={handleSignOut} className="md:hidden">
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 md:p-8 animate-fade-in">
          <Outlet />
        </div>
      </main>
      <FloatingChat />
    </div>
  );
}

function SalaSelectionScreen({
  nome, email, salas, onChoose, onSignOut,
}: {
  nome: string;
  email: string;
  salas: ActiveSalaOption[];
  onChoose: (salaId: string) => Promise<boolean>;
  onSignOut: () => Promise<void>;
}) {
  const [choosing, setChoosing] = useState<string | null>(null);

  const escolher = async (salaId: string) => {
    setChoosing(salaId);
    const ok = await onChoose(salaId);
    if (!ok) setChoosing(null);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground">
              <Boxes className="size-5" />
            </div>
            <div>
              <div className="font-display font-bold">Estoque Pro</div>
              <div className="text-xs text-muted-foreground">{email}</div>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onSignOut}><LogOut className="size-4" /> Sair</Button>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 animate-fade-in">
        <div className="space-y-2 mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight uppercase">Selecione a sala</h1>
          <p className="text-lg text-foreground">Bem-vindo {nome || "usuário"}</p>
          <p className="text-muted-foreground">Escolha a sala que deseja acessar:</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {salas.map((s) => (
            <button
              key={s.sala_id}
              type="button"
              onClick={() => escolher(s.sala_id)}
              disabled={!!choosing}
              className="panel p-5 text-left group hover:border-primary/60 transition-colors disabled:opacity-70"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="size-10 rounded-md bg-muted grid place-items-center text-primary mb-3">
                    <Building2 className="size-5" />
                  </div>
                  <div className="font-display text-lg font-semibold">{s.sala_nome}</div>
                </div>
                {choosing === s.sala_id ? <Loader2 className="size-4 animate-spin text-primary" /> : <ChevronDown className="size-4 text-muted-foreground -rotate-90 group-hover:text-primary" />}
              </div>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="font-display text-2xl md:text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

function NavItemRender({
  item, pendCounts, currentPath,
}: {
  item: NavItem;
  pendCounts: Record<BadgeKey, number>;
  currentPath: string;
}) {
  const Icon = item.icon;
  const childPaths = (item.children ?? []).map((c) => c.to).filter(Boolean) as string[];
  const isInGroup = childPaths.some((p) => currentPath === p || currentPath.startsWith(p + "/"));
  const [open, setOpen] = useState(isInGroup);
  useEffect(() => { if (isInGroup) setOpen(true); }, [isInGroup]);

  if (!item.children) {
    const count = item.badgeKey ? pendCounts[item.badgeKey] : 0;
    return (
      <NavLink
        to={item.to!}
        end={item.to === "/app"}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          )
        }
      >
        <Icon className="size-4" />
        <span className="flex-1">{item.label}</span>
        {count > 0 && (
          <Badge className="bg-warning text-warning-foreground hover:bg-warning border-transparent h-5 min-w-5 px-1.5 text-[10px]">
            {count}
          </Badge>
        )}
      </NavLink>
    );
  }

  const groupCount = (item.children ?? []).reduce((sum, c) => sum + (c.badgeKey ? pendCounts[c.badgeKey] : 0), 0);

  return (
    <div className="space-y-0.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
          isInGroup
            ? "bg-sidebar-accent/40 text-sidebar-accent-foreground font-medium"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        )}
      >
        <Icon className="size-4" />
        <span className="flex-1 text-left">{item.label}</span>
        {groupCount > 0 && !open && (
          <Badge className="bg-warning text-warning-foreground hover:bg-warning border-transparent h-5 min-w-5 px-1.5 text-[10px]">
            {groupCount}
          </Badge>
        )}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="ml-4 pl-3 border-l border-sidebar-border space-y-0.5">
          {item.children!.map((child) => {
            const ChildIcon = child.icon;
            const count = child.badgeKey ? pendCounts[child.badgeKey] : 0;
            return (
              <NavLink
                key={child.to}
                to={child.to!}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                  )
                }
              >
                <ChildIcon className="size-3.5" />
                <span className="flex-1">{child.label}</span>
                {count > 0 && (
                  <Badge className="bg-warning text-warning-foreground hover:bg-warning border-transparent h-5 min-w-5 px-1.5 text-[10px]">
                    {count}
                  </Badge>
                )}
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
}
