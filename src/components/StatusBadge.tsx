import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    pendente: { label: "Pendente", className: "bg-warning/15 text-warning border border-warning/30" },
    aprovado: { label: "Aprovado", className: "bg-success/15 text-success border border-success/30" },
    rejeitado: { label: "Rejeitado", className: "bg-destructive/15 text-destructive border border-destructive/30" },
    arquivado: { label: "Arquivado", className: "bg-muted text-muted-foreground border border-border" },
  };
  const cfg = map[status] ?? { label: status, className: "" };
  return <Badge variant="outline" className={cfg.className}>{cfg.label}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  const map: Record<string, { label: string; className: string }> = {
    master: { label: "Master", className: "bg-primary text-primary-foreground border-transparent" },
    admin: { label: "Administrador", className: "bg-accent text-accent-foreground border-transparent" },
    analista: { label: "Analista", className: "bg-secondary text-secondary-foreground border-transparent" },
  };
  const cfg = map[role] ?? { label: role, className: "" };
  return <Badge className={cfg.className}>{cfg.label}</Badge>;
}
