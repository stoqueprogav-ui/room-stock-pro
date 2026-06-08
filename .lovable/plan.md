# Plano — Plataforma de Gestão Operacional

Esse é um pacote grande (8 módulos). Vou propor uma divisão em **4 fases** para entregar valor rápido e validar cada parte antes de avançar. Confirme quais fases quer que eu execute (pode ser tudo de uma vez, mas o resultado fica mais sólido em etapas).

## Fase 1 — Consumo Interno (núcleo novo)

**Backend (migration):**
- Nova tabela `consumos_internos` (sala_id, produto_id, quantidade, motivo, observacao, usuario_id, created_at).
- Enum `motivo_consumo`: Consumo Interno, Evento, Uso Administrativo, Uso Operacional, Perda, Avaria, Descarte, Outro.
- Novo tipo em `movimentacoes.tipo`: `consumo_interno`.
- RPC `registrar_consumo_interno(_sala, _produto, _qtd, _motivo, _obs)`:
  - Verifica role master, baixa estoque, insere movimentação, insere consumo, chama `log_event`.
- RLS + GRANTs.

**Frontend:**
- Novo menu **Consumo Interno** (master).
- Página com formulário (sala → categoria → produto → quantidade → motivo → observação) + lista/busca dos consumos registrados.

## Fase 2 — Inventário

**Backend:**
- Tabela `inventarios` (codigo `INV-AAAA-0000`, sala_id nullable, data_referencia, total_itens, criado_por).
- Tabela `inventario_itens` (inventario_id, produto_id, sala_id, categoria_id, quantidade, unidade).
- RPC `gerar_inventario(_sala, _categoria, _produto)` → cria snapshot a partir do `estoque` atual.

**Frontend:**
- Menu **Inventário** com filtros (sala, categoria, produto, data), tabela, exportar PDF (jsPDF + autotable) e Excel (xlsx — já posso adicionar a dependência).
- Submenu **Histórico** listando inventários salvos com consulta posterior.

## Fase 3 — Central de Relatórios

Reaproveita a página `RelatoriosPage` existente, transformando em hub com abas:

1. **Inventário** (link p/ fase 2)
2. **Consumo Interno** — lista + filtros + ranking
3. **Consumo por Sala** — ranking com filtro Hoje/Semana/Mês/Ano/Personalizado
4. **Produtos Mais Consumidos** — ranking com filtros sala/categoria/período
5. **Requisições** — totais por sala, aprovadas/rejeitadas/arquivadas, top produtos
6. **Empréstimos** — quem mais empresta/pega, totais emprestados/devolvidos/pendentes
7. **Movimentações / Produtos / Salas / Auditoria** — atalhos com filtros + export

Cada aba: filtros, tabela, **Exportar PDF**, **Exportar Excel**, **Imprimir**.

## Fase 4 — Dashboard Gerencial do Master

Nova aba no `MasterOverview` (ou rota `/app/dashboard-gerencial`):
- KPIs: produtos, itens em estoque, movimentações do mês, requisições do mês, empréstimos ativos, consumos internos do mês.
- Gráficos (recharts — já no projeto):
  - Consumo por sala (barras)
  - Consumo por categoria (pizza)
  - Requisições por período (linha)
  - Empréstimos por período (linha)
  - Consumo interno por período (área)
- Top salas consumidoras e top produtos consumidos.

## Dependências a adicionar
- `xlsx` (export Excel) — `jspdf` e `jspdf-autotable` (provavelmente já há jsPDF; checo na hora).

## Detalhes técnicos
- Realtime via `useRealtimeSync` em todas as novas telas.
- Todas as RPCs como `SECURITY DEFINER` + checagem `has_role(... 'master')`.
- Auditoria via `log_event` em cada operação relevante.
- Exports respeitam os filtros ativos.

---

**Pergunta:** Posso executar tudo (Fases 1–4) em sequência agora, ou prefere que eu entregue Fase 1 primeiro e valide antes das próximas? Recomendo começar pela Fase 1 + Fase 2 — são as fundações que alimentam os relatórios e o dashboard.
