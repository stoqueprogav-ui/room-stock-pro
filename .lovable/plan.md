# Catálogo de Produtos + Estoque por Sala

Concordo 100% com a ressalva: agrupar por texto é fonte garantida de bug. A solução é uma nova tabela de **catálogo** (identidade) referenciada por cada registro de estoque da sala.

## Modelo alvo

```text
produtos_catalogo         ← IDENTIDADE do item
  id, nome, descricao, unidade_padrao, categoria_id, ativo

produtos                  ← REGISTRO DE ESTOQUE por sala (o que já existe hoje)
  id, catalogo_id (FK), sala_id, custo_unitario, estoque_minimo, ativo
  (nome/descricao/unidade/categoria passam a vir do catálogo via view/join)

estoque, movimentacoes, emprestimo_itens, solicitacao_itens,
dividas, devolucao_itens, produto_custo_historico, consumos_internos
  → continuam apontando para produtos.id (registro da sala). Nada muda.
```

Um item novo é criado no catálogo **uma vez**. Depois cada sala que "adota" o item ganha um `produtos` (registro de estoque) apontando para o mesmo `catalogo_id`.

## Migração de dados (idempotente, em transação)

1. `CREATE TABLE produtos_catalogo` com GRANTs + RLS (leitura autenticados, escrita master).
2. Agrupar `produtos` existentes por `normalize(nome)` (`lower(unaccent(trim))`) e criar 1 linha de catálogo por grupo. Nome exibido = versão mais comum (moda).
3. `ALTER TABLE produtos ADD COLUMN catalogo_id uuid REFERENCES produtos_catalogo(id)`.
4. Backfill: `UPDATE produtos SET catalogo_id = ...` pelo mesmo `normalize(nome)`.
5. `ALTER TABLE produtos ALTER COLUMN catalogo_id SET NOT NULL`.
6. Índice `(catalogo_id, sala_id)` único → uma sala não pode ter 2 registros do mesmo item de catálogo.
7. Trigger: ao criar novo `produtos`, se `nome` bater com catálogo existente (mesmo normalize), reaproveita o `catalogo_id`; senão cria um novo.

## RPC nova: `catalogo_disponibilidade(_catalogo uuid, _quantidade int, _excluir_sala uuid)`

Retorna lista de salas ordenadas por atendimento:

```sql
sala_id, sala_nome, produto_id, disponivel, atende_pct, atende_total
```

Já filtra `estoque - reservado`. Reaproveita a lógica do modal atual, mas parte do catálogo em vez de produto físico.

## Frontend

### NovoEmprestimo / NovaRequisicao (fluxo novo)
1. Combobox lista **catálogo** (um item = "Água sem gás"), não `produtos`.
2. Usuário escolhe item + quantidade.
3. Chama `catalogo_disponibilidade` → mostra salas com % de atendimento (UI já existente, só troca a fonte).
4. Ao confirmar, o `emprestimo_itens.produto_id` gravado é o `produtos.id` **da sala credora escolhida** — schema não muda, só a origem do valor.

### ProdutosPage (master)
Duas abas:
- **Catálogo**: cadastrar nome/categoria/unidade/descrição do item base.
- **Estoque por sala**: para cada item do catálogo, listar salas onde ele existe (com custo, mínimo, ativo, saldo). Botão "Adicionar em outra sala" cria um `produtos` apontando ao mesmo catálogo.

Formulário de "Novo produto" fica em duas etapas: escolher item do catálogo (ou criar novo) → escolher sala + custo inicial + qtd inicial.

### Telas operacionais (Estoque, Inventário, Relatórios)
Continuam por `produtos` (registro de sala) — é o que faz sentido operacionalmente. Só ganham a coluna extra "Item de catálogo" quando útil para agrupar.

## Ordem de execução

1. **Migração A**: cria `produtos_catalogo`, backfill, FK, unique index, trigger de auto-vinculação. Baixo risco, não altera queries existentes (nome/unidade continuam em `produtos`).
2. **RPC B**: `catalogo_disponibilidade`.
3. **Frontend C**: `NovoEmprestimo` e `NovaRequisicao` passam a buscar por catálogo.
4. **Frontend D**: `ProdutosPage` reorganizada em Catálogo + Estoque por sala.
5. **Cleanup opcional (futuro)**: mover `nome`/`descricao`/`unidade`/`categoria_id` de `produtos` para o catálogo (deixando `produtos` só como registro de estoque puro). Fica pra depois porque toca em muitas queries; por ora, sincronizamos via trigger `produtos.nome := catalogo.nome` em todo insert/update de catálogo, mantendo compat.

## Perguntas antes de executar

1. **Deduplicação inicial**: no backfill vou agrupar por `lower(unaccent(trim(nome)))`. Isso vai unificar "Água", "AGUA", "água" no mesmo catálogo. Ok? Se quiser revisão manual antes de consolidar, gero um relatório dos grupos e você aprova.
2. **Unidade padrão**: se duas salas cadastraram o mesmo item com unidades diferentes ("Fardo" vs "Unidade"), qual regra? Sugiro manter a unidade específica de cada registro `produtos` (é o que já acontece) e o catálogo guarda só a "unidade de referência" (a mais comum). Isso preserva os dados históricos.
3. **Categoria**: mesma situação. Sugiro que a categoria fique no catálogo (identidade do item), e removemos `categoria_id` de `produtos` no cleanup futuro. Ok?

Depois que você confirmar, começo pela Migração A.
