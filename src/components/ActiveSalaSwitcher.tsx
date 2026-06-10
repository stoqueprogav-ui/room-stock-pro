import { useState } from "react";
import { useActiveSala } from "@/contexts/ActiveSalaContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ActiveSalaSwitcher() {
  const { salas, activeSalaId, chooseSala } = useActiveSala();
  const [switching, setSwitching] = useState(false);

  if (salas.length < 2) return null;

  const trocar = async (sala: string) => {
    if (sala === activeSalaId) return;
    setSwitching(true);
    const ok = await chooseSala(sala);
    setSwitching(false);
    if (ok) toast.success(`Sala ativa: ${salas.find((r) => r.sala_id === sala)?.sala_nome ?? ""}`);
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={activeSalaId ?? ""} onValueChange={trocar} disabled={switching}>
        <SelectTrigger className="h-8 min-w-[180px] gap-2">
          {switching ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5 text-primary" />}
          <SelectValue placeholder="Sala atual" />
        </SelectTrigger>
        <SelectContent>
          {salas.map((r) => (
            <SelectItem key={r.sala_id} value={r.sala_id}>{r.sala_nome}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
