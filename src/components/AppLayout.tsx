import { ReactNode, useEffect, useMemo, useState, useCallback } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes, LayoutDashboard, Building2, Users, Package, Inbox, ArrowLeftRight,
  Wallet, BarChart3, History, LogOut, Send, ShieldCheck, ClipboardList, Loader2, UserCircle, Tag, ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { MasterScopeProvider, useMasterScope } from "@/contexts/MasterScopeContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import NotificationsBell from "@/components/NotificationsBell";
import MasterScopeSwitcher from "@/components/MasterScopeSwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

type BadgeKey = "requisicoes" | "emprestimosAprovar";
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
          { to: "/app/dividas", label: "Dívidas", icon: Wallet },
        ],
      },
      { to: "/app/usuarios", label: "Usuários", icon: Users },
      { to: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/app/movimentacoes", label: "Movimentações", icon: History },
      { to: "/app/meu-perfil", label: "Meu Perfil", icon: UserCircle },
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
    { to: "/app/meu-perfil", label: "Meu Perfil", icon: UserCircle },
  ];
  return base;
}

const ROLE_LABEL: Record<string, string> = { master: "Master", admin: "Administrador", analista: "Analista" };

export default function AppLayout() {
  return (
    <MasterScopeProvider>
      <NotificationsProvider>
        <AppLayoutInner />
      </NotificationsProvider>
    </MasterScopeProvider>
  );
}

function AppLayoutInner() {
  const { user, role, profile, loading, signOut } = useAuth();
  const { scopeReady, scopeSalaId } = useMasterScope();
  const navigate = useNavigate();
  const location = useLocation();
  const [pendCounts, setPendCounts] = useState({ requisicoes: 0, emprestimosAprovar: 0 });

  const items = useMemo(() => navForRole(role, scopeSalaId === null), [role, scopeSalaId]);

  // Carrega contadores de pendências para badges
  const loadCounts = useCallback(async () => {
    if (!role) return;
    if (role === "master") {
      let q = supabase.from("solicitacoes").select("id", { count: "exact", head: true }).eq("status", "pendente");
      if (scopeSalaId) q = q.eq("sala_id", scopeSalaId);
      const { count } = await q;
      setPendCounts((p) => ({ ...p, requisicoes: count ?? 0 }));
    } else if (role === "admin" && profile?.sala_id) {
      const { count } = await supabase
        .from("emprestimos")
        .select("id", { count: "exact", head: true })
        .eq("status", "pendente")
        .eq("sala_origem_id", profile.sala_id);
      setPendCounts((p) => ({ ...p, emprestimosAprovar: count ?? 0 }));
    }
  }, [role, scopeSalaId, profile?.sala_id]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts, location.pathname]);

  // Atualização em tempo real dos badges do menu
  useRealtimeSync(["solicitacoes", "emprestimos"], loadCounts, { debounceMs: 250 });

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
          <div className="size-9 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground">
            <Boxes className="size-5" />
          </div>
          <div>
            <div className="font-display font-bold text-sidebar-accent-foreground">Estoque Pro</div>
            <div className="text-xs text-sidebar-foreground/70">{ROLE_LABEL[role]}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {items.map(({ to, label, icon: Icon, badgeKey }) => {
            const count = badgeKey ? pendCounts[badgeKey] : 0;
            return (
              <NavLink
                key={to}
                to={to}
                end={to === "/app"}
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
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <Badge className="bg-warning text-warning-foreground hover:bg-warning border-transparent h-5 min-w-5 px-1.5 text-[10px]">
                    {count}
                  </Badge>
                )}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 border-t border-sidebar-border space-y-2">
          <div className="px-2">
            <div className="text-sm font-medium text-sidebar-accent-foreground truncate">{profile?.nome}</div>
            <div className="text-xs text-sidebar-foreground/70 truncate">{profile?.email}</div>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground" onClick={handleSignOut}>
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-4 md:px-8 gap-3">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground">
              <Boxes className="size-4" />
            </div>
            <span className="font-display font-bold">Estoque Pro</span>
          </div>
          <div className="hidden md:block text-sm text-muted-foreground">Painel · {ROLE_LABEL[role]}</div>
          <div className="flex items-center gap-3 ml-auto">
            {role === "master" && <MasterScopeSwitcher />}
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
