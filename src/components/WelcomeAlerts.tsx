import { useNavigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Inbox, ArrowLeftRight, CheckCircle2, BellRing } from "lucide-react";
import { useNotifications } from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";

export default function WelcomeAlerts() {
  const { role } = useAuth();
  const { requisicoes, emprestimosPendentes, emprestimosAprovados, totalCount } = useNotifications();
  const navigate = useNavigate();

  if (totalCount === 0) return null;

  const cards = [
    role === "master" && requisicoes.length > 0 && {
      key: "req",
      icon: Inbox,
      tone: "destructive" as const,
      title: `Você tem ${requisicoes.length} requisiç${requisicoes.length === 1 ? "ão" : "ões"} aguardando aprovação`,
      action: () => navigate("/app/requisicoes"),
    },
    emprestimosPendentes.length > 0 && {
      key: "empP",
      icon: ArrowLeftRight,
      tone: "warning" as const,
      title:
        role === "master"
          ? `${emprestimosPendentes.length} empréstimo${emprestimosPendentes.length === 1 ? "" : "s"} pendente${emprestimosPendentes.length === 1 ? "" : "s"}`
          : `Sua sala recebeu ${emprestimosPendentes.length} pedido${emprestimosPendentes.length === 1 ? "" : "s"} de empréstimo`,
      action: () => navigate(role === "master" ? "/app/emprestimos" : "/app/aprovar-emprestimos"),
    },
    role === "master" && emprestimosAprovados.length > 0 && {
      key: "empA",
      icon: CheckCircle2,
      tone: "success" as const,
      title: `${emprestimosAprovados.length} empréstimo${emprestimosAprovados.length === 1 ? "" : "s"} aprovado${emprestimosAprovados.length === 1 ? "" : "s"} aguardando arquivamento`,
      action: () => navigate("/app/emprestimos"),
    },
  ].filter(Boolean) as Array<{ key: string; icon: any; tone: "destructive" | "warning" | "success"; title: string; action: () => void }>;

  const toneClass: Record<string, string> = {
    destructive: "border-destructive/40 bg-destructive/5 text-destructive",
    warning: "border-warning/40 bg-warning/10 text-warning",
    success: "border-success/40 bg-success/10 text-success",
  };

  return (
    <Card className="p-4 border-2 border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <div className="flex items-center gap-2 mb-3">
        <BellRing className="size-5 text-primary animate-pulse" />
        <div className="font-display font-semibold">Atenção — pendências aguardando você</div>
        <Badge className="ml-auto">{totalCount}</Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cards.map(({ key, icon: Icon, tone, title, action }) => (
          <div key={key} className={`rounded-md border p-3 flex flex-col gap-3 ${toneClass[tone]}`}>
            <div className="flex items-start gap-2">
              <Icon className="size-5 shrink-0 mt-0.5" />
              <div className="text-sm font-medium leading-snug text-foreground">{title}</div>
            </div>
            <Button size="sm" variant="outline" onClick={action} className="self-start">Ver agora</Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
