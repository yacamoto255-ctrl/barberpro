# LogiPonto — Produtividade de Ajudantes

Sistema web de **apontamento operacional** para medir a produtividade individual dos ajudantes de uma transportadora.
O ajudante é identificado pelo **código de barras do crachá** (o código identifica somente o ajudante), e o operador registra em qual carga e atividade ele trabalhou, com início e fim. O peso e os volumes são **rateados** entre os participantes por regras configuráveis.

> Detalhes de arquitetura, banco, regras e a análise dos riscos de medição: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Como executar

Requisito: **Node.js 22.13 ou superior** (usa o SQLite nativo do Node; não há compilação).

```bash
cd produtividade-ajudantes
npm install
npm run seed          # cria o banco com dados FICTÍCIOS de demonstração (use -- --reset para recriar)
npm start             # http://localhost:3100
```

Configuração opcional: copie `.env.example` para `.env`. Em produção, `JWT_SECRET` é obrigatório.

## Usuários de teste

| Perfil | E-mail | Senha |
|---|---|---|
| ADMIN | admin@logiponto.com | Admin1234 |
| GESTOR | gestor@logiponto.com | Gestor1234 |
| OPERADOR | operador@logiponto.com | Operador1234 |

Ajudantes de demonstração: `001` Yago, `002` João, `003` Carlos, `004` Marcos … `012`; `099` é um ajudante **inativo** (para testar o bloqueio).

## Uso rápido (operador)

1. Tela **Apontamento de Atividades**: selecione a carga (toque no número ou leia/digite e tecle Enter).
2. Escolha a atividade (botões grandes). Em *Movimentação para praça*, confirme a praça.
3. Bipe o crachá: aparece “**Yago identificado**”. Toque **INICIAR** ou bipe de novo para confirmar.
4. Para finalizar: bipe o crachá do ajudante e bipe de novo (ou toque **FINALIZAR**).
5. Opção “Iniciar automaticamente ao bipar” deixa o fluxo com um único bipe.

Leitores USB/Bluetooth funcionam como teclado: o campo de leitura fica sempre focado. O código também pode ser digitado manualmente. Crachás com código CODE128 podem ser impressos em **Cadastro de Ajudantes → 🖨**.

## Testes e verificações

```bash
npm test          # 92 testes de API/regra de negócio (Jest + Supertest)
npm run e2e       # 115 verificações em navegador real (Chromium): fluxo completo e 7 resoluções
npm run loadtest -- 10,100,1000
npm run backup    # cópia consistente em ./backups (mantém 30); npm run restore -- <arquivo>
```

Resultado do teste de carga (máquina de desenvolvimento, 4 requisições por usuário, simultâneas):

| Usuários simultâneos | Erros | Média | p95 |
|---:|---:|---:|---:|
| 10 | 0 | 36 ms | 78 ms |
| 100 | 0 | 242 ms | 424 ms |
| 1.000 | 0 | 1,3 s | 7,9 s |

Para mais de ~100 usuários **simultâneos**, migrar para PostgreSQL e/ou pré-agregar os indicadores (ver próximos passos). 10.000 simultâneos não foi testado.

## Estrutura

```
server.js                   inicialização
src/app.js                  Express, segurança, rotas
src/domain/allocation.js    motor de rateio (puro, testado)
src/services/operations.js  regras do apontamento (início/fim/troca/cancelamento/correção)
src/services/productivity.js dashboard, ranking, relatórios, histórico
src/integrations/tmsAdapter.js  PONTO DE INTEGRAÇÃO com o TMS/ERP
src/db/migrations.js        esquema do banco (versionado)
public/                     front-end (SPA sem build)
scripts/                    seed, backup, restore, loadtest
tests/, e2e/                testes automatizados
```
