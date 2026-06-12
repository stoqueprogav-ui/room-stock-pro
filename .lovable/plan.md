## Plano de entrega em 3 fases

Os três blocos pedidos são grandes e independentes. Vou entregá-los em fases para reduzir risco e permitir validação intermediária.

---

### Fase 1 — Status de produto por sala (bug crítico)

Hoje `produtos.ativo` é global. Reativar/desativar afeta todas as salas — é o bug mais grave.

**Banco**
- Adicionar coluna `ativo boolean not null default true` na tabela `estoque`.
- Backfill: copiar valor atual de `produtos.ativo` para todas as linhas existentes em `estoque`.
- `produtos.ativo` passa a significar apenas "arquivado globalmente" (oculta de cadastros novos). Permanece, mas deixa de ser usado para filtrar disponibilidade por sala.
- Função `toggle_produto_sala_ativo(_produto_id, _sala_id, _ativo)` com checagem de role (master/admin).
- Registrar em `system_logs`: usuário, ação, produto, sala, data.

**Frontend**
- `EstoquePage`, `NovaRequisicao`, `NovoEmprestimo`, `ConsumoInternoPage`: filtrar por `estoque.ativo` (não mais `produtos.ativo`).
- `ProdutosPage` (Master): ao expandir o produto, listar salas com badges "Ativo / Inativo" e ações "Ativar nesta sala" / "Desativar nesta sala" por linha.
- Remover botão global "Ativar/Desativar produto" (ou renomear para "Arquivar globalmente" com confirmação).

---

### Fase 2 — Edição de solicitação de empréstimo pendente

**Banco**
- RPC `editar_emprestimo(_id, _sala_credora_id, _itens, _observacao, _justificativa)` que:
  - Valida status = `pendente`.
  - Valida que o ator é o criador ou master.
  - Substitui itens em `emprestimo_itens`, atualiza campos da `emprestimos`.
  - Registra log detalhado (itens adicionados/removidos/alterados) em `system_logs`.
  - Cria notificação para o Master "Solicitação #X atualizada pelo solicitante".

**Frontend**
- `EmprestimosPage` e tela de detalhe: botão "Editar solicitação" visível apenas se `status='pendente'` e (usuário=criador OU role=master).
- Reaproveitar o componente de criação (`NovoEmprestimo`) em modo edição (carrega itens existentes; submit chama `editar_emprestimo`).
- Após aprovado/rejeitado/arquivado: botão some, formulário só-leitura.

---

### Fase 3 — Auto-save de rascunhos (IndexedDB)

**Infraestrutura**
- Lib `src/lib/drafts.ts` usando IndexedDB (via `idb` ou wrapper próprio leve, sem dependência nova se possível).
- Estrutura: `{ id, scope, userId, payload, updatedAt, itemCount }` onde `scope` = `requisicao:new`, `requisicao:edit:<id>`, `emprestimo:new`, `emprestimo:edit:<id>`, `devolucao:<id>`, `consumo:new`, `consumo:edit:<id>`, `produto:new`, `produto:edit:<id>`, `inventario:<id>`.
- Hook `useDraft(scope, value, setValue)`:
  - Debounce 400ms; salva a cada mudança de estado.
  - Expõe `status: "idle" | "saving" | "saved" | "error"` e `lastSaved: Date`.
  - Limpa rascunho via `clear()` quando o form submete com sucesso.
- Componente `<DraftStatusBadge />` no topo do form: "● Salvando..." / "✓ Rascunho salvo às HH:MM:SS" / "⚠ Erro ao salvar".
- Componente `<RecoverDraftDialog />` aberto ao montar a tela se houver rascunho do mesmo `scope` para o usuário atual. Botões "Recuperar" / "Descartar".
- `beforeunload` warning quando há diff não salvo (status `saving`).
- "Central de recuperação" em `Index.tsx` pós-login: lista rascunhos do usuário com tipo, data, contagem; permite abrir ou descartar.

**Telas integradas (nesta ordem)**
1. `NovaRequisicao` e edição
2. `NovoEmprestimo` + edição (depende da Fase 2) + Devolução
3. `ConsumoInternoPage` (cadastro/edição)
4. `ProdutosPage` (cadastro/edição) e `InventarioPage` (conferência)

**Comentários do Master em aprovação/rejeição:** salva no `scope` `aprovacao:<id>` / `rejeicao:<id>`.

---

### Decisões já tomadas (já que pulou as perguntas)

- Ordem: **Fase 1 → Fase 2 → Fase 3** (bug crítico primeiro, depois retrabalho operacional, por fim qualidade de vida).
- Status por sala usa coluna nova em `estoque` (não cria tabela nova) — toda dupla produto×sala já tem linha.
- Rascunhos em IndexedDB local, por usuário; nunca tocam o backend.
- Auto-save começa por requisição e empréstimo (telas com mais itens), demais telas em segundo lote da Fase 3.

---

### Próximo passo

Vou começar pela **Fase 1**: migração que adiciona `estoque.ativo` + RPC `toggle_produto_sala_ativo` + ajustes de UI. Confirme aqui no chat (ou diga "siga") e eu disparo a migração.