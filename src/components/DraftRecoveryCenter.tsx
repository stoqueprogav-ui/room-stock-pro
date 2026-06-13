import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { listDrafts, deleteDraft, routeForScope, labelForScope, type DraftRecord } from "@/lib/drafts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileClock, Trash2, ArrowRight, X } from "lucide-react";

export default function DraftRecoveryCenter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const refresh = async () => {
    if (!user) return;
    try { setDrafts(await listDrafts(user.id)); } catch { setDrafts([]); }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  if (!user || dismissed || drafts.length === 0) return null;

  return (
    <div className="panel p-3 mb-4 border-primary/40">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <FileClock className="size-4 text-primary" />
          Trabalho não enviado · {drafts.length} rascunho(s)
        </div>
        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDismissed(true)} title="Ocultar">
          <X className="size-4" />
        </Button>
      </div>
      <ul className="space-y-1.5">
        {drafts.slice(0, 5).map((d) => (
          <li key={d.id} className="flex items-center gap-2 text-sm rounded border border-border px-2 py-1.5">
            <Badge variant="secondary">{labelForScope(d.scope)}</Badge>
            <span className="text-xs text-muted-foreground">{new Date(d.updatedAt).toLocaleString()}</span>
            {typeof d.itemCount === "number" && <span className="text-xs text-muted-foreground">· {d.itemCount} item(ns)</span>}
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="outline" onClick={() => navigate(routeForScope(d.scope))}>
                <ArrowRight className="size-3" /> Continuar
              </Button>
              <Button size="sm" variant="ghost" onClick={async () => { await deleteDraft(user.id, d.scope); refresh(); }}>
                <Trash2 className="size-3" />
              </Button>
            </div>
          </li>
        ))}
        {drafts.length > 5 && <li className="text-xs text-muted-foreground">+{drafts.length - 5} outros…</li>}
      </ul>
    </div>
  );
}
