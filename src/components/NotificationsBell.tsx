import { Bell, BellOff, Volume2, VolumeX, Inbox, ArrowLeftRight, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}min atrás`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h atrás`;
  const d = Math.floor(h / 24);
  return `${d}d atrás`;
}

export default function NotificationsBell() {
  const { role } = useAuth();
  const { requisicoes, emprestimosPendentes, emprestimosAprovados, totalCount, soundEnabled, toggleSound } = useNotifications();
  const navigate = useNavigate();

  const goRequisicoes = () => navigate("/app/requisicoes");
  const goEmprestimosMaster = () => navigate("/app/emprestimos");
  const goAprovar = () => navigate("/app/aprovar-emprestimos");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificações">
          {totalCount > 0 ? <Bell className="size-5 text-warning" /> : <Bell className="size-5" />}
          {totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold grid place-items-center animate-pulse">
              {totalCount > 99 ? "99+" : totalCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-display font-semibold">Notificações</div>
          <Button variant="ghost" size="icon" onClick={toggleSound} title={soundEnabled ? "Desativar som" : "Ativar som"}>
            {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4 text-muted-foreground" />}
          </Button>
        </div>

        <ScrollArea className="max-h-[420px]">
          {totalCount === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              <BellOff className="size-6 mx-auto mb-2 opacity-50" />
              Nenhuma pendência no momento
            </div>
          ) : (
            <div className="py-2">
              {role === "master" && requisicoes.length > 0 && (
                <Section
                  title="Requisições pendentes"
                  count={requisicoes.length}
                  icon={<Inbox className="size-4 text-destructive" />}
                  onSeeAll={goRequisicoes}
                >
                  {requisicoes.slice(0, 5).map((r) => (
                    <Item
                      key={r.id}
                      title={`Sala: ${r.sala_nome}`}
                      subtitle={`Por ${r.usuario_nome} · ${timeAgo(r.created_at)}`}
                      onClick={goRequisicoes}
                    />
                  ))}
                </Section>
              )}

              {emprestimosPendentes.length > 0 && (
                <Section
                  title={role === "master" ? "Empréstimos pendentes" : "Pedidos de empréstimo recebidos"}
                  count={emprestimosPendentes.length}
                  icon={<ArrowLeftRight className="size-4 text-warning" />}
                  onSeeAll={role === "master" ? goEmprestimosMaster : goAprovar}
                >
                  {emprestimosPendentes.slice(0, 5).map((e) => (
                    <Item
                      key={e.id}
                      title={`${e.sala_destino_nome} → ${e.sala_origem_nome}`}
                      subtitle={`Por ${e.solicitante_nome} · ${timeAgo(e.created_at)}`}
                      onClick={role === "master" ? goEmprestimosMaster : goAprovar}
                    />
                  ))}
                </Section>
              )}

              {role === "master" && emprestimosAprovados.length > 0 && (
                <Section
                  title="Empréstimos aprovados (aguardando arquivamento)"
                  count={emprestimosAprovados.length}
                  icon={<CheckCircle2 className="size-4 text-success" />}
                  onSeeAll={goEmprestimosMaster}
                >
                  {emprestimosAprovados.slice(0, 5).map((e) => (
                    <Item
                      key={e.id}
                      title={`${e.sala_origem_nome} → ${e.sala_destino_nome}`}
                      subtitle={`Por ${e.solicitante_nome} · ${timeAgo(e.created_at)}`}
                      onClick={goEmprestimosMaster}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function Section({
  title, count, icon, children, onSeeAll,
}: { title: string; count: number; icon: React.ReactNode; children: React.ReactNode; onSeeAll: () => void }) {
  return (
    <div className="mb-1">
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{title}</span>
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">{count}</Badge>
        </div>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onSeeAll}>Ver agora</Button>
      </div>
      <div>{children}</div>
      <Separator className="my-1" />
    </div>
  );
}

function Item({ title, subtitle, onClick }: { title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-2 hover:bg-muted/60 transition-colors"
    >
      <div className="text-sm font-medium truncate">{title}</div>
      <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
    </button>
  );
}
