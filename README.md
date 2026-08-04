# Inventory Harmony

Crie um sistema SaaS completo de controle de estoque com múltiplos usuários, permissões e múltiplos estoques (salas), utilizando banco de dados nativo do Lovable.

🔐 1. SISTEMA DE LOGIN E PERMISSÕES

O sistema deve possuir autenticação com 3 níveis de usuários:

👑 MASTER

 Acesso total ao sistema

 Pode:

 Criar, editar e excluir usuários

 Criar, editar e excluir produtos

 Controlar quantidade de estoque

 Criar, editar e excluir salas (estoques)

 Visualizar todas as salas e estoques

 Aprovar ou rejeitar solicitações

 Visualizar todos os relatórios

 Controlar empréstimos entre salas

 Dar baixa em dívidas entre salas

🛠️ ADMINISTRADOR

 Vinculado a uma única sala

 Pode:

 Visualizar estoque da sua sala

 Fazer solicitações de retirada ao Master

 Solicitar empréstimos para outras salas

 Aprovar ou rejeitar pedidos de empréstimo recebidos

 NÃO pode:

 Criar usuários

 Criar produtos

 Alterar estoque manualmente

📦 ANALISTA

 Vinculado a uma única sala

 Pode:

 Visualizar estoque da sua sala

 Fazer solicitações ao Master

 Solicitar empréstimos

 NÃO pode:

 Aprovar empréstimos

 Alterar estoque

 Gerenciar usuários ou produtos

🏢 2. ESTRUTURA DE ESTOQUES (SALAS)

O sistema inicia com 5 salas:

 Matriz

 Parque Luguito

 Casa Lugano

 Hortênsias

 NASA

Cada sala possui:

 Seu próprio estoque independente

 Usuários vinculados (Admin e Analista)

O Master pode criar novas salas com estoque próprio.

📊 3. DASHBOARD DO MASTER

Tela inicial:

 Lista de todas as salas

 Seleção de sala para gerenciamento

Dentro da sala:

📥 Pedidos recebidos

 Solicitações de retirada (Admin/Analista)

 Status: pendente, aprovado, rejeitado

🔄 Empréstimos

 Pedidos de empréstimo:

 Pendentes

 Aprovados

 Visão completa de todas as transações

📦 Controle de estoque

 Lista de produtos com:

 Nome

 Quantidade

 Ações:

 Adicionar produto

 Remover produto

 Ajustar quantidade

📈 Relatórios

 Produtos mais consumidos

 Salas que mais consomem

 Histórico de movimentações

👥 Gestão

 Criar / editar / excluir:

 Usuários

 Salas

💳 Controle de dívidas entre salas

 Registro automático de empréstimos

 Controle de saldo entre salas

 Opção de quitar dívida (baixa manual pelo Master)

🛠️ 4. DASHBOARD DO ADMINISTRADOR

📊 Visão geral

 Consumo da sala

 Alerta de estoque baixo (definir limite mínimo)

📤 Solicitação ao Master ("Realizar Solicitação")

 Lista de produtos disponíveis

 Exibir quantidade atual

 Informar quantidade desejada

✅ Regra:

 Ao enviar solicitação → dar baixa automática no estoque

🔄 Pedir Empréstimo

 Escolher:

 Sala destino

 Produto

 Quantidade

✅ Aprovar Empréstimos

 Ver pedidos recebidos

 Aprovar ou rejeitar

✅ Regra:

 Ao aprovar:

 Baixa automática no estoque da sala que emprestou

 Entrada automática na sala que recebeu

 Registrar dívida entre salas

📦 5. DASHBOARD DO ANALISTA

 Visualizar estoque da sua sala

 Fazer solicitações ao Master

 Solicitar empréstimos

✅ Regras:

 Não pode aprovar empréstimos

 Ao solicitar:

 Baixa automática no estoque

🔄 6. REGRAS DE NEGÓCIO (IMPORTANTÍSSIMO)

📉 Baixa automática de estoque

 Ao solicitar retirada → baixa imediata

 Ao empréstimo aprovado → baixa na origem + entrada no destino

⚠️ Controle de estoque mínimo

 Definir limite por produto

 Exibir alerta para:

 Admin

 Master

🔗 Rastreabilidade

 Todo movimento deve ser registrado:

 Quem fez

 Quando

 Tipo (retirada, empréstimo, ajuste)

🧠 7. MODELAGEM DE DADOS (SUGERIDA)

 Usuários:

 id

 nome

 email

 senha

 tipo (master/admin/analista)

 sala_id

 Salas:

 id

 nome

 Produtos:

 id

 nome

 Estoque:

 id

 produto_id

 sala_id

 quantidade

 Solicitações:

 id

 usuario_id

 sala_id

 status

 itens

 Empréstimos:

 id

 sala_origem

 sala_destino

 status

 itens

 Dívidas:

 sala_devedora

 sala_credora

 saldo

🚀 8. DIFERENCIAIS (PARA DEIXAR O SISTEMA MAIS PROFISSIONAL)

 Filtros por data nos relatórios

 Histórico completo por produto

 Dashboard com gráficos

 Notificações internas

 Log de atividades

Login master inicial:
luanbarretoandrade@hotmail.com
Senha Tavia1991!

depois quero poder alterar o login do usuario master

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://room-stock-pro.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/33c75874-2ad7-4ec1-b041-88b0180d5390).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
