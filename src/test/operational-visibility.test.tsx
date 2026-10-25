import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "admin", activeSalaId: "sala-autorizada" as string | null,
  rows: {} as Record<string, unknown[]>,
  calls: [] as { table: string; method: string; args: unknown[] }[],
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ role: state.role, loading: false }) }));
vi.mock("@/contexts/ActiveSalaContext", () => ({ useActiveSala: () => ({ activeSalaId: state.activeSalaId, loading: false }) }));
vi.mock("@/contexts/MasterScopeContext", () => ({ useMasterScope: () => ({ scopeSalaId: null, scopeReady: true }) }));
vi.mock("@/hooks/useRealtimeSync", () => ({ useRealtimeSync: () => {} }));
vi.mock("@/components/AppLayout", () => ({ PageHeader: () => null }));
vi.mock("@/components/ArquivarRetiradaDialog", () => ({ default: () => null }));
vi.mock("@/components/RevisarPedidoDialog", () => ({ default: () => null }));
vi.mock("@/components/DevolverEmprestimoDialog", () => ({ default: () => null }));
vi.mock("@/components/EditarEmprestimoDialog", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: (table: string) => {
    const query: Record<string, unknown> = {};
    for (const method of ["select", "order", "or", "eq", "lt", "gte", "lte", "limit", "in"]) {
      query[method] = (...args: unknown[]) => { state.calls.push({ table, method, args }); return query; };
    }
    query.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data: state.rows[table] ?? [], error: null }).then(resolve);
    return query;
  },
} }));
import EmprestimosPage from "@/pages/EmprestimosPage";
import DividasPage from "@/pages/DividasPage";
import MovimentacoesPage from "@/pages/MovimentacoesPage";

afterEach(() => { cleanup(); state.calls = []; state.rows = {}; state.activeSalaId = "sala-autorizada"; });

describe.each(["admin", "analista"])("Visibilidade operacional de %s", (role) => {
  it("mantém o empréstimo legível com produto ocultado por acesso", async () => {
    state.role = role;
    state.rows.emprestimos = [{ id: "12345678", status: "pendente", created_at: "2026-10-24T12:00:00Z", origem: null, destino: null, itens: [{ quantidade: 7, quantidade_devolvida: 0, produto: null }] }];
    render(<MemoryRouter><EmprestimosPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("EMP-#12345678")).toHaveLength(1));
    expect(state.calls).toContainEqual({ table: "emprestimos", method: "or", args: ["sala_origem_id.eq.sala-autorizada,sala_destino_id.eq.sala-autorizada"] });
  });

  it("exibe saldo da dívida mesmo quando a relação de produto está oculta", async () => {
    state.role = role;
    state.rows.dividas = [{ id: "divida", saldo: 7, produto: null, credora: null, devedora: null }];
    render(<DividasPage />);
    await waitFor(() => expect(screen.getAllByText("7").length).toBeGreaterThan(0));
    expect(state.calls).toContainEqual({ table: "dividas", method: "or", args: ["sala_devedora_id.eq.sala-autorizada,sala_credora_id.eq.sala-autorizada"] });
  });

  it("exibe a quantidade histórica sem depender do produto relacionado", async () => {
    state.role = role;
    state.rows.movimentacoes = [{ id: "mov", quantidade: 7, saldo_apos: 12, created_at: "2026-10-24T12:00:00Z", tipo: "entrada", produto: null, sala: null }];
    render(<MovimentacoesPage />);
    await waitFor(() => expect(screen.getAllByText("+7")).toHaveLength(1));
    expect(state.calls).toContainEqual({ table: "movimentacoes", method: "eq", args: ["sala_id", "sala-autorizada"] });
  });

  it("não consulta registros operacionais antes da escolha da sala", async () => {
    state.role = role; state.activeSalaId = null;
    render(<MemoryRouter><EmprestimosPage /><DividasPage /><MovimentacoesPage /></MemoryRouter>);
    await waitFor(() => expect(state.calls).toEqual([]));
  });
});