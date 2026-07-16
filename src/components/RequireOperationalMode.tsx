import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useMasterScope } from "@/contexts/MasterScopeContext";

/**
 * Segunda camada de defesa (além do menu): impede o acesso a telas
 * operacionais quando o master está entrando no modo Super Master.
 * Nesse modo, o app fica restrito a Regiões, Masters e Relatórios.
 */
export default function RequireOperationalMode({ children }: { children: ReactNode }) {
  const { isSuperMode } = useMasterScope();
  if (isSuperMode) return <Navigate to="/app/regioes" replace />;
  return <>{children}</>;
}
