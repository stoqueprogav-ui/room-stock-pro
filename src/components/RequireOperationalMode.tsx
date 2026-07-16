import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Bloqueia rotas operacionais para o Super Master (papel).
 * Super Master só acessa Regiões, Masters (Usuários) e Relatórios.
 */
export default function RequireOperationalMode({ children }: { children: ReactNode }) {
  const { isSuperMaster } = useAuth();
  if (isSuperMaster) return <Navigate to="/app/regioes" replace />;
  return <>{children}</>;
}
