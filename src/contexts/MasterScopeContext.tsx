import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";

const K_MODE = "master_scope_mode";     // 'super' | 'regiao'
const K_REGIAO = "master_scope_regiao"; // regiao_id (modo regiao)
const K_SALA = "master_scope_sala";     // sala_id | '__all__'

type MasterScopeValue = {
  /** sala em foco (null = todas as salas do escopo atual) */
  scopeSalaId: string | null;
  /** true quando já há um escopo escolhido e pronto para entrar */
  scopeReady: boolean;
  /** entrou como Super Master (gestão de regiões/masters, visão global) */
  isSuperMode: boolean;
  /** região atual quando entrou como Master de região (null caso contrário) */
  actingRegiaoId: string | null;

  setScope: (salaId: string | null) => void;
  enterSuperMode: () => void;
  enterRegiaoMode: (regiaoId: string) => void;
  clearScope: () => void;
};

const MasterScopeContext = createContext<MasterScopeValue | undefined>(undefined);

export function MasterScopeProvider({ children }: { children: ReactNode }) {
  const { role, user, isSuperMaster } = useAuth();
  const [scopeSalaId, setScopeSalaId] = useState<string | null>(null);
  const [scopeReady, setScopeReady] = useState(false);
  const [isSuperMode, setIsSuperMode] = useState(false);
  const [actingRegiaoId, setActingRegiaoId] = useState<string | null>(null);

  // Carrega a escolha salva ao logar (apenas quem opera como master)
  useEffect(() => {
    if (role !== "master" || !user) {
      setScopeSalaId(null); setScopeReady(false);
      setIsSuperMode(false); setActingRegiaoId(null);
      return;
    }

    // Super Master: papel dedicado. Entra direto em modo super, sem escolher sala.
    if (isSuperMaster) {
      setIsSuperMode(true);
      setActingRegiaoId(null);
      setScopeSalaId(null);
      setScopeReady(true);
      return;
    }

    // Master de região: comportamento tradicional (escolher sala).
    const sala = localStorage.getItem(K_SALA);
    setIsSuperMode(false);
    setActingRegiaoId(null);
    if (sala === "__all__") { setScopeSalaId(null); setScopeReady(true); }
    else if (sala) { setScopeSalaId(sala); setScopeReady(true); }
    else { setScopeSalaId(null); setScopeReady(false); }
  }, [role, user, isSuperMaster]);

  const setScope = useCallback((salaId: string | null) => {
    setScopeSalaId(salaId);
    setScopeReady(true);
    localStorage.setItem(K_SALA, salaId ?? "__all__");
  }, []);

  const enterSuperMode = useCallback(() => {
    setIsSuperMode(true);
    setActingRegiaoId(null);
    setScopeSalaId(null);
    setScopeReady(true);
    localStorage.setItem(K_MODE, "super");
    localStorage.removeItem(K_REGIAO);
    localStorage.setItem(K_SALA, "__all__");
  }, []);

  const enterRegiaoMode = useCallback((regiaoId: string) => {
    setIsSuperMode(false);
    setActingRegiaoId(regiaoId);
    setScopeSalaId(null);
    setScopeReady(false); // ainda precisa escolher a sala
    localStorage.setItem(K_MODE, "regiao");
    localStorage.setItem(K_REGIAO, regiaoId);
    localStorage.removeItem(K_SALA);
  }, []);

  const clearScope = useCallback(() => {
    setScopeSalaId(null);
    setScopeReady(false);
    setIsSuperMode(false);
    setActingRegiaoId(null);
    localStorage.removeItem(K_MODE);
    localStorage.removeItem(K_REGIAO);
    localStorage.removeItem(K_SALA);
  }, []);

  return (
    <MasterScopeContext.Provider
      value={{ scopeSalaId, scopeReady, isSuperMode, actingRegiaoId, setScope, enterSuperMode, enterRegiaoMode, clearScope }}>
      {children}
    </MasterScopeContext.Provider>
  );
}

export function useMasterScope() {
  const ctx = useContext(MasterScopeContext);
  if (!ctx) throw new Error("useMasterScope must be used within MasterScopeProvider");
  return ctx;
}
