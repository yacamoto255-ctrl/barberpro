# Versal Estúdio: gerador de sites com agendamento online

Aplicação para a agência **Versal Estúdio** ([@versal.estudio](https://instagram.com/versal.estudio)) criar e gerenciar sites de **qualquer tipo de negócio** (barbearia, salão, clínica, estúdio, pet shop…), cada um com **agendamento online**.

- **Painel da agência** (`/admin`): cria os sites, cadastra serviços, equipe, horários, imagens e aparência, acompanha a agenda, relatórios e notificações.
- **Site público de cada negócio** (`/s/<endereço>`): página responsiva com serviços, preços, equipe, horários, contato e o widget de agendamento. No rodapé vai o crédito "Site por Versal Estúdio", com link para o Instagram da agência.
- **Cliente final**: agenda pelo site sem precisar de conta e recebe um link para cancelar.

O app fica em `sitebuilder/`, separado do BarberPro: tem `package.json`, banco e deploy próprios, e usa a mesma stack (Node + Express + SQLite nativo).

## Como a IA entra (receita do claude-cookbooks)

A geração de aparência segue a receita [`coding/prompting_for_frontend_aesthetics`](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb) do repositório anthropics/claude-cookbooks, num **modelo híbrido**:

1. O Claude (`claude-opus-5-5`, via SDK oficial `@anthropic-ai/sdk`) recebe os dados do negócio e devolve **somente um JSON de tema**: paleta, par de fontes, layout do topo, cantos, textura de fundo e textos em PT-BR. O formato é garantido por *structured outputs* (`output_config.format`).
2. O servidor **valida tudo**: cores em hex, fontes de uma lista conferida no Google Fonts, opções fechadas, limite de tamanho dos textos e contraste mínimo WCAG (corrigido automaticamente).
3. O HTML é montado pelo **template do servidor**, com os dados ao vivo e todo texto escapado. Nada gerado pela IA vira código na página. Preço ou horário alterado no painel aparece na hora, sem gerar de novo.

Também ficam ativos o *fallback* do lado do servidor (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) e mensagens claras para chave inválida, limite de uso, recusa e resposta cortada. Sem chave da Anthropic o app funciona normalmente com os **50 modelos da Versal** (abaixo), 6 paletas rápidas e ajuste fino manual.

> Cada geração consome créditos da conta Anthropic de quem cadastrar a chave (em Configurações ou na variável `ANTHROPIC_API_KEY`).

## Funcionalidades

| Área | O que tem |
|---|---|
| Acesso | Primeiro acesso cria o admin. Login com bloqueio após 5 erros (15 min) e limite por IP. Logout revoga o token. Sessão de 8h. Troca de senha encerra as outras sessões. "Esqueci a senha" (link pelo WhatsApp se configurado; o admin também gera link no painel; script de terminal para emergência) |
| Perfis | **Administrador** (tudo), **Operador** (sites, agenda, relatórios, notificações; não exclui site nem agendamento, sem acesso a equipe, configurações, backup e auditoria), **Visitante** (só site publicado e API pública) |
| Sites | Criar, editar, publicar/despublicar, pré-visualizar rascunho (link assinado de 2h), excluir com confirmação digitada. Endereço automático sem duplicar. Máscaras e validação de telefone, CEP, e-mail, Instagram e **CNPJ numérico ou alfanumérico** (formato novo da Receita) |
| Serviços e equipe | CRUD com preço/duração, ordem, ativo/inativo; profissional com foto e serviços que atende. Não exclui item com agendamento futuro (sugere desativar) |
| Agenda | Horário por dia com até 4 faixas (almoço), bloqueios (feriado, férias, folga por profissional), intervalo entre horários, antecedência mínima, dias abertos. "Sem preferência" escolhe um profissional livre. **Conflito impossível**: a gravação roda em transação, e em teste com 10 pedidos simultâneos no mesmo horário entrou só 1 |
| Painel | Indicadores do dia, dos 7 dias e do mês (previsto e realizado), gráfico dos próximos 14 dias, próximos atendimentos e serviços mais pedidos, atualizando sozinho a cada minuto. Agenda com filtros, busca, paginação, troca de status, remarcação e lançamento manual |
| Notificações | Alerta interno com contador (verifica a cada 30s). **WhatsApp via Evolution API**: aviso ao negócio, confirmação ao cliente com link de cancelamento e aviso de cancelamento. Reenvio automático (3 tentativas em erro de rede/5xx) e registro de cada mensagem |
| Relatórios | Filtros por site, período e status; totais por status, serviço, profissional e site; exportação **CSV** (Excel-BR, protegido contra injeção de fórmula), **Excel (.xlsx)** e **PDF** |
| Backup | Manual e automático (24h, guarda 14), download, envio de arquivo, **restauração completa** com cópia de segurança antes e verificação de integridade |
| Auditoria | Login, falhas, bloqueios, criação, alteração, exclusão, exportação, backup e restauração, com usuário, IP e data |
| PWA | Painel instalável; abre sem internet (último estado) e volta sozinho quando a conexão retorna |

## Profissões de saúde (dentistas, clínicas)

- **Responsável técnico e registro** (ex.: `CRO-PR 12345`) no site e no rodapé; **registro de cada profissional** no card da equipe; registro da clínica no conselho (opcional).
- **Ocultar preços** no site público, na API pública, na confirmação e na página de cancelamento. Os preços continuam no painel e nos relatórios. Em sites de **odontologia** a opção já começa ligada: pelo que sei, o Código de Ética Odontológica (CFO) veda anunciar preços. Confirme as regras atuais com o CRO do seu estado.
- **Textos da IA** sem preços, promessas de resultado, superlativos ou "antes e depois" para as categorias de saúde.

## Sites de demonstração e portfólio

Para mostrar a clientes o que a agência faz, marque um site como **demonstração** (aba Dados → Portfólio) ou use os exemplos prontos:

```bash
npm run seed-demos     # cria/atualiza os 5 exemplos de sites/demos e publica
```

| Exemplo | Nicho | Destaques |
|---|---|---|
| Clínica Aurora Odontologia | Dentista (Curitiba) | Sem preços e com CRO (regras do CFO), 3 dentistas |
| Navalha & Prosa Barbearia | Barbearia (São Paulo) | Tema escuro, preços, 3 barbeiros |
| Atelier Flor de Lis | Salão de beleza (Belo Horizonte) | Serviços por profissional |
| Espaço Escuta Psicologia | Psicóloga (Porto Alegre) | Sem preços e com CRP, sessões de 50 min |
| Bicho Bom Pet Care | Pet shop (Florianópolis) | Serviços por porte |

Num site de demonstração:
- aparece a faixa "Site de demonstração · negócio e dados fictícios · criado pela Versal Estúdio";
- telefone, WhatsApp, e-mail, mapa e Instagram aparecem, mas **não viram links**, para não levar a ninguém real;
- o **agendamento funciona na tela, mas é simulado**: valida tudo, mas não grava nada, não guarda dados do visitante e não envia WhatsApp;
- a página fica fora do Google (`noindex`).

A página **`/exemplos`** lista todas as demonstrações publicadas, com o botão "Quero um site assim" para o Instagram da agência. É o link para mandar a clientes.

**Publicar o portfólio sem servidor:** `npm run export-demos -- pasta` gera páginas estáticas (portfólio + exemplos), com imagens embutidas e o agendamento simulado no próprio navegador. A pasta pode ir para Netlify, GitHub Pages ou qualquer hospedagem de arquivos.

As capas dos exemplos são ilustrações próprias (`sites/demos/img`). Negócios, pessoas, registros profissionais e contatos são fictícios: os números `CRO-PR 00000`, `CRP 07/00000` e `(xx) 90000-0000` são marcadores, não registros reais.

## Modelos de site (50) e posts para o Instagram

São **10 modelos para cada um de 5 nichos**: barbearia, dentista, pet shop, psicologia e salão de beleza. Ficam em `sites/modelos/<nicho>.json`. Cada modelo tem:
- paleta, par de fontes, layout do topo, cantos e textura;
- textos de exemplo;
- uma capa ilustrada (`sites/modelos/img/<id>.png`);
- um negócio fictício, que aparece só na prévia.

O visual segue a mesma receita de estética do cookbook usada pela IA:
- fontes com personalidade: 23 fontes de título no total e nenhuma repetida dentro do mesmo nicho;
- paletas com uma cor dominante e um destaque, com temas claros e escuros;
- 6 layouts de topo;
- texturas de fundo.

Todos passam na checagem de contraste sem nenhum ajuste.

| Onde | O que faz |
|---|---|
| **`/modelos`** | Galeria pública dos 50 modelos por nicho, com o botão para o Instagram da agência. Bom link para mandar a clientes |
| **`/modelos/<id>`** (ex.: `/modelos/pet-03`) | Prévia do modelo funcionando. A agenda é simulada no navegador e nada chega ao servidor. Mostra a faixa "negócio fictício" e fica fora do Google |
| **Painel → Novo site** | Campo "Modelo de site (opcional)", filtrado pela categoria: o site já nasce com o visual, os textos e a capa do modelo |
| **Painel → site → Aparência → Modelos da Versal** | Escolha por nicho, prévia e "Aplicar", com opção de usar ou não os textos e a capa. "Desfazer modelo" volta cores, fontes e textos. A capa antiga é substituída e não volta |

Regras de saúde nos modelos de dentista e psicologia:
- preços ocultos;
- nome e registro do responsável (CRO ou CRP fictício, terminado em 00000);
- textos sem promessa de resultado, superlativo, preço ou promoção. Um teste automático confere isso.

Modelos de outro nicho podem ser aplicados, e o painel avisa para revisar os textos.

**Ferramentas** (só em desenvolvimento; precisam do Chromium e de internet para as fontes):

```bash
node scripts/build-model-art.js          # redesenha as 50 capas a partir do bloco "arte" de cada modelo
node scripts/build-posts.js data/posts   # posts 4:5 (1080×1350) com notebook + celular, capas de carrossel,
                                          # slide final e legendas.txt; também atualiza as miniaturas da galeria
```

Cada nicho sai com 12 imagens:
- `00-capa.png`: capa do carrossel;
- `01` a `10`: um post por modelo;
- `11-cta.png`: slide final.

O arquivo `legendas.txt` traz sugestões de texto. A ferramenta para com aviso se uma fonte não carregar, se aparecer rolagem lateral ou se a agenda simulada não abrir.

## Cadastrar um site completo por arquivo

Para montar um site de uma vez (dados, serviços, equipe, horários, tema e imagens), copie `sites/modelo-dentista.json`, preencha e rode:

```bash
npm run seed-site -- sites/meu-cliente.json            # cria
npm run seed-site -- sites/meu-cliente.json --update   # atualiza (não apaga nada)
```

O script usa as mesmas validações do painel e precisa de um administrador já criado. Horários vão no formato `"seg": "08:00-12:00, 13:30-18:00"`; caminhos de imagem são relativos ao arquivo JSON.

## Rodar localmente

Requer **Node.js 22.13+** (usa o SQLite nativo `node:sqlite`). Recomendado: Node 24.

```bash
cd sitebuilder
npm install
npm start            # http://localhost:3000  → painel em /admin
```

No primeiro acesso o painel pede para criar o administrador. O banco fica em `data/sitebuilder.db` (configurável).

Senha esquecida sem WhatsApp configurado:

```bash
npm run reset-password -- seu@email.com NovaSenha123
```

## Variáveis de ambiente

Veja `.env.example`. As principais em produção:

| Variável | Para quê |
|---|---|
| `JWT_SECRET` | Segredo da sessão (64+ caracteres). Sem ele, um segredo aleatório é gerado e guardado no banco |
| `DB_PATH` / `BACKUP_DIR` | Caminho do banco e dos backups. **Use um volume persistente** |
| `PUBLIC_BASE_URL` | Domínio público usado nos links de cancelamento e de redefinição |
| `SETUP_TOKEN` | Protege o primeiro acesso em servidores públicos |
| `ANTHROPIC_API_KEY` | Opcional (também pode ser cadastrada no painel) |

## Deploy no Railway

1. Crie um serviço novo apontando para este repositório com **Root Directory = `sitebuilder`** (já tem `railway.json` e `nixpacks.toml`, Node 24, `npm ci --omit=dev`, healthcheck em `/api/health`).
2. Adicione um **Volume** montado em `/data` e defina `DB_PATH=/data/sitebuilder.db` e `BACKUP_DIR=/data/backups`.
3. Defina `JWT_SECRET`, `PUBLIC_BASE_URL` e `SETUP_TOKEN` (e `NODE_ENV=production`).
4. Acesse `/admin`, crie o administrador com o `SETUP_TOKEN` e cadastre as chaves em Configurações.

## Testes

```bash
npm test               # 166 testes de API/unidade (Jest + Supertest), banco temporário por arquivo
npm run test:coverage  # cobertura (último resultado: 92% das linhas)
npm run test:e2e       # simulação completa no Chromium (26 passos, 9 telas)
npm run loadtest       # carga com 10, 100, 1.000 e 10.000 conexões (ou: npm run loadtest -- 100)
```

O E2E usa `playwright-core`. Aponte `CHROMIUM_PATH` para um Chromium/Chrome instalado. Os resultados ficam em `docs/e2e-report.json` e `docs/loadtest-result.json`, e as capturas em `docs/screenshots/`.

### Resultado da checklist (6 de outubro de 2026)

**Executado e passando**

- **Autenticação:** setup, login, logout, senha errada, campos vazios, SQL injection, força bruta (bloqueio e 429), token inválido, adulterado, `alg:none`, expirado e revogado, usuário desativado e removido, troca de senha e redefinição (uso único e expiração).
- **Permissões:** 47 testes cobrindo admin, operador e visitante em todas as rotas; mudança de perfil vale na hora.
- **Banco de dados:** inserção, consulta, edição e exclusão; cascata; unicidade (e-mail, endereço, nome de serviço); transações contra agendamento duplicado; backup e restauração completa verificados.
- **CRUD e formulários:** sites, serviços, profissionais, horários, bloqueios, usuários e agendamentos; obrigatórios, inválidos, duplicados, valores extremos, caracteres especiais e de controle, máscaras de telefone, CEP, CNPJ e dinheiro, datas impossíveis.
- **Uploads:** PNG, JPG e WebP conferidos pelo conteúdo real; recusa PDF, SVG, arquivo disfarçado e vazio; limite de 2 MB; trocar e excluir; download íntegro.
- **Dashboard e relatórios:** números conferidos contra o banco; CSV, Excel e PDF abertos e conferidos (linhas, totais, receita).
- **APIs:** GET, POST, PUT, PATCH e DELETE com status corretos (200, 201, 400, 401, 403, 404, 409, 413, 415, 423, 429).
- **Segurança:**
  - XSS: tudo é escapado e o CSP (com nonce) não usa `unsafe-inline`.
  - SQL injection: só consultas parametrizadas.
  - Força bruta: bloqueio da conta e limite por IP.
  - Senhas: bcrypt.
  - Sigilo: chaves mascaradas, sem vazamento de dados de clientes na API pública e nomes de backup protegidos contra *path traversal*.
  - CSRF não se aplica: a API usa token no cabeçalho, sem cookie.
- **Notificações:** alerta interno; WhatsApp com reenvio e registro testados com servidor simulado.
- **E2E:** criar conta, login, cadastrar tudo, aplicar e desfazer modelo, criar site já com modelo, agendar pelo iPhone, agenda simulada de modelo sem chamada ao servidor, alerta, status, relatórios, operador sem acesso, sair e entrar com os dados persistidos, cancelamento pelo cliente, troca de senha, backup, exclusão, links, modo offline e responsividade (painel, site, galeria e modelos).
- **Telas testadas:** 1920, 1600 e 1366 px; iPad retrato e paisagem; tablet Android; Android (2 tamanhos); iPhone. Sem rolagem lateral e menu móvel funcionando.

**Carga** (servidor e gerador na mesma máquina de 4 CPUs; o Node usa 1 núcleo):

| Conexões simultâneas | Cenário | req/s | Latência média | p99 | Erros | CPU | Memória (pico) |
|---|---|---|---|---|---|---|---|
| 10 | Página do site | 1053 | 9 ms | 20 ms | 0 | 1 núcleo | 160 MB |
| 100 | Página do site | 1139 | 87 ms | 127 ms | 0 | 1 núcleo | 218 MB |
| 1.000 | Página do site | 971 | 495 ms | 988 ms | 0 | 1 núcleo | 168 MB |
| 10.000 | Página do site | 1019 | 3,7 s | 5,9 s | 0 | 1 núcleo | 222 MB |
| 10–10.000 | API de horários / dashboard | 537–989 | 10 ms – 260 ms | até 5,4 s | 0 | 1 núcleo | até 272 MB |

Escrita concorrente: 200 pedidos disputando 60 vagas resultaram em **exatamente 60 agendamentos e 140 recusas (409)**, sem duplicidade.

**Leitura honesta:** um processo atende cerca de 1.000 requisições por segundo sem erro. Com 10.000 conexões *ao mesmo tempo*, as respostas passam a levar segundos. Isso equivale a muito mais que 10.000 usuários navegando, porque cada pessoa faz uma requisição a cada vários segundos. Se for preciso escalar, o caminho é mais CPU por instância ou migrar o banco para PostgreSQL e rodar várias instâncias (o SQLite aceita um único processo escrevendo).

**Não testado aqui ou fora do escopo**

- **Envio real de WhatsApp:** testado contra um servidor Evolution simulado. Falta testar com a sua instância (botão "Testar conexão" em Configurações).
- **Geração real com o Claude:** testada com o cliente da API simulado (formato da requisição, erros e validação). Falta uma geração real com a sua chave.
- **ViaCEP** (preencher endereço pelo CEP): bloqueado neste ambiente de teste. Se falhar, o preenchimento é manual.
- **Fora do escopo escolhido:** e-mail, SMS e push; CPF (não há campo); perfis "Gerente" e "Cliente com login" (modo agência: admin, operador e visitante); pagamento, ERP e bancos.
- **Modo offline:** abre o painel e avisa que está sem conexão. Ações feitas sem internet **não** ficam na fila para sincronizar depois.
- **Dependências:** `npm audit --omit=dev` mostra 0 vulnerabilidades. Os 33 alertas restantes são de ferramentas de teste (Jest), que não vão para produção.
