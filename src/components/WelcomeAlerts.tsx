import { useNavigate } from "react-router-dom";
import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, ArrowLeftRight, CheckCircle2, BellRing, X, Check } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type Tone = "destructive" | "warning" | "success";

export default function WelcomeAlerts() {
  const { role } = useAuth();
  const {
    requisicoes, emprestimosPendentes, emprestimosAprovados,
    isRead, isDismissed, markRead, dismiss,
  } = useNotifications();
  const navigate = useNavigate();

  type Cell = { id: string; icon: any; tone: Tone; title: string; action: () => void };

  const cells: Cell[] = useMemo(() => {
    const arr: Cell[] = [];
    if (role === "master") {
      for (const r of requisicoes) {
        arr.push({
          id: r.id, icon: Inbox, tone: "destructive",
          title: `Requisição de ${r.usuario_nome} · ${r.sala_nome}`,
          action: () => navigate("/app/requisicoes"),
        });
      }
    }
    for (const e of emprestimosPendentes) {
      arr.push({
        id: e.id, icon: ArrowLeftRight, tone: "warning",
        title: role === "master"
          ? `Empréstimo pendente · ${e.sala_destino_nome} → ${e.sala_origem_nome}`
          : `Pedido de empréstimo de ${e.solicitante_nome}`,
        action: () => navigate(role === "master" ? "/app/emprestimos" : "/app/aprovar-emprestimos"),
      });
    }
    if (role === "master") {
      for (const e of emprestimosAprovados) {
        arr.push({
          id: e.id, icon: CheckCircle2, tone: "success",
          title: `Aprovado · ${e.sala_origem_nome} → ${e.sala_destino_nome} (arquivar)`,
          action: () => navigate("/app/emprestimos"),
        });
      }
    }
    return arr;
  }, [role, requisicoes, emprestimosPendentes, emprestimosAprovados, navigate]);

  const visiveis = cells.filter((c) => !isDismissed(c.id));
  if (visiveis.length === 0) return null;

  const naoLidos = visiveis.filter((c) => !isRead(c.id)).length;

  const toneClass: Record<Tone, { strong: string; soft: string }> = {
    destructive: {
      strong: "border-destructive/50 bg-destructive/10 text-destructive",
      soft: "border-border bg-muted/30 text-muted-foreground",
    },
    warning: {
      strong: "border-warning/50 bg-warning/10 text-warning",
      soft: "border-border bg-muted/30 text-muted-foreground",
    },
    success: {
      strong: "border-success/50 bg-success/10 text-success",
      soft: "border-border bg-muted/30 text-muted-foreground",
    },
  };

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
        {visiveis.slice(0, 6).map(({ id, icon: Icon, tone, title, action }) => {
          const lido = isRead(id);
          const classes = lido ? toneClass[tone].soft : toneClass[tone].strong;
          return (
            <div key={id} className={cn("rounded-md border p-3 flex flex-col gap-2 relative transition-colors", classes)}>
              <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                {!lido && (
                  <Button size="icon" variant="ghost" className="size-6" onClick={() => markRead(id)} title="Marcar como lido">
                    <Check className="size-3" />
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="size-6" onClick={() => dismiss(id)} title="Fechar">
                  <X className="size-3" />
                </Button>
              </div>
              <div className="flex items-start gap-2 pr-12">
                <Icon className="size-4 shrink-0 mt-0.5" />
                <div className="text-sm font-medium leading-snug text-foreground">
                  {!lido && <span className="inline-block size-1.5 rounded-full bg-destructive mr-1.5 align-middle" />}
                  {title}
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => { markRead(id); action(); }} className="self-start">
                Ver agora
              </Button>
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
