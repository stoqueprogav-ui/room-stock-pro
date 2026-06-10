# Plano — Central Analítica Executiva

Escopo grande. Vou entregar em **fases** para garantir qualidade. Confirme antes de iniciar.

## Fase 1 — Fundação financeira (base de tudo)

Sem custo unitário cadastrado, nenhum relatório financeiro funciona. Esta fase é obrigatória primeiro.

1. **Migração de banco**:
   - Adicionar `custo_unitario NUMERIC(12,2) DEFAULT 0` em `produtos`.
   - Criar tabela `produto_custo_historico` (produto_id, valor_anterior, valor_novo, alterado_por, alterado_em) com RLS + GRANTs.
   - Trigger em `produtos` que grava histórico quando `custo_unitario` muda.
   - Função `valor_estoque_por_sala()` e `valor_consumido(periodo, filtros)` (SECURITY DEFINER).
2. **UI Produtos**: campo "Custo unitário (R$)" no cadastro/edição + aba "Histórico de custo" no card expandido.

## Fase 2 — Limpeza e renomeação

- Renomear menu "Relatório de Inventário" → **"Inventário"** (`AppLayout.tsx`).
- Remover da Central Analítica os atalhos: Inventários, Consumo Interno, Movimentações, Requisições, Empréstimos, Auditoria, Dívidas.

## Fase 3 — Central Analítica reconstruída

Nova `RelatoriosPage.tsx` em **abas**, cada uma com filtros (período, sala, categoria), tabela + gráficos (Recharts) + exportação PDF/Excel/Impressão:

| Aba | Conteúdo |
|---|---|
| **Dashboard Executivo** | KPIs (valor total estoque, consumo do mês, sala/produto/categoria líder), evolução mensal consumo & custo, Top 10 produtos, Top 10 salas |
| **Empréstimos** | Sala que mais empresta/solicita, pendentes/devolvidos/arquivados, rankings credoras/devedoras, evolução mensal |
| **Ranking de Salas** | Top 10: requisições, consumo, empréstimos pegos, empréstimos feitos, custo |
| **Consumo por Sala** | Qtde, movimentações, requisições, empréstimos, % global, valor R$ |
| **Produtos Mais Consumidos** | Top 10 com filtros global/sala/categoria/período |
| **Comparativo entre Salas** | Matriz produto × sala |
| **Financeiro de Consumo** | Qtde × valor com filtros |
| **Custo por Sala** | Ranking R$ |
| **Categorias** | Qtde, valor, % |
| **Curva ABC** | Classificação A/B/C automática |
| **Valor de Estoques** | Valor por sala + total consolidado |

## Fase 4 — Exportação executiva

- Estender `exporters.ts`:
  - `exportExecutiveExcel`: 4 abas (Resumo, Dados, Indicadores, Gráficos como imagens).
  - PDF com **Resumo Executivo** no topo + gráficos renderizados via `html2canvas` da área visível.
- Cabeçalho padrão (já existe) + rodapé já existente.

## Detalhes técnicos

- Dependências novas: `html2canvas` (gráficos no PDF). `recharts` já presente.
- Todos os cálculos financeiros em SQL/RPC para performance (não no cliente).
- Cache de resultados por sessão (useMemo) ao trocar de aba.

## Tamanho estimado

~15 arquivos novos/editados, 2 migrações. Vou executar **fase por fase**, validando cada uma antes da próxima.

## Pergunta antes de começar

Posso iniciar pela **Fase 1 (custo unitário + histórico)**? Sem ela as fases financeiras (10–16, 22) não têm dados reais — mostrariam tudo zerado. Se preferir, posso começar pelas fases não-financeiras (2, 3 parcial, 4) e deixar custos para depois.
