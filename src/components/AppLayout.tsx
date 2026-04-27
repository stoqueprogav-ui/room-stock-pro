import { ReactNode, useMemo } from "react";
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Boxes, LayoutDashboard, Building2, Users, Package, Inbox, ArrowLeftRight,
  Wallet, BarChart3, History, LogOut, Send, ShieldCheck, ClipboardList, Loader2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { MasterScopeProvider, useMasterScope } from "@/contexts/MasterScopeContext";
import MasterScopeSwitcher from "@/components/MasterScopeSwitcher";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type NavItem = { to: string; label: string; icon: React.ComponentType<{ className?: string }> };

function navForRole(role: string | null): NavItem[] {
  if (role === "master") {
    return [
      { to: "/app", label: "Visão geral", icon: LayoutDashboard },
      { to: "/app/salas", label: "Salas", icon: Building2 },
      { to: "/app/produtos", label: "Produtos", icon: Package },
      { to: "/app/estoque", label: "Estoque", icon: Boxes },
      { to: "/app/solicitacoes", label: "Solicitações", icon: Inbox },
      { to: "/app/emprestimos", label: "Empréstimos", icon: ArrowLeftRight },
      { to: "/app/dividas", label: "Dívidas", icon: Wallet },
      { to: "/app/usuarios", label: "Usuários", icon: Users },
      { to: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
      { to: "/app/movimentacoes", label: "Movimentações", icon: History },
    ];
  }
  // admin & analista
  const base: NavItem[] = [
    { to: "/app", label: "Visão geral", icon: LayoutDashboard },
    { to: "/app/meu-estoque", label: "Meu estoque", icon: Boxes },
    { to: "/app/nova-solicitacao", label: "Solicitar ao Master", icon: Send },
    { to: "/app/minhas-solicitacoes", label: "Minhas solicitações", icon: ClipboardList },
    { to: "/app/novo-emprestimo", label: "Pedir empréstimo", icon: ArrowLeftRight },
    { to: "/app/emprestimos", label: "Empréstimos", icon: ArrowLeftRight },
    { to: "/app/dividas", label: "Dívidas da sala", icon: Wallet },
    { to: "/app/movimentacoes", label: "Movimentações", icon: History },
  ];
  if (role === "admin") {
    base.splice(5, 0, { to: "/app/aprovar-emprestimos", label: "Aprovar empréstimos", icon: ShieldCheck });
  }
  return base;
}

const ROLE_LABEL: Record<string, string> = { master: "Master", admin: "Administrador", analista: "Analista" };

export default function AppLayout() {
  const { user, role, profile, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const items = useMemo(() => navForRole(role), [role]);

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
          {items.map(({ to, label, icon: Icon }) => (
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
              {label}
            </NavLink>
          ))}
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
        <header className="h-14 border-b border-border bg-card/60 backdrop-blur flex items-center justify-between px-4 md:px-8">
          <div className="md:hidden flex items-center gap-2">
            <div className="size-8 rounded-md bg-gradient-primary grid place-items-center text-primary-foreground">
              <Boxes className="size-4" />
            </div>
            <span className="font-display font-bold">Estoque Pro</span>
          </div>
          <div className="hidden md:block text-sm text-muted-foreground">Painel · {ROLE_LABEL[role]}</div>
          <div className="flex items-center gap-3">
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
