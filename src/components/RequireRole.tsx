import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import type { AppRole } from "@/lib/types";

/**
 * Trava de rota por cargo. É a SEGUNDA camada de defesa —
 * a primeira é sempre o RPC/RLS checar has_role no servidor,
 * porque a rota é só cosmética (dá para chamar supabase.rpc direto).
 *
 * Uso em App.tsx:
 *   <Route path="usuarios" element={
 *     <RequireRole role="master"><UsuariosPage/></RequireRole>
 *   } />
 *
 * Aceita um único cargo ou uma lista de cargos permitidos.
 */
export default function RequireRole({
  role: need,
  children,
}: {
  role: AppRole | AppRole[];
  children: ReactNode;
}) {
  const { role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const permitidos = Array.isArray(need) ? need : [need];
  if (!role || !permitidos.includes(role)) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
}
