import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Restringe a rota a usuários com papel super_master.
 * Master de região é redirecionado para /app.
 */
export default function RequireSuperMaster({ children }: { children: ReactNode }) {
  const { isSuperMaster } = useAuth();
  if (!isSuperMaster) return <Navigate to="/app" replace />;
  return <>{children}</>;
}
