
# Plano — Custos, Entradas de Estoque e Valorização Financeira (Custo Médio Ponderado)

Esta é uma evolução grande do sistema. Vou entregar em **fases** para garantir qualidade, sem quebrar nada do que já existe (multiestoque, requisições, empréstimos, consumo interno, devoluções, dívidas, movimentações, auditoria).

A base de tudo é a nova tabela **`entradas_estoque`** + recálculo automático de **Custo Médio Ponderado (CMP)** por (produto, sala).

---

## Fase 1 — Núcleo financeiro (banco de dados)

**Migração 1** (estrutura):
- Criar tabela `entradas_estoque`: produto_id, sala_id, quantidade, valor_unitario, valor_total (gerado), fornecedor, numero_nf, data_entrada, observacao, usuario_responsavel, created_at — com RLS + GRANTs.
- Adicionar em `estoque`: `custo_medio NUMERIC(12,4) DEFAULT 0` e `valor_total NUMERIC(14,2) DEFAULT 0` (recalculados automaticamente — somente leitura para o app).
- Adicionar em `movimentacoes`: `custo_unitario_aplicado` e `valor_financeiro` (preenchidos no momento da saída/entrada, congelando o CMP vigente — não muda mesmo se o custo mudar depois).
- Adicionar em `dividas`: `valor_financeiro` (somatório histórico do custo no momento do empréstimo, atualizado em devoluções).
- Adicionar em `emprestimo_itens` e `devolucao_itens`: `valor_unitario_aplicado` + `valor_total`.

**Migração 2** (lógica — funções e triggers SECURITY DEFINER):
- `registrar_entrada_estoque(produto, sala, qtd, valor_unit, fornecedor, nf, obs)` — insere em `entradas_estoque`, atualiza `estoque.quantidade`, recalcula CMP com fórmula `(qtd_atual * cmp_atual + qtd_nova * valor_unit) / (qtd_atual + qtd_nova)`, grava movimentação tipo `entrada` com custo aplicado, atualiza `valor_total`, registra `log_event`.
- Atualizar `decidir_solicitacao`, `decidir_emprestimo`, `registrar_consumo_interno`, `ajustar_estoque`, `registrar_devolucao` para:
  - Preencher `custo_unitario_aplicado` e `valor_financeiro` em cada movimentação usando o CMP da sala de origem.
  - Recalcular `estoque.valor_total = quantidade * custo_medio` após cada saída.
  - Empréstimo: gravar `valor_unitario_aplicado` no item; atualizar `dividas.valor_financeiro`.
  - Devolução: entra na sala credora pelo CMP do momento do empréstimo (preserva valor original) e baixa `dividas.valor_financeiro` proporcionalmente.
- Função `recalcular_cmp_todos()` — backfill inicial usando o histórico de movimentações de entrada existente (estima CMP atual a partir de movimentações `entrada` ou `ajuste` positivas, ou usa o `custo_unitario` legado em `produtos` como ponto de partida quando não houver histórico).

**Migração 3** (relatórios — RPCs):
- `relatorio_valor_estoque_por_sala()` → sala, qtd_total, valor_total.
- `patrimonio_global()` → escalar.
- `relatorio_consumo_financeiro(_from, _to, _sala, _categoria, _produto)` → produto, sala, categoria, qtd, valor.
- `relatorio_custo_por_sala(_from, _to)` → sala, qtd, valor, participacao_pct.
- `relatorio_categorias_financeiro(_from, _to)` → categoria, qtd, valor, participacao_pct.
- `relatorio_top_produtos_financeiro(_from, _to, _limit)` e `top_custos`.
- `curva_abc(_from, _to)` → produto, valor, pct_acumulado, classe (A/B/C).
- `comparativo_salas_financeiro(_from, _to)` → matriz qtd/valor/estoque/participação.
- `evolucao_mensal_financeira(_meses)` → mês, qtd_consumida, valor_consumido, valor_compras.

---

## Fase 2 — UI: Entradas de Estoque

Nova página `src/pages/master/EntradasEstoquePage.tsx` (rota `/app/entradas`, no menu Operacional):

- Botão **"Nova Entrada"** → modal com: Produto (autocomplete), Sala (default = escopo master), Quantidade, Valor Unitário (R$), **Valor Total calculado em tempo real**, Fornecedor, NF, Data, Observação.
- Tabela paginada com filtros (sala, produto, fornecedor, período, NF).
- KPI: total de compras no período (R$).
- Exportação Excel/PDF/Impressão (usando `exporters.ts` já existente).

---

## Fase 3 — UI: Produtos com dados financeiros

Em `ProdutosPage.tsx`:
- **Remover** o campo de "Custo unitário" editável (passa a ser **calculado**). Manter coluna legada como histórico inicial.
- Card expandido do produto exibe, por sala: **Quantidade Atual / Custo Médio / Valor em Estoque** (consulta `estoque`).
- Nova aba **"Histórico Financeiro"** dentro do card: lista todas as entradas (`entradas_estoque`) do produto, com filtro por sala.
- Aviso visual quando produto ainda não tem nenhuma entrada (CMP = 0).

---

## Fase 4 — Dívidas com valor financeiro

Em `DividasPage.tsx`:
- Adicionar colunas **Valor Financeiro** e **Saldo Devedor R$** (já calculado pelas RPCs).
- KPI no topo: total devido entre salas (R$).
- Quitação manual continua existindo; recalcula valor proporcional.

---

## Fase 5 — Movimentações financeiras visíveis

Em `MovimentacoesPage.tsx` e `MovimentacoesMasterPage.tsx` (timeline):
- Mostrar `valor_financeiro` em cada evento de saída/entrada/empréstimo/consumo/devolução.
- Filtro adicional: "Apenas eventos com valor".

---

## Fase 6 — Central Analítica financeira

Estender `RelatoriosPage.tsx` (já tem 10 abas) com:

- **Dashboard Executivo**: novos KPIs — Patrimônio Global, Valor Consumido no Mês, Sala mais cara, Produto mais caro, Categoria mais cara, evolução mensal de **compras vs. consumo** (R$).
- **Consumo Financeiro** (filtros sala/categoria/produto/período).
- **Custo por Sala** (com participação %).
- **Categorias Financeiras** (qtd, valor, %).
- **Produtos mais caros** (ranking R$).
- **Comparativo entre Salas** (qtd, valor consumido, valor em estoque, %).
- **Curva ABC** automática (A 80% / B 15% / C 5%).
- **Valor de Estoques** por sala + patrimônio global.
- Gráficos Recharts para cada aba (barras, pizza, linha de evolução mensal).
- Exportação Excel multi-aba + PDF executivo (já existem — adicionar as novas tabelas).

---

## Fase 7 — Preparação para o futuro (estrutural, sem UI ainda)

- Tabela `fornecedores` opcional referenciada por `entradas_estoque.fornecedor_id` (mantenho `fornecedor` texto livre por compatibilidade).
- Índices: `entradas_estoque(produto_id, sala_id, data_entrada)`, `movimentacoes(sala_id, tipo, created_at)`.
- Deixa preparado para: sugestão de reposição (basta query sobre `estoque.quantidade < estoque_minimo`), comparativo de preços (já temos `entradas_estoque.fornecedor + valor_unitario`), análise de inflação (`AVG(valor_unitario) GROUP BY mês`).

---

## Detalhes técnicos importantes

- **Custo congelado nas movimentações**: cada movimentação grava o CMP do instante. Mesmo se o CMP mudar depois, relatórios históricos permanecem corretos.
- **Empréstimos**: o valor é o CMP do credor no momento da aprovação. A dívida acompanha esse valor; devolução baixa proporcionalmente.
- **Devoluções**: entram pelo valor original do empréstimo (não pelo CMP atual do devedor) — isso preserva integridade financeira entre salas.
- **Backfill seguro**: a migração inicial **não inventa preços**; produtos sem entrada ficam com CMP 0 até a primeira entrada manual. Caso já exista `produtos.custo_unitario` cadastrado, é usado como CMP inicial (mantém continuidade do que já foi feito na fase anterior).
- **Sem quebrar nada**: todas as RPCs existentes continuam funcionando; novos campos têm DEFAULT 0; UI antiga continua exibindo quantidades normalmente.

---

## Tamanho estimado

- **3 migrações** de banco (estrutura + lógica + RPCs).
- **~12 arquivos** editados/criados no frontend.
- Vou executar **fase por fase**, validando antes de seguir.

---

## Pergunta antes de começar

Posso iniciar pela **Fase 1 (migrações de banco)**? É a base — sem ela nenhuma UI financeira funciona. Cada migração será apresentada para sua aprovação antes de rodar.

Confirma também: **devo remover o campo "Custo unitário" editável do cadastro de produto** (substituindo por CMP calculado), ou prefere manter como "custo inicial sugerido" para produtos sem entrada?
