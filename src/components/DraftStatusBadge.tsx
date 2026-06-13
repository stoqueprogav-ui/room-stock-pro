import { Badge } from "@/components/ui/badge";
import { Loader2, Check, AlertTriangle, FileClock } from "lucide-react";
import type { DraftStatus } from "@/hooks/useDraft";

export default function DraftStatusBadge({ status, lastSaved }: { status: DraftStatus; lastSaved: Date | null }) {
  if (status === "saving") {
    return <Badge variant="secondary" className="gap-1"><Loader2 className="size-3 animate-spin" /> Salvando rascunho…</Badge>;
  }
  if (status === "saved" && lastSaved) {
    const hh = lastSaved.toLocaleTimeString();
    return <Badge variant="secondary" className="gap-1"><Check className="size-3 text-emerald-500" /> Rascunho salvo às {hh}</Badge>;
  }
  if (status === "error") {
    return <Badge variant="destructive" className="gap-1"><AlertTriangle className="size-3" /> Erro ao salvar rascunho</Badge>;
  }
  return <Badge variant="outline" className="gap-1 text-muted-foreground"><FileClock className="size-3" /> Auto-save ativo</Badge>;
}
