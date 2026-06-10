import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, Building2 } from "lucide-react";
import type { Sala } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string | null;
  userNome?: string;
  salas: Sala[];
  onSaved?: () => void;
};

export default function UserSalasDialog({ open, onOpenChange, userId, userNome, salas, onSaved }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !userId) return;
    setLoading(true);
    supabase.from("user_salas").select("sala_id").eq("user_id", userId)
      .then(({ data }) => {
        setSelected(new Set((data ?? []).map((r: any) => r.sala_id)));
        setLoading(false);
      });
  }, [open, userId]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const salvar = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.rpc("admin_set_user_salas", {
      _user: userId,
      _salas: Array.from(selected),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Salas autorizadas atualizadas");
    onOpenChange(false);
    onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Building2 className="size-4 text-primary" /> Salas autorizadas</DialogTitle>
          <DialogDescription>
            {userNome ? `Defina as salas que ${userNome} pode acessar.` : "Defina as salas que este usuário pode acessar."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="grid place-items-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
        ) : (
          <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border p-2">
            {salas.length === 0 && <div className="text-sm text-muted-foreground p-3">Nenhuma sala cadastrada.</div>}
            {salas.map((s) => (
              <label key={s.id} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted/50 cursor-pointer">
                <Checkbox checked={selected.has(s.id)} onCheckedChange={() => toggle(s.id)} />
                <Label className="flex-1 cursor-pointer font-normal">{s.nome}</Label>
              </label>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {selected.size} sala{selected.size === 1 ? "" : "s"} marcada{selected.size === 1 ? "" : "s"}.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={salvar} disabled={saving || loading}>{saving ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
