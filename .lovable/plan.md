## Plano de Implementação

Três melhorias estruturais. Vou implementar em sequência, com migração de banco para o reset e ampliação do schema de produtos.

### 1. Identificação visível da sala/cargo do usuário

- **`AppLayout.tsx`** (header e sidebar):
  - No header: adicionar badge destacado com `📍 Sala: <nome>` (ou "Visão Global" para Master) ao lado do nome do papel.
  - Na sidebar (rodapé do usuário): incluir linha com cargo + sala em destaque (cor primária suave, ícone `MapPin`).
- **`MasterOverview` / `SalaOverview`**: já exibem nome, reforçar com chip de sala/cargo logo abaixo do título.
- **`ChatPage`**: adicionar barra superior mostrando "Você: <nome> · <cargo> · <sala>".
- Para Master usar `MasterScopeContext` (sala em foco ou "Global").

### 2. Reset Total do Sistema (Modo Teste)

- **Migração**: criar função `public.reset_sistema_total()` SECURITY DEFINER que:
  - Verifica `has_role(auth.uid(), 'master')`.
  - Em ordem: `DELETE FROM messages, conversation_reads, conversation_participants, conversations, devolucao_itens, devolucoes, emprestimo_itens, emprestimos, solicitacao_itens, solicitacoes, dividas, movimentacoes, estoque, produtos, categorias`.
  - `DELETE FROM profiles WHERE id NOT IN (SELECT user_id FROM user_roles WHERE role='master')`.
  - `DELETE FROM user_roles WHERE role <> 'master'`.
  - `DELETE FROM salas`.
  - Retorna `jsonb` com contagens.
  - Nota: usuários `auth.users` não-master serão removidos via edge function complementar (`admin-reset-system`) usando service role, já que SQL não pode apagar de `auth.users` com segurança a partir da app.
- **Edge function `reset-system`**: chama RPC, depois lista `auth.users` e apaga todos cujo id não esteja em `user_roles role=master`.
- **UI**: nova página `src/pages/master/ConfiguracoesPage.tsx` com card "Zona de Perigo" → botão "Resetar Sistema" → modal exige digitação literal de `RESETAR SISTEMA`. Rota `/app/configuracoes` no menu Master.

### 3. Edição avançada de produtos

- **Migração**: nada novo no schema (campos já existem: nome, descricao, unidade, estoque_minimo, categoria_id, sala_id, ativo).
- **`ProdutosPage.tsx`**: adicionar botão "Editar" por linha que abre modal completo com todos os campos:
  - Nome, Descrição, Categoria (select), Unidade (select com presets: Unidade, Caixa, Fardo, Pacote, Kit, Litro, Galão, Rolo, Par, Metro, Outros + livre), Estoque mínimo, Sala (select ou Global), Ativo (switch).
  - Salvar via `update` em `produtos` (RLS master_all já permite).
  - Trocar unidade NÃO mexe em estoque/movimentações.
- Realtime já garantido por `useRealtimeSync`.

### Arquivos a criar/editar

- migration: função `reset_sistema_total`
- `supabase/functions/reset-system/index.ts` (nova)
- `supabase/config.toml` (registrar função se necessário)
- `src/pages/master/ConfiguracoesPage.tsx` (nova)
- `src/pages/master/ProdutosPage.tsx` (modal de edição)
- `src/components/AppLayout.tsx` (badges sala/cargo + nav item Configurações)
- `src/App.tsx` (rota `/app/configuracoes`)
- `src/pages/ChatPage.tsx` (barra de identidade superior)

Histórico de alterações de produto fica fora do escopo desta entrega (recomendado, não obrigatório) para manter a entrega focada.
