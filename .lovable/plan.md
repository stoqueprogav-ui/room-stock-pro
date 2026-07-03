# Refatoração e Correções do Sistema

Escopo grande e arquitetural. Proponho executar em 3 migrações + ajustes de frontend, na ordem abaixo. Cada bloco é atômico e reversível.

## 1. Notificações completas para o Master

Ampliar os triggers `_tg_notif_emprestimo`, `_tg_notif_devolucao` e a função `quitar_divida` para enviar notificação também para todos os usuários com papel `master`, exceto o `actor_id` (quem executou a ação).

Eventos cobertos para o Master:
- `emprestimo.criado`
- `emprestimo.aprovado` / `emprestimo.rejeitado` (pela sala credora)
- `emprestimo.aprovado_master` / `emprestimo.rejeitado_master`
- `emprestimo.editado`
- `devolucao.parcial` / `devolucao.total`
- `emprestimo.quitado_parcial` / `emprestimo.quitado_total`
- `emprestimo.arquivado`

Implementação: nova função `_notify_masters(evento, título, corpo, link, actor_id)` que insere em `notifications` para cada master (exceto o actor). Chamada em cada trigger/RPC relevante.

## 2. Unificar fluxo de "Quitar Empréstimo"

Auditar todos os pontos que hoje encerram/quitam empréstimo:
- `DividasPage` → RPC `quitar_divida` (correto)
- Qualquer botão em `EmprestimosPage` ou `DevolverEmprestimoDialog` que apenas mude status → substituir por chamada à mesma RPC `quitar_divida` (ou remover o botão duplicado)

Regra ajustada conforme sua observação: **`quitar_divida` NÃO devolve estoque**. O estoque só volta via `registrar_devolucao` (devolução física registrada pelo Master). A RPC apenas:
1. Verifica que `saldo = 0` (todos os itens já foram devolvidos fisicamente).
2. Se ainda houver saldo, rejeita com mensagem clara: "existe saldo pendente; registre a devolução antes de quitar".
3. Marca dívida como quitada / remove a linha.
4. Marca `emprestimos.status = 'arquivado'` quando todas as dívidas ligadas àquele empréstimo estiverem zeradas.
5. Registra `log_event('emprestimo.quitado', ...)`.
6. Envia notificações (credora, devedora, master).

Alteração da assinatura: `quitar_divida(_divida uuid)` — sem parâmetro `_quantidade`, pois a quitação é sempre total e depende do saldo já estar zerado.

Frontend: `DividasPage` remove o input de quantidade e passa a mostrar botão "Quitar" apenas quando `saldo = 0` (ou exibir aviso "aguardando devolução").

## 3. Cadastro de valor do produto não persiste

Bug de frontend em `ProdutosPage`: campo `custo_unitario` não está no payload do insert/update, ou está com key errada.

Correção:
- Ajustar formulário para incluir `custo_unitario` no `.insert(...)` e `.update(...)`.
- Exibir valor atual na edição.
- Garantir que `log_custo_produto` (trigger já existente) grave o histórico.

Relatórios e custo médio já usam `custo_unitario`/`custo_medio` — nenhuma mudança adicional necessária.

## 4. Produtos inativos devem aparecer no histórico

Auditar todas as queries que filtram por `ativo = true`. Manter esse filtro **apenas** em telas operacionais (nova requisição, novo empréstimo, seleção de produto para consumo interno, tela de estoque operacional).

Remover o filtro `ativo` em:
- Relatórios (`RelatoriosPage`, `DashboardGerencial`)
- Inventário histórico
- Movimentações
- Auditoria
- Central Analítica

Já implementado no backend nas RPCs de relatório (não filtram por `ativo`). O ajuste é frontend nas listagens/joins.

## 5. Reativação de produto

Investigar `reativar_produto`: função existe e faz `UPDATE ativo=true`, mas o frontend pode estar chamando outro caminho, ou o botão está oculto após inativação (filtro `ativo=true` na lista).

Correção:
- Em `ProdutosPage` adicionar toggle "Mostrar inativos" e botão "Reativar" para produtos com `ativo=false`.
- Confirmar chamada à RPC `reativar_produto`.

## 6. Remover conceito de Produto Global

**Este é o bloco mais crítico. Migração de dados obrigatória.**

Estado atual: `produtos.sala_id` pode ser `NULL` (global) ou apontar para uma sala. Estoque global existe como linhas em `estoque` por (produto, sala).

Migração proposta:

```text
Para cada produto P com sala_id IS NULL:
  Para cada sala S onde existe estoque(P, S) com quantidade > 0
                        OU movimentação histórica de (P, S):
    1. Criar novo produto P_S clonando P (nome, descricao, unidade,
       estoque_minimo, categoria_id, custo_unitario, ativo)
       com sala_id = S.id
    2. Repontuar em cascata:
       - estoque(P, S) → produto_id = P_S.id
       - movimentacoes(P, S) → produto_id = P_S.id
       - emprestimo_itens onde produto=P e sala origem=S → P_S
       - solicitacao_itens onde produto=P e sala=S → P_S
       - dividas onde produto=P e (credora=S ou devedora=S) → P_S
       - produto_custo_historico → clonar para P_S
       - consumos_internos(P, S) → P_S
       - devolucao_itens ligadas → P_S
  Ao final, deletar P (não haverá mais referências).
```

Depois: `ALTER TABLE produtos ALTER COLUMN sala_id SET NOT NULL`.

Ajustar triggers:
- `seed_estoque_for_new_produto`: sempre criar 1 linha de estoque (para a sala do produto).
- `seed_estoque_for_new_sala`: não copia mais produtos globais (não existem).

Frontend:
- `ProdutosPage` (master): agrupar por sala, obrigar seleção de sala ao criar.
- `NovaRequisicao`, `NovoEmprestimo`, `ConsumoInterno`: já filtram por sala ativa — validar.

Backup: a migração roda em transação; se algo falhar, rollback automático.

## Ordem de execução proposta

1. **Migração A** — notificações do Master + unificação de `quitar_divida` (baixo risco).
2. **Frontend A** — bug do campo `custo_unitario`, reativação, mostrar inativos em relatórios, unificar botões de quitar.
3. **Migração B** — remoção de Produto Global (com clone + repointing). Rodada isoladamente por segurança.
4. **Frontend B** — telas de produtos por sala, remoção de UI global.

## Confirmação antes de executar

Antes de iniciar, quero confirmar dois pontos:

1. **Migração de globais**: para produto global sem nenhum estoque > 0 e sem movimentação em nenhuma sala, posso **descartar** o registro (não há histórico), ou você prefere clonar para **todas** as salas mesmo assim?
2. **Regra de quitação**: confirmo que `quitar_divida` passará a **exigir saldo = 0** (sem devolver estoque). Se o Master clicar em "Quitar" com saldo pendente, o sistema mostra erro e orienta a registrar a devolução primeiro. Ok?

Assim que confirmar esses dois pontos executo na ordem acima.
