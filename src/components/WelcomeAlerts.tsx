import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, ArrowLeftRight, PackageOpen, MessageCircle, Settings as SettingsIcon, BellRing, X, Check } from "lucide-react";
import { useNotifications, NotificationCategory } from "@/contexts/NotificationsContext";
import { cn } from "@/lib/utils";

const ICON: Record<NotificationCategory, any> = {
  requisicao: Inbox,
  emprestimo: ArrowLeftRight,
  devolucao: PackageOpen,
  chat: MessageCircle,
  sistema: SettingsIcon,
  auditoria: SettingsIcon,
};
const TONE: Record<NotificationCategory, string> = {
  requisicao: "border-destructive/50 bg-destructive/10 text-destructive",
  emprestimo: "border-warning/50 bg-warning/10 text-warning",
  devolucao: "border-success/50 bg-success/10 text-success",
  chat: "border-primary/50 bg-primary/10 text-primary",
  sistema: "border-border bg-muted/30 text-muted-foreground",
  auditoria: "border-border bg-muted/30 text-muted-foreground",
};
const SOFT = "border-border bg-muted/30 text-muted-foreground";

export default function WelcomeAlerts() {
  const { notifications, markRead, dismiss } = useNotifications();
  const navigate = useNavigate();

  const visiveis = useMemo(
    () => notifications.filter((n) => !n.is_dismissed),
    [notifications]
  );

  if (visiveis.length === 0) return null;
  const naoLidos = visiveis.filter((n) => !n.is_read).length;

  return (
    <Card className="p-4 border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className={cn("size-5 text-primary", naoLidos > 0 && "animate-pulse")} />
        <div className="font-display font-semibold">Pendências aguardando você</div>
        <Badge className="ml-auto">{visiveis.length}</Badge>
        {naoLidos > 0 && (
          <Badge variant="destructive" className="text-[10px]">{naoLidos} novo{naoLidos > 1 ? "s" : ""}</Badge>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {visiveis.slice(0, 6).map((n) => {
          const Icon = ICON[n.category] ?? SettingsIcon;
          const classes = n.is_read ? SOFT : (TONE[n.category] ?? SOFT);
          const action = () => { if (n.link) navigate(n.link); };
          return (
            <div key={n.id} className={cn("rounded-md border p-3 flex flex-col gap-2 relative transition-colors", classes)}>
              <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                {!n.is_read && (
                  <Button size="icon" variant="ghost" className="size-6" onClick={() => markRead(n.id)} title="Marcar como lido">
                    <Check className="size-3" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="size-6" onClick={() => dismiss(n.id)} title="Fechar">
                  <X className="size-3" />
                </Button>
              </div>
              <div className="flex items-start gap-2 pr-12">
                <Icon className="size-4 shrink-0 mt-0.5" />
                <div className="text-sm font-medium leading-snug text-foreground">
                  {!n.is_read && <span className="inline-block size-1.5 rounded-full bg-destructive mr-1.5 align-middle" />}
                  {n.title}
                  {n.body && <div className="text-xs text-muted-foreground font-normal mt-0.5">{n.body}</div>}
                </div>
              </div>
              {n.link && (
                <Button size="sm" variant="outline" onClick={() => { markRead(n.id); action(); }} className="self-start">
                  Ver agora
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {visiveis.length > 6 && (
        <div className="mt-3 text-xs text-muted-foreground text-center">
          + {visiveis.length - 6} mais — abra o sino 🔔 no topo
        </div>
      )}
    </Card>
  );
}
