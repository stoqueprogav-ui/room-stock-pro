import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Row = { sala_id: string; sala_nome: string; ativa: boolean };

export default function ActiveSalaSwitcher() {
  const { profile, refreshProfile } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("listar_minhas_salas");
    if (error) return;
    setRows((data ?? []) as Row[]);
  }, []);

  useEffect(() => { load(); }, [load, profile?.sala_id]);

  if (rows.length < 2) return null;

  const trocar = async (sala: string) => {
    if (sala === profile?.sala_id) return;
    setSwitching(true);
    const { error } = await supabase.rpc("set_minha_sala_ativa", { _sala: sala });
    if (error) { setSwitching(false); return toast.error(error.message); }
    await refreshProfile();
    setSwitching(false);
    toast.success(`Sala ativa: ${rows.find((r) => r.sala_id === sala)?.sala_nome ?? ""}`);
    // Recarrega a página para sincronizar todos os módulos com a nova sala
    setTimeout(() => window.location.reload(), 200);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={profile?.sala_id ?? ""} onValueChange={trocar} disabled={switching}>
        <SelectTrigger className="h-8 min-w-[180px] gap-2">
          {switching ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5 text-primary" />}
          <SelectValue placeholder="Selecione a sala" />
        </SelectTrigger>
        <SelectContent>
          {rows.map((r) => (
            <SelectItem key={r.sala_id} value={r.sala_id}>{r.sala_nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
