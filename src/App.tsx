import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import SalasPage from "./pages/master/SalasPage";
import ProdutosPage from "./pages/master/ProdutosPage";
import EstoquePage from "./pages/master/EstoquePage";
import SolicitacoesPage from "./pages/master/SolicitacoesPage";
import UsuariosPage from "./pages/master/UsuariosPage";
import RelatoriosPage from "./pages/master/RelatoriosPage";
import EmprestimosPage from "./pages/EmprestimosPage";
import DividasPage from "./pages/DividasPage";
import MovimentacoesPage from "./pages/MovimentacoesPage";
import NovaSolicitacao from "./pages/sala/NovaSolicitacao";
import MinhasSolicitacoes from "./pages/sala/MinhasSolicitacoes";
import NovoEmprestimo from "./pages/sala/NovoEmprestimo";
import EscolherSala from "./pages/master/EscolherSala";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner richColors closeButton position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Index />} />
              {/* Master */}
              <Route path="salas" element={<SalasPage />} />
              <Route path="produtos" element={<ProdutosPage />} />
              <Route path="estoque" element={<EstoquePage />} />
              <Route path="solicitacoes" element={<SolicitacoesPage />} />
              <Route path="usuarios" element={<UsuariosPage />} />
              <Route path="relatorios" element={<RelatoriosPage />} />
              {/* Compartilhado */}
              <Route path="emprestimos" element={<EmprestimosPage />} />
              <Route path="aprovar-emprestimos" element={<EmprestimosPage approveOnly />} />
              <Route path="dividas" element={<DividasPage />} />
              <Route path="movimentacoes" element={<MovimentacoesPage />} />
              {/* Sala (admin/analista) */}
              <Route path="meu-estoque" element={<EstoquePage />} />
              <Route path="nova-solicitacao" element={<NovaSolicitacao />} />
              <Route path="minhas-solicitacoes" element={<MinhasSolicitacoes />} />
              <Route path="novo-emprestimo" element={<NovoEmprestimo />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
