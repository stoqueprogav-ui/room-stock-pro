import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import Login from "./pages/Login";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import RequireRole from "@/components/RequireRole";
import RequireOperationalMode from "@/components/RequireOperationalMode";
import SalasPage from "./pages/master/SalasPage";
import ProdutosPage from "./pages/master/ProdutosPage";
import EstoquePage from "./pages/master/EstoquePage";
import RequisicoesPage from "./pages/master/RequisicoesPage";
import UsuariosPage from "./pages/master/UsuariosPage";
import CategoriasPage from "./pages/master/CategoriasPage";
import RelatoriosPage from "./pages/master/RelatoriosPage";
import EmprestimosPage from "./pages/EmprestimosPage";
import DividasPage from "./pages/DividasPage";
import MovimentacoesPage from "./pages/MovimentacoesPage";
import NovaRequisicao from "./pages/sala/NovaRequisicao";
import MinhasRequisicoes from "./pages/sala/MinhasRequisicoes";
import NovoEmprestimo from "./pages/sala/NovoEmprestimo";
import EscolherSala from "./pages/master/EscolherSala";
import RequisicaoImprimir from "./pages/RequisicaoImprimir";
import EmprestimoImprimir from "./pages/EmprestimoImprimir";
import MeuPerfil from "./pages/MeuPerfil";
import ChatPage from "./pages/ChatPage";
import TrocarSenhaObrigatoria from "./pages/TrocarSenhaObrigatoria";
import ConfiguracoesPage from "./pages/master/ConfiguracoesPage";
import MovimentacoesMasterPage from "./pages/master/MovimentacoesMasterPage";
import ConsumoInternoPage from "./pages/master/ConsumoInternoPage";
import InventarioPage from "./pages/master/InventarioPage";
import DashboardGerencial from "./pages/master/DashboardGerencial";
import EntradasEstoquePage from "./pages/master/EntradasEstoquePage";
import RegioesPage from "./pages/master/RegioesPage";


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
            {/* Rota de impressão fora do layout principal */}
            <Route path="/app/requisicoes/:id/imprimir" element={<RequisicaoImprimir />} />
            <Route path="/app/emprestimos/:id/imprimir" element={<EmprestimoImprimir />} />
            <Route path="/app/trocar-senha" element={<TrocarSenhaObrigatoria />} />
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Index />} />
              <Route path="escolher-sala" element={<EscolherSala />} />
              {/* Master (rotas trancadas por cargo — 2ª camada; a 1ª é sempre RLS/RPC) */}
              <Route path="salas" element={<RequireRole role="master"><RequireOperationalMode><SalasPage /></RequireOperationalMode></RequireRole>} />
              <Route path="regioes" element={<RegioesPage />} />
              <Route path="produtos" element={<Navigate to="/app/estoque" replace />} />
              <Route path="estoque" element={<RequireOperationalMode><EstoquePage /></RequireOperationalMode>} />
              <Route path="requisicoes" element={<RequireRole role="master"><RequireOperationalMode><RequisicoesPage /></RequireOperationalMode></RequireRole>} />
              {/* Compatibilidade com link antigo */}
              <Route path="solicitacoes" element={<Navigate to="/app/requisicoes" replace />} />
              <Route path="usuarios" element={<RequireRole role="master"><UsuariosPage /></RequireRole>} />
              <Route path="categorias" element={<RequireRole role="master"><RequireOperationalMode><CategoriasPage /></RequireOperationalMode></RequireRole>} />
              <Route path="relatorios" element={<RequireRole role="master"><RelatoriosPage /></RequireRole>} />
              <Route path="configuracoes" element={<RequireRole role="master"><ConfiguracoesPage /></RequireRole>} />
              <Route path="auditoria" element={<Navigate to="/app/movimentacoes" replace />} />
              <Route path="consumo-interno" element={<RequireRole role="master"><RequireOperationalMode><ConsumoInternoPage /></RequireOperationalMode></RequireRole>} />
              <Route path="inventario" element={<RequireRole role="master"><RequireOperationalMode><InventarioPage /></RequireOperationalMode></RequireRole>} />
              <Route path="dashboard-gerencial" element={<RequireRole role="master"><RequireOperationalMode><DashboardGerencial /></RequireOperationalMode></RequireRole>} />
              <Route path="entradas" element={<RequireRole role="master"><RequireOperationalMode><EntradasEstoquePage /></RequireOperationalMode></RequireRole>} />
              <Route path="avaliacao-patrimonial" element={<Navigate to="/app/relatorios" replace />} />
              {/* Compartilhado */}
              <Route path="emprestimos" element={<RequireOperationalMode><EmprestimosPage /></RequireOperationalMode>} />
              <Route path="aprovar-emprestimos" element={<RequireOperationalMode><EmprestimosPage approveOnly /></RequireOperationalMode>} />
              <Route path="dividas" element={<RequireOperationalMode><DividasPage /></RequireOperationalMode>} />
              <Route path="movimentacoes" element={<RequireOperationalMode><MovimentacoesRouter /></RequireOperationalMode>} />
              {/* Sala (admin/analista) */}
              <Route path="meu-estoque" element={<EstoquePage />} />
              <Route path="nova-requisicao" element={<NovaRequisicao />} />
              <Route path="minhas-requisicoes" element={<MinhasRequisicoes />} />
              <Route path="nova-solicitacao" element={<Navigate to="/app/nova-requisicao" replace />} />
              <Route path="minhas-solicitacoes" element={<Navigate to="/app/minhas-requisicoes" replace />} />
              <Route path="novo-emprestimo" element={<NovoEmprestimo />} />
              <Route path="meu-perfil" element={<MeuPerfil />} />
              <Route path="chat" element={<ChatPage />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

function MovimentacoesRouter() {
  const { role } = useAuth();
  return role === "master" ? <MovimentacoesMasterPage /> : <MovimentacoesPage />;
}

export default App;

