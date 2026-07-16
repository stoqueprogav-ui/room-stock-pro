export type AppRole = "super_master" | "master" | "admin" | "analista";

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
  must_change_password?: boolean;
};

export type Categoria = {
  id: string;
  nome: string;
  created_at?: string;
};

export type Produto = {
  id: string;
  nome: string;
  descricao: string | null;
  unidade: string;
  estoque_minimo: number;
  custo_unitario?: number;
  categoria_id: string | null;
  categoria?: { id: string; nome: string } | null;
  ativo?: boolean;
  sala_id?: string | null;
  sala?: { id: string; nome: string } | null;
};

export type EstoqueRow = {
  id: string;
  produto_id: string;
  sala_id: string;
  quantidade: number;
};

export type RequisicaoStatus = "pendente" | "aprovado" | "rejeitado" | "arquivado";
export type EmprestimoStatus = "pendente" | "aprovado" | "rejeitado" | "arquivado";

// Alias compatível
export type SolicitacaoStatus = RequisicaoStatus;

export type MovimentacaoTipo =
  | "entrada"
  | "saida"
  | "ajuste"
  | "solicitacao"
  | "estorno"
  | "emprestimo_saida"
  | "emprestimo_entrada";
