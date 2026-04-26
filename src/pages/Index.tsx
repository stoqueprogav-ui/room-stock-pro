import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";
import MasterOverview from "./master/MasterOverview";
import SalaOverview from "./sala/SalaOverview";

const Index = () => {
  const { loading, user, role } = useAuth();
  if (loading) return <div className="grid place-items-center min-h-[60vh]"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return role === "master" ? <MasterOverview /> : <SalaOverview />;
};

export default Index;
