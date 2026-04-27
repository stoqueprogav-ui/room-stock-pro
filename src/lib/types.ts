export type AppRole = "master" | "admin" | "analista";

export type Sala = {
  id: string;
  nome: string;
  created_at: string;
};

export type Profile = {
  id: string;
  nome: string;
  email: string;
  sala_id: string | null;
};

export type Produto = {
  id: string;
  nome: string;
  descricao: string | null;
  unidade: string;
  estoque_minimo: number;
  estoque_critico: number;
};

export type EstoqueRow = {
  id: string;
  produto_id: string;
  sala_id: string;
  quantidade: number;
};

export type SolicitacaoStatus = "pendente" | "aprovado" | "rejeitado";
export type EmprestimoStatus = "pendente" | "aprovado" | "rejeitado";

export type MovimentacaoTipo =
  | "entrada"
  | "saida"
  | "ajuste"
  | "solicitacao"
  | "estorno"
  | "emprestimo_saida"
  | "emprestimo_entrada";
