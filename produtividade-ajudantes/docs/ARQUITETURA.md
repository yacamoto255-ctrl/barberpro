# LogiPonto — Análise, arquitetura e regras de negócio

## 1. Análise da lógica de medição (antes da implementação)

| Risco | Como foi tratado |
|---|---|
| **Duplicidade de apontamento** (leitor "repete" o bipe, duplo clique) | Debounce de 1,5 s no front; no banco, índice único parcial `ux_part_helper_open (helper_id) WHERE status='ATIVO'`; transação `BEGIN IMMEDIATE`. Teste: 5 bipes simultâneos ⇒ 1 apontamento. |
| **Ajudante contado 2× na mesma atividade** | Rateio gravado em `activity_allocations` com `UNIQUE(activity_id, helper_id)`; se o ajudante sai e volta, os segmentos de tempo somam, mas ele conta **uma vez** no rateio. |
| **Atividades simultâneas** | Um ajudante só pode estar em 1 atividade aberta. Para mudar, o sistema pede confirmação de **troca** (finaliza a atual e inicia a nova no mesmo instante). Correções de horário recusam sobreposição. Uma **carga** pode ter várias atividades simultâneas (ex.: carregamento + praça). |
| **Carga que passa por várias atividades** | Cada atividade é uma **execução** separada (`activities`), com peso de referência próprio. Não há rateio entre atividades diferentes. |
| **Dois ou mais ajudantes juntos** | Só existe 1 execução aberta por (carga, atividade, praça) — índice `ux_activity_open`. Quem inicia a mesma atividade na mesma carga **entra** na execução existente e o rateio é feito entre eles. |
| **Movimentação para praça** | Tipo de atividade com `requires_square=1`; praça padrão = praça da carga, pode ser trocada; aceita **peso/volumes parciais** (viagens parciais). Indicadores por praça no dashboard. |
| **Kg × volumes** | Rateados separadamente (`allocated_weight_kg`, `allocated_volumes`), com fatores independentes na regra. |
| **"Peso atribuído" confundido com peso carregado** | Dashboard mostra lado a lado **peso físico das cargas (sem duplicar)** e **kg atribuídos (produtividade)**, com aviso explicativo; relatórios trazem nota. |
| **Mudança futura da regra de rateio** | Regras em `productivity_rules` (método + fatores). A regra vigente é **fotografada** em `activities.rule_snapshot` — mudar a regra não altera o passado. Recalcular o passado é explícito (ADMIN + motivo + auditoria). |
| **Histórico/auditoria confiável** | `audit_logs` somente-inserção (triggers bloqueiam UPDATE/DELETE); horários vêm do servidor; cancelamento/correção exigem motivo; exclusão física bloqueada para registros com histórico (usa-se inativar). |
| **kg/h distorcido** por apontamento de segundos | Taxas por hora só são calculadas com ≥ 5 min apontados (`MIN_SECONDS_FOR_RATE`). |
| **Integração futura** | `external_id` + `source` em cargas, conferentes, praças e ajudantes; API `/api/integration/*` com chave, upsert idempotente, resultado por item (HTTP 207). Ponto de extensão em `src/integrations/tmsAdapter.js`. |

## 2. Arquitetura

- **Backend:** Node.js ≥ 22.13 + Express 4, camadas: `routes` (HTTP/validação) → `services` (regras) → `domain/allocation.js` (rateio puro, sem banco) → `db`.
- **Banco:** SQLite nativo (`node:sqlite`), WAL, chaves estrangeiras, migrações versionadas. SQL escrito para ser portável para **PostgreSQL** (recomendado em produção com vários servidores).
- **Frontend:** SPA em JavaScript puro (ES modules, sem build), roteamento por hash, CSS responsivo próprio. CSP estrita (`script-src 'self'`, sem estilos inline) e escape automático de todo conteúdo dinâmico (`html\`\``).
- **Segurança:** JWT HS256 (10 h) com revogação por `token_version` (logout, troca de senha/perfil), bcrypt, bloqueio após 5 senhas erradas, limite de requisições, cabeçalhos de segurança, consultas parametrizadas, proteção contra injeção de fórmulas no CSV/XLSX.
- **Horários:** gravados como hora local do fuso `APP_TZ` (America/Sao_Paulo).

## 3. Banco de dados

```
users ─┐ (quem opera o sistema: ADMIN/GESTOR/OPERADOR)
teams, shifts ──< helpers (barcode ÚNICO = identificação do ajudante)
checkers, squares ──< loads (carga: peso, volumes, conferente, praça, external_id)
productivity_rules ──< activity_types (regra por tipo de atividade)
loads + activity_types + squares ──< activities (execução; rule_snapshot; peso de referência)
activities ──< activity_participants (segmentos de tempo por ajudante; turno/equipe fotografados)
activities ──< activity_allocations (crédito do rateio: 1 por ajudante por execução)
audit_logs (somente inserção)
```

Índices anti-duplicidade: `ux_part_helper_open`, `ux_activity_open`, `UNIQUE(activity_id, helper_id)` em allocations, UNIQUE em `helpers.barcode`, `cpf`, `registration`, `loads.load_number`, `external_id`.

## 4. Regras de negócio principais

1. Código de barras identifica **somente** o ajudante; ajudante INATIVO não é aceito.
2. Início: exige ajudante + carga ABERTA + atividade ativa (+ praça se exigida).
3. Mesmo ajudante, mesma atividade aberta ⇒ recusado (`JA_PARTICIPANDO`); outra atividade ⇒ exige troca (`AJUDANTE_OCUPADO`).
4. Fim: bipar de novo (em até 15 s após a identificação), botão FINALIZAR, ou "Finalizar atividade" (todos). A execução fecha quando sai o último ajudante e o rateio é gravado.
5. Rateio (configurável por tipo de atividade): `RATEIO_IGUAL` (padrão; centavos restantes para os últimos a entrar: 333,33/333,33/333,34), `PROPORCIONAL_TEMPO`, `CREDITO_INTEGRAL`, todos com fator de peso e de volumes.
6. Só execuções FINALIZADAS entram na produtividade; em andamento aparecem como "prévia".
7. Operador cancela bipe errado em até 10 min (`OPERATOR_CANCEL_WINDOW_MIN`); gestor cancela/corrige a qualquer tempo com motivo. Tudo recalcula o rateio e é auditado.
8. Alterar peso de uma carga que já tem atividades exige motivo e **não** muda o peso de referência já registrado.

## 5. Perfis

| Função | ADMIN | GESTOR | OPERADOR |
|---|:-:|:-:|:-:|
| Apontamento | ✔ | ✔ | ✔ |
| Histórico | todos + corrigir/cancelar/recalcular | todos + corrigir/cancelar | só hoje; cancelar recente |
| Dashboard, ranking, relatórios, auditoria | ✔ | ✔ | ✘ |
| Ajudantes, cargas, praças, conferentes, turnos, equipes | ✔ | ✔ | ✘ |
| Excluir ajudante (sem histórico) | ✔ | ✘ | ✘ |
| Tipos de atividade e regras | ✔ | leitura | ✘ |
| Usuários | ✔ | ✘ | ✘ |

## 6. API de integração (TMS/ERP)

Cabeçalho `X-API-Key: <INTEGRATION_API_KEY>`.

```http
POST /api/integration/loads
[{ "external_id":"TMS-123", "load_number":"4587", "weight_kg":1000, "volumes":120,
   "load_date":"2026-09-10", "checker_external_id":"TMS-CONF-1", "square_code":"05", "status":"ABERTA" }]
POST /api/integration/checkers   [{ "external_id":"...", "name":"...", "registration":"..." }]
POST /api/integration/squares    [{ "external_id":"...", "code":"05", "name":"Praça 05" }]
GET  /api/integration/productivity?date_from=2026-09-01&date_to=2026-09-30
```
Reenvio com o mesmo `external_id` atualiza (não duplica). Até 1.000 itens por lote; resposta 207 lista os itens com erro.
