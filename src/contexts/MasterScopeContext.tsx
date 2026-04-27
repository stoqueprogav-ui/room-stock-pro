import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "master_scope_sala_id";

type MasterScopeValue = {
  /** sala_id em foco para o Master, ou null = visão global (todas as salas) */
  scopeSalaId: string | null;
  /** true se uma sala foi escolhida (ou modo global). false = ainda não escolheu. */
  scopeReady: boolean;
  setScope: (salaId: string | null) => void;
  clearScope: () => void;
};

const MasterScopeContext = createContext<MasterScopeValue | undefined>(undefined);

export function MasterScopeProvider({ children }: { children: ReactNode }) {
  const { role, user } = useAuth();
  const [scopeSalaId, setScopeSalaId] = useState<string | null>(null);
  const [scopeReady, setScopeReady] = useState(false);

  // Carrega escolha salva ao logar
  useEffect(() => {
    if (role !== "master" || !user) {
      setScopeSalaId(null);
      setScopeReady(false);
      return;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "__all__") {
      setScopeSalaId(null);
      setScopeReady(true);
    } else if (saved) {
      setScopeSalaId(saved);
      setScopeReady(true);
    } else {
      setScopeReady(false);
    }
  }, [role, user]);

  const setScope = useCallback((salaId: string | null) => {
    setScopeSalaId(salaId);
    setScopeReady(true);
    localStorage.setItem(STORAGE_KEY, salaId ?? "__all__");
  }, []);

  const clearScope = useCallback(() => {
    setScopeSalaId(null);
    setScopeReady(false);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <MasterScopeContext.Provider value={{ scopeSalaId, scopeReady, setScope, clearScope }}>
      {children}
    </MasterScopeContext.Provider>
  );
}

export function useMasterScope() {
  const ctx = useContext(MasterScopeContext);
  if (!ctx) throw new Error("useMasterScope must be used within MasterScopeProvider");
  return ctx;
}
