import { Bell, BellOff, Volume2, VolumeX, Inbox, ArrowLeftRight, CheckCircle2, Check, X, RotateCcw, History, MessageCircle, PackageOpen, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useNotifications, NotificationCategory, NotificationRow, ChatAlert } from "@/contexts/NotificationsContext";
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
  category: NotificationCategory;
  title: string;
  subtitle: string;
  created_at: string;
  read: boolean;
  dismissed: boolean;
  go: () => void;
};

const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  requisicao: "Requisições",
  emprestimo: "Empréstimos",
  devolucao: "Devoluções",
  chat: "Chat",
  sistema: "Sistema",
  auditoria: "Auditoria",
};

export default function NotificationsBell() {
  const {
    notifications, chatAlerts,
    totalCount, soundEnabled, toggleSound,
    markRead, markUnread, dismiss, restore, markAllRead,
  } = useNotifications();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"ativos" | "historico" | NotificationCategory>("ativos");

  const alerts: Alert[] = useMemo(() => {
    const arr: Alert[] = notifications.map((n) => ({
      id: n.id,
      category: n.category,
      title: n.title,
      subtitle: `${n.body ?? ""}${n.body ? " · " : ""}${timeAgo(n.created_at)}`,
      created_at: n.created_at,
      read: n.is_read,
      dismissed: n.is_dismissed,
      go: () => { if (n.link) navigate(n.link); },
    }));
    for (const c of chatAlerts) {
      arr.push({
        id: c.id,
        category: "chat",
        title: `💬 ${c.sender_nome}`,
        subtitle: `${c.preview} · ${timeAgo(c.created_at)}${c.unread_count > 1 ? ` · ${c.unread_count} novas` : ""}`,
        created_at: c.created_at,
        read: false,
        dismissed: false,
        go: () => {
          const onChatPage = window.location.pathname.startsWith("/app/chat");
          if (onChatPage) navigate(`/app/chat?c=${c.conversation_id}`);
          else window.dispatchEvent(new CustomEvent("floating-chat:open", { detail: { conversationId: c.conversation_id } }));
        },
      });
    }
    arr.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    return arr;
  }, [notifications, chatAlerts, navigate]);

  const ativos = alerts.filter((a) => !a.dismissed);
  const historico = alerts;

  const iconFor = (c: NotificationCategory) => {
    if (c === "requisicao") return <Inbox className="size-4 text-destructive" />;
    if (c === "emprestimo") return <ArrowLeftRight className="size-4 text-warning" />;
    if (c === "devolucao") return <PackageOpen className="size-4 text-success" />;
    if (c === "chat") return <MessageCircle className="size-4 text-primary" />;
    if (c === "sistema") return <SettingsIcon className="size-4 text-muted-foreground" />;
    return <CheckCircle2 className="size-4" />;
  };

  const renderList = (list: Alert[], asHistory: boolean) => (
    <ScrollArea className="max-h-[420px]">
      {list.length === 0 ? <Empty /> : (
        <div className="py-1">
          {list.map((a) => {
            const isChat = a.id.startsWith("chat:");
            return (
              <Item
                key={a.id}
                icon={iconFor(a.category)}
                title={a.title}
                subtitle={asHistory && a.dismissed ? `${a.subtitle} · fechado` : a.subtitle}
                read={a.read}
                muted={asHistory && a.dismissed}
                onOpen={() => { if (!isChat) markRead(a.id); a.go(); }}
                onMarkRead={isChat ? undefined : () => markRead(a.id)}
                onMarkUnread={isChat ? undefined : () => markUnread(a.id)}
                onDismiss={isChat || a.dismissed ? undefined : () => dismiss(a.id)}
                onRestore={asHistory && a.dismissed ? () => restore(a.id) : undefined}
              />
            );
          })}
          <Separator className="my-1" />
        </div>
      )}
    </ScrollArea>
  );

  const categories: NotificationCategory[] = ["requisicao", "emprestimo", "devolucao", "chat", "sistema"];

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
      <PopoverContent align="end" className="w-[440px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="font-display font-semibold">Notificações</div>
          <div className="flex items-center gap-1">
            {alerts.some((a) => !a.read) && (
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
            <TabsList className="grid grid-cols-7 w-full h-8 gap-0.5">
              <TabsTrigger value="ativos" className="text-[10px] h-6 px-1">
                Ativos
              </TabsTrigger>
              {categories.map((c) => {
                const count = ativos.filter((a) => a.category === c && !a.read).length;
                return (
                  <TabsTrigger key={c} value={c} className="text-[10px] h-6 px-1 relative" title={CATEGORY_LABEL[c]}>
                    <span className="truncate">{CATEGORY_LABEL[c].slice(0, 4)}</span>
                    {count > 0 && <span className="absolute -top-1 -right-1 size-3.5 rounded-full bg-destructive text-destructive-foreground text-[8px] grid place-items-center">{count}</span>}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="historico" className="text-[10px] h-6 px-1">
                <History className="size-3" />
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="ativos" className="m-0">{renderList(ativos, false)}</TabsContent>
          {categories.map((c) => (
            <TabsContent key={c} value={c} className="m-0">
              {renderList(ativos.filter((a) => a.category === c), false)}
            </TabsContent>
          ))}
          <TabsContent value="historico" className="m-0">{renderList(historico, true)}</TabsContent>
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
  onMarkRead?: () => void;
  onMarkUnread?: () => void;
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
        {onMarkRead && !read && (
          <Button size="icon" variant="ghost" className="size-7" onClick={onMarkRead} title="Marcar como lido">
            <Check className="size-3.5" />
          </Button>
        )}
        {onMarkUnread && read && (
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
