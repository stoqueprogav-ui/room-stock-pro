import { Bell, BellOff, Volume2, VolumeX, Inbox, ArrowLeftRight, CheckCircle2, Check, X, RotateCcw, History, MessageCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

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

type Alert = {
  id: string;
  kind: "requisicao" | "emprestimo_pendente" | "emprestimo_aprovado" | "chat";
  title: string;
  subtitle: string;
  created_at: string;
  go: () => void;
};

export default function NotificationsBell() {
  const { role } = useAuth();
  const {
    requisicoes, emprestimosPendentes, emprestimosAprovados, chatAlerts,
    totalCount, soundEnabled, toggleSound,
    isRead, isDismissed, markRead, markUnread, dismiss, restore,
    markAllRead,
  } = useNotifications();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"ativos" | "historico">("ativos");

  const goRequisicoes = () => navigate("/app/requisicoes");
  const goEmprestimosMaster = () => navigate("/app/emprestimos");
  const goAprovar = () => navigate("/app/aprovar-emprestimos");

  const alerts: Alert[] = useMemo(() => {
    const arr: Alert[] = [];
    if (role === "master") {
      for (const r of requisicoes) {
        arr.push({
          id: r.id, kind: "requisicao",
          title: `Requisição · ${r.sala_nome}`,
          subtitle: `Por ${r.usuario_nome} · ${timeAgo(r.created_at)}`,
          created_at: r.created_at, go: goRequisicoes,
        });
      }
    }
    for (const e of emprestimosPendentes) {
      arr.push({
        id: e.id, kind: "emprestimo_pendente",
        title: `Empréstimo · ${e.sala_destino_nome} → ${e.sala_origem_nome}`,
        subtitle: `Por ${e.solicitante_nome} · ${timeAgo(e.created_at)}`,
        created_at: e.created_at,
        go: role === "master" ? goEmprestimosMaster : goAprovar,
      });
    }
    if (role === "master") {
      for (const e of emprestimosAprovados) {
        arr.push({
          id: e.id, kind: "emprestimo_aprovado",
          title: `Aprovado · ${e.sala_origem_nome} → ${e.sala_destino_nome}`,
          subtitle: `Aguardando arquivamento · ${timeAgo(e.created_at)}`,
          created_at: e.created_at, go: goEmprestimosMaster,
        });
      }
    }
    for (const c of chatAlerts) {
      arr.push({
        id: c.id,
        kind: "chat",
        title: `💬 ${c.sender_nome}`,
        subtitle: `${c.preview} · ${timeAgo(c.created_at)}${c.unread_count > 1 ? ` · ${c.unread_count} novas` : ""}`,
        created_at: c.created_at,
        go: () => {
          const onChatPage = window.location.pathname.startsWith("/app/chat");
          if (onChatPage) {
            navigate(`/app/chat?c=${c.conversation_id}`);
          } else {
            window.dispatchEvent(new CustomEvent("floating-chat:open", { detail: { conversationId: c.conversation_id } }));
          }
        },
      });
    }
    arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, requisicoes, emprestimosPendentes, emprestimosAprovados, chatAlerts]);

  const ativos = alerts.filter((a) => !isDismissed(a.id));
  const historico = alerts; // tudo (inclui fechados) — pendência segue listada

  const iconFor = (k: Alert["kind"]) => {
    if (k === "requisicao") return <Inbox className="size-4 text-destructive" />;
    if (k === "emprestimo_pendente") return <ArrowLeftRight className="size-4 text-warning" />;
    if (k === "chat") return <MessageCircle className="size-4 text-primary" />;
    return <CheckCircle2 className="size-4 text-success" />;
  };

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
      <PopoverContent align="end" className="w-[400px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-display font-semibold">Notificações</div>
          <div className="flex items-center gap-1">
            {alerts.some((a) => !isRead(a.id)) && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead} title="Marcar todos como lidos">
                <Check className="size-3.5" /> Tudo lido
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggleSound} title={soundEnabled ? "Desativar som" : "Ativar som"}>
              {soundEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4 text-muted-foreground" />}
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <div className="px-3 pt-2">
            <TabsList className="grid grid-cols-2 w-full h-8">
              <TabsTrigger value="ativos" className="text-xs h-6">
                Ativos {ativos.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">{ativos.length}</Badge>}
              </TabsTrigger>
              <TabsTrigger value="historico" className="text-xs h-6">
                <History className="size-3 mr-1" /> Histórico {historico.length > 0 && <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[9px]">{historico.length}</Badge>}
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="ativos" className="m-0">
            <ScrollArea className="max-h-[420px]">
              {ativos.length === 0 ? (
                <Empty />
              ) : (
                <div className="py-1">
                  {ativos.map((a) => (
                    <Item
                      key={a.id}
                      icon={iconFor(a.kind)}
                      title={a.title}
                      subtitle={a.subtitle}
                      read={isRead(a.id)}
                      onOpen={() => { markRead(a.id); a.go(); }}
                      onMarkRead={() => markRead(a.id)}
                      onMarkUnread={() => markUnread(a.id)}
                      onDismiss={() => dismiss(a.id)}
                    />
                  ))}
                  <Separator className="my-1" />
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="historico" className="m-0">
            <ScrollArea className="max-h-[420px]">
              {historico.length === 0 ? (
                <Empty />
              ) : (
                <div className="py-1">
                  {historico.map((a) => {
                    const dismissed = isDismissed(a.id);
                    return (
                      <Item
                        key={a.id}
                        icon={iconFor(a.kind)}
                        title={a.title}
                        subtitle={`${a.subtitle}${dismissed ? " · fechado" : ""}`}
                        read={isRead(a.id)}
                        muted={dismissed}
                        onOpen={() => { markRead(a.id); a.go(); }}
                        onMarkRead={() => markRead(a.id)}
                        onMarkUnread={() => markUnread(a.id)}
                        onDismiss={dismissed ? undefined : () => dismiss(a.id)}
                        onRestore={dismissed ? () => restore(a.id) : undefined}
                      />
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function Empty() {
  return (
    <div className="px-4 py-10 text-center text-sm text-muted-foreground">
      <BellOff className="size-6 mx-auto mb-2 opacity-50" />
      Nada por aqui
    </div>
  );
}

function Item({
  icon, title, subtitle, read, muted,
  onOpen, onMarkRead, onMarkUnread, onDismiss, onRestore,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  read: boolean;
  muted?: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onDismiss?: () => void;
  onRestore?: () => void;
}) {
  return (
    <div
      className={cn(
        "group px-3 py-2 flex items-start gap-2 hover:bg-muted/60 transition-colors border-l-2",
        !read && !muted ? "border-l-destructive bg-destructive/5" :
        read && !muted ? "border-l-warning/40" :
        "border-l-transparent opacity-60"
      )}
    >
      <div className="mt-0.5 shrink-0">{icon}</div>
      <button onClick={onOpen} className="flex-1 text-left min-w-0">
        <div className={cn("text-sm truncate", !read && !muted ? "font-semibold" : "font-medium")}>
          {!read && !muted && <span className="inline-block size-1.5 rounded-full bg-destructive mr-1.5 align-middle" />}
          {title}
        </div>
        <div className="text-xs text-muted-foreground truncate">{subtitle}</div>
      </button>
      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {!read ? (
          <Button size="icon" variant="ghost" className="size-7" onClick={onMarkRead} title="Marcar como lido">
            <Check className="size-3.5" />
          </Button>
        ) : (
          <Button size="icon" variant="ghost" className="size-7" onClick={onMarkUnread} title="Marcar como não lido">
            <RotateCcw className="size-3.5" />
          </Button>
        )}
        {onDismiss && (
          <Button size="icon" variant="ghost" className="size-7" onClick={onDismiss} title="Fechar (manter no histórico)">
            <X className="size-3.5" />
          </Button>
        )}
        {onRestore && (
          <Button size="icon" variant="ghost" className="size-7" onClick={onRestore} title="Reabrir alerta">
            <RotateCcw className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
