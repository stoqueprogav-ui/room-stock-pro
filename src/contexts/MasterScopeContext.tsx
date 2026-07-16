import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "master_scope_sala_id";
const MODE_KEY = "master_mode"; // "super" | "region"
const REGIAO_KEY = "master_acting_regiao_id";

type MasterMode = "super" | "region" | null;

type MasterScopeValue = {
  /** sala_id em foco para o Master, ou null = visão global (todas as salas) */
  scopeSalaId: string | null;
  /** true se uma sala foi escolhida (ou modo global). false = ainda não escolheu. */
  scopeReady: boolean;
  /** Modo escolhido no login: super master atua como super, ou master de região */
  isSuperMode: boolean;
  /** Região em foco quando o master atua como master de região */
  actingRegiaoId: string | null;
  setScope: (salaId: string | null) => void;
  setMode: (mode: MasterMode, regiaoId?: string | null) => void;
  clearScope: () => void;
};

const MasterScopeContext = createContext<MasterScopeValue | undefined>(undefined);

export function MasterScopeProvider({ children }: { children: ReactNode }) {
  const { role, user, isSuperMaster } = useAuth();
  const [scopeSalaId, setScopeSalaId] = useState<string | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [isSuperMode, setIsSuperMode] = useState<boolean>(false);
  const [actingRegiaoId, setActingRegiaoId] = useState<string | null>(null);

  // Carrega escolha salva ao logar
  useEffect(() => {
    if (role !== "master" || !user) {
      setScopeSalaId(null);
      setScopeReady(false);
      setIsSuperMode(false);
      setActingRegiaoId(null);
      return;
    }
    const savedMode = localStorage.getItem(MODE_KEY);
    const savedRegiao = localStorage.getItem(REGIAO_KEY);
    if (savedMode === "super" && isSuperMaster) {
      setIsSuperMode(true);
      setActingRegiaoId(null);
    } else if (savedMode === "region" && savedRegiao) {
      setIsSuperMode(false);
      setActingRegiaoId(savedRegiao);
    } else {
      setIsSuperMode(false);
      setActingRegiaoId(null);
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
  }, [role, user, isSuperMaster]);

  const setScope = useCallback((salaId: string | null) => {
    setScopeSalaId(salaId);
    setScopeReady(true);
    localStorage.setItem(STORAGE_KEY, salaId ?? "__all__");
  }, []);

  const setMode = useCallback((mode: MasterMode, regiaoId?: string | null) => {
    if (mode === "super") {
      setIsSuperMode(true);
      setActingRegiaoId(null);
      localStorage.setItem(MODE_KEY, "super");
      localStorage.removeItem(REGIAO_KEY);
    } else if (mode === "region") {
      setIsSuperMode(false);
      setActingRegiaoId(regiaoId ?? null);
      localStorage.setItem(MODE_KEY, "region");
      if (regiaoId) localStorage.setItem(REGIAO_KEY, regiaoId);
      else localStorage.removeItem(REGIAO_KEY);
    } else {
      setIsSuperMode(false);
      setActingRegiaoId(null);
      localStorage.removeItem(MODE_KEY);
      localStorage.removeItem(REGIAO_KEY);
    }
  }, []);

  const clearScope = useCallback(() => {
    setScopeSalaId(null);
    setScopeReady(false);
    setIsSuperMode(false);
    setActingRegiaoId(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(MODE_KEY);
    localStorage.removeItem(REGIAO_KEY);
  }, []);

  return (
    <MasterScopeContext.Provider value={{ scopeSalaId, scopeReady, isSuperMode, actingRegiaoId, setScope, setMode, clearScope }}>
      {children}
    </MasterScopeContext.Provider>
  );
}

export function useMasterScope() {
  const ctx = useContext(MasterScopeContext);
  if (!ctx) throw new Error("useMasterScope must be used within MasterScopeProvider");
  return ctx;
}
