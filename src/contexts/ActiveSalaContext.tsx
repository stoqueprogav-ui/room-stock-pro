import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ActiveSalaRow = { sala_id: string; sala_nome: string; ativa: boolean };

type ActiveSalaContextValue = {
  salas: ActiveSalaRow[];
  activeSalaId: string | null;
  activeSalaName: string | null;
  loading: boolean;
  selectionRequired: boolean;
  chooseSala: (salaId: string) => Promise<boolean>;
  refreshSalas: () => Promise<void>;
};

const ActiveSalaContext = createContext<ActiveSalaContextValue | undefined>(undefined);

const sessionKey = (userId: string) => `active_sala_selected:${userId}`;

export function ActiveSalaProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth();
  const [salas, setSalas] = useState<ActiveSalaRow[]>([]);
  const [activeSalaId, setActiveSalaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectionRequired, setSelectionRequired] = useState(false);

  const refreshSalas = useCallback(async () => {
    if (!user || role === "master") {
      setSalas([]);
      setActiveSalaId(null);
      setSelectionRequired(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc("listar_minhas_salas");
    if (error) {
      setLoading(false);
      toast.error(error.message);
      return;
    }

    const rows = ((data ?? []) as ActiveSalaRow[]).filter((r) => r.sala_id);
    const active = rows.find((r) => r.ativa)?.sala_id ?? null;
    setSalas(rows);
    setActiveSalaId(active);

    if (rows.length === 1) {
      const only = rows[0].sala_id;
      setSelectionRequired(false);
      if (!active) {
        await supabase.rpc("set_minha_sala_ativa", { _sala: only });
        setActiveSalaId(only);
      }
      try { sessionStorage.setItem(sessionKey(user.id), only); } catch {}
    } else if (rows.length > 1) {
      let selectedThisSession: string | null = null;
      try { selectedThisSession = sessionStorage.getItem(sessionKey(user.id)); } catch {}
      const isSessionSelectionValid = !!selectedThisSession && rows.some((r) => r.sala_id === selectedThisSession);
      setSelectionRequired(!isSessionSelectionValid);
    } else {
      setSelectionRequired(false);
    }

    setLoading(false);
  }, [role, user]);

  useEffect(() => { refreshSalas(); }, [refreshSalas]);

  const chooseSala = useCallback(async (salaId: string) => {
    if (!user) return false;
    const exists = salas.some((s) => s.sala_id === salaId);
    if (!exists) {
      toast.error("Sala não autorizada para este usuário");
      return false;
    }

    const { error } = await supabase.rpc("set_minha_sala_ativa", { _sala: salaId });
    if (error) {
      toast.error(error.message);
      return false;
    }

    setActiveSalaId(salaId);
    setSelectionRequired(false);
    setSalas((prev) => prev.map((s) => ({ ...s, ativa: s.sala_id === salaId })));
    try { sessionStorage.setItem(sessionKey(user.id), salaId); } catch {}
    window.dispatchEvent(new CustomEvent("active-sala:changed", { detail: { salaId } }));
    return true;
  }, [salas, user]);

  const activeSalaName = useMemo(
    () => salas.find((s) => s.sala_id === activeSalaId)?.sala_nome ?? null,
    [activeSalaId, salas]
  );

  return (
    <ActiveSalaContext.Provider value={{ salas, activeSalaId, activeSalaName, loading, selectionRequired, chooseSala, refreshSalas }}>
      {children}
    </ActiveSalaContext.Provider>
  );
}

export function useActiveSala() {
  const ctx = useContext(ActiveSalaContext);
  if (!ctx) throw new Error("useActiveSala must be used within ActiveSalaProvider");
  return ctx;
}