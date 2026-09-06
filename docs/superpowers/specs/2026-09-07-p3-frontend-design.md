# Sistema de Barbearia — Spec de Design (P3: Frontend)

- **Data:** 2026-09-07
- **Status:** aprovado para implementação
- **Depende de:** P1 (motor de agenda, mergeado) + P2 (API REST + Socket.io + auth, mergeado)
- **Documento-pai:** `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` (§7 Frontend, §6 Tempo real, §8 Segurança)

---

## 1. Escopo

P3 entrega a **camada de apresentação**: páginas renderizadas no servidor (EJS),
CSS próprio mobile-first tema dark, e ilhas de interatividade com Alpine.js +
cliente Socket.io. Toda a lógica de dados já existe como JSON em `/api/*` (P2) —
as telas do admin e a área do cliente são cascas finas que consomem esses
endpoints. A landing e a página de privacidade são renderizadas 100% no servidor
a partir da `configuracao` e dos `servicos`.

### Entra no P3

- View engine EJS + layout/partials + `express.static`.
- CSP do `helmet` reativada com as diretivas necessárias (hoje está `false`).
- Assets versionados no repo: CSS único, JS por página, **Alpine e socket.io-client
  auto-hospedados** em `src/public/vendor/` (sem CDN — a CSP não libera origem externa
  para script).
- Rotas de página públicas: `GET /`, `/agendar`, `/minha-conta`, `/privacidade`.
- Rotas de página do admin: `GET /admin/login`, `GET /admin` + subtelas.
- Middlewares `paginaCliente` / `paginaEquipe` que **redirecionam** (302) em vez de
  responder JSON 401.
- Fluxo de agendamento de 5 passos (Alpine) com lock + cronômetro + realtime.
- Painel admin: 10 telas guiadas por barra lateral, todas ligadas à sala `admin`.
- Área do cliente: login + abas Próximos/Histórico com cancelar/remarcar.
- Botão flutuante WhatsApp (`wa.me`, texto de dúvida — nunca leva ao agendamento).
- Mapa: embed Google se houver `GOOGLE_MAPS_API_KEY`, senão iframe OpenStreetMap;
  botão "Como chegar" nos dois casos (via `services/mapa.js`, já existente).
- Testes de rota (supertest) sobre o HTML e os redirects; teste de presença da CSP.

### Não entra no P3 (fica pro P4 ou depois)

- Upload/otimização de imagens da galeria — P3 usa placeholders estáticos em
  `src/public/img/`.
- E2E em navegador real (Playwright) — sem infra; cobertura via supertest + um
  teste de unidade de componente Alpine com `jsdom` se necessário.
- Tokens CSRF por formulário — mantém-se o baseline por header `Origin`
  (`exigirOrigemConfiavel`), que cobre `fetch` de mesma origem. Formulários usam
  `fetch`, não `<form method=post>` nativo.
- OTP na tela de cadastro (P2 decidiu: cadastro é nome+celular direto).
- PWA, service worker, push, som/`<audio>` além de um beep simples.
- PDF/Excel de comissões (botões "em breve", desabilitados).
- DEPLOY.md, CI, credenciais reais — P4.

---

## 2. Estrutura de arquivos nova

```
src/
  views/
    layout.ejs                 # doc HTML base do site do cliente; recebe <%- corpo %>
    partials/
      head.ejs                 # <meta>, <link> do CSS, nonce da CSP
      whatsapp-flutuante.ejs   # botão fixo wa.me
      rodape.ejs
    inicio.ejs                 # landing (server-render puro)
    agendar.ejs                # casca do fluxo de 5 passos (Alpine)
    minha-conta.ejs            # login + abas do cliente (Alpine)
    privacidade.ejs            # texto LGPD estático + dados de contato
    erro.ejs                   # 404 / 500 renderizados em HTML
    admin/
      layout.ejs               # doc HTML base do admin; barra lateral + <%- corpo %>
      login.ejs
      dashboard.ejs
      agendamentos.ejs
      meses.ejs
      bloqueios.ejs
      servicos.ejs
      clientes.ejs
      comissoes.ejs
      configuracao.ejs
      templates.ejs
      mensagens.ejs
  public/
    css/app.css                # único; tema dark, mobile-first, tokens CSS
    js/
      comum.js                 # helper de fetch JSON (Origin implícito), toast, beep
      realtime.js              # conexão socket.io + registro na sala agenda:<data>
      agendar.js               # componente Alpine do fluxo de 5 passos
      minha-conta.js           # componente Alpine da área do cliente
      admin/
        comum.js               # socket sala admin, dashboard_tick, layout
        agendamentos.js
        meses.js
        bloqueios.js
        servicos.js
        clientes.js
        comissoes.js
        configuracao.js
        templates.js
        mensagens.js
    vendor/
      alpine.min.js            # Alpine 3.x, auto-hospedado
      socket.io.min.js         # cliente socket.io 4.x (copiado de node_modules no build)
    img/
      logo.svg  galeria-1..4.jpg  favicon.svg   # placeholders
  routes/
    paginas.js                 # GET / /agendar /minha-conta /privacidade + erro handler HTML
    adminPaginas.js            # GET /admin/login /admin/*  (com paginaEquipe)
  http/
    render.js                  # helpers: resolve dados da landing, nonce, csp

test/
  http/
    paginas.test.js            # 200 + conteúdo-chave nas páginas públicas
    admin-paginas.test.js      # /admin/* redireciona sem sessão; 200 com sessão de equipe
    csp.test.js                # header CSP presente e com as diretivas certas
```

Nenhum arquivo de P1/P2 é removido. `src/app.js` ganha: view engine, static,
`express.urlencoded` **não** (forms são fetch), CSP real, e o mount dos dois
routers de página. `src/server.js` não muda (o `criarServidor` já injeta `io`).

---

## 3. Dependências

Adicionar a `dependencies`:

| Pacote | Uso |
|---|---|
| `ejs` | view engine |

Alpine e socket.io-client **não** são dependências novas de runtime: Alpine é um
arquivo commitado em `vendor/`; o cliente socket.io já vem dentro do pacote
`socket.io` (`node_modules/socket.io/client-dist/socket.io.min.js`). Um script
`scripts/sync-vendor.js` copia os dois para `src/public/vendor/` e roda no
`postinstall` e no `prestart` (idempotente). Alpine 3.x é baixado uma vez e
versionado (a CSP proíbe buscar de CDN; não há build de frontend).

Sem novas devDependencies — os testes usam supertest (já presente).

---

## 4. View engine e layout

- `app.set('view engine', 'ejs')`, `app.set('views', 'src/views')`.
- `res.locals` recebe em todo request: `nonce` (base64 de 16 bytes, por request),
  `appUrl`, `anoAtual`, e `usuario`/`cliente` da sessão (para o header).
- **Site do cliente:** `layout.ejs` inclui `partials/head`, o `<%- corpo %>`,
  `partials/whatsapp-flutuante` e `partials/rodape`. Renderização:
  `res.render('inicio', { corpoView: 'inicio', ...dados })` com um mini-helper
  `renderPagina(res, view, dados)` que injeta o layout (usa `ejs` com
  `include`, sem pacote de layout externo).
- **Admin:** `admin/layout.ejs` tem a barra lateral com os 10 links e marca o
  item ativo via `dados.telaAtiva`.
- Todo `<script>` inline recebe `nonce="<%= nonce %>"`. Preferência: zero script
  inline — cada página carrega seu módulo de `public/js/` com `defer`. Dados
  iniciais que a página precisa vão num `<script type="application/json"
  id="dados-pagina" nonce>` e o módulo lê `JSON.parse(...)`.

---

## 5. Content Security Policy

`helmet({ contentSecurityPolicy: { directives: ... } })` substituindo o
`false` atual. Diretivas:

| Diretiva | Valor | Porquê |
|---|---|---|
| `default-src` | `'self'` | base restritiva |
| `script-src` | `'self' 'unsafe-eval'` | Alpine 3 avalia expressões com `Function()`; sem CDN |
| `style-src` | `'self' 'unsafe-inline'` | Alpine aplica `style=` inline; CSS próprio é `'self'` |
| `img-src` | `'self' data: https://*.tile.openstreetmap.org https://maps.gstatic.com https://maps.googleapis.com https://*.ggpht.com` | tiles OSM / pins Google |
| `frame-src` | `https://www.google.com https://www.openstreetmap.org` | embed do mapa |
| `connect-src` | `'self'` | Socket.io usa WebSocket/polling na mesma origem |
| `form-action` | `'self'` | |
| `base-uri` | `'self'` | |
| `object-src` | `'none'` | |

`'unsafe-eval'` é aceito conscientemente: é o custo de usar Alpine sem build.
Alternativa (Alpine "CSP build", sintaxe restrita) foi considerada e rejeitada —
perde `x-data` com expressões, encareceria todas as telas. `script-src` continua
sem `'unsafe-inline'`: inline só com `nonce`.

Em produção o `helmet` também manda HSTS (já vem). `upgrade-insecure-requests`
ligado quando `NODE_ENV==='production'`.

---

## 6. Rotas de página

### 6.1 Públicas — `src/routes/paginas.js`

| Método | Rota | Render | Dados |
|---|---|---|---|
| GET | `/` | `inicio` | `configuracao.obter`, `servicos.ativos`, `mapa.dadosMapa`, expediente formatado, `wa.me` do telefone |
| GET | `/agendar` | `agendar` | `servicos.ativos` (cartões), `configuracao` (nome, antecedência, intervalo p/ o cronômetro) |
| GET | `/minha-conta` | `minha-conta` | nada sensível; se já logado como cliente, o JS puxa `/api/cliente/me` |
| GET | `/privacidade` | `privacidade` | `configuracao` (nome/contato do controlador) |

Montadas **sem** `express.json` (são GET) e **sem** `exigirOrigemConfiavel`
(idem). Ficam antes do 404 JSON. Erros nessas rotas caem num handler que
renderiza `erro.ejs` com status 500 em vez de JSON.

### 6.2 Admin — `src/routes/adminPaginas.js`

| Método | Rota | Gate | Render |
|---|---|---|---|
| GET | `/admin/login` | — (se já logado, 302 `/admin`) | `admin/login` |
| GET | `/admin` | `paginaEquipe` | `admin/dashboard` |
| GET | `/admin/agendamentos` | `paginaEquipe` | `admin/agendamentos` |
| GET | `/admin/meses` | `paginaEquipe` | `admin/meses` |
| GET | `/admin/bloqueios` | `paginaEquipe` | `admin/bloqueios` |
| GET | `/admin/servicos` | `paginaEquipe` | `admin/servicos` |
| GET | `/admin/clientes` | `paginaEquipe` | `admin/clientes` |
| GET | `/admin/comissoes` | `paginaEquipe` | `admin/comissoes` |
| GET | `/admin/configuracao` | `paginaEquipe` | `admin/configuracao` |
| GET | `/admin/templates` | `paginaEquipe` | `admin/templates` |
| GET | `/admin/mensagens` | `paginaEquipe` | `admin/mensagens` |

`paginaEquipe`: mesma checagem de `requireEquipe`, mas em falha faz
`res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl))`.
`paginaCliente` (para uso futuro) redireciona a `/minha-conta`. Ambos ficam em
`src/auth/middleware.js` ao lado dos existentes.

O **login em si** continua sendo `POST /api/auth/admin/login` (P2, JSON, rate-
limited, `session.regenerate`). A tela `admin/login.ejs` faz `fetch` desse
endpoint e, no `200`, `window.location = next || '/admin'`.

---

## 7. Fluxo de agendamento (`agendar.ejs` + `public/js/agendar.js`)

Componente Alpine único `x-data="fluxoAgendamento()"` com `passo` de 1 a 6
(6 = sucesso). Estado: `servico`, `ano`, `mes`, `dia`, `horario`, `lockAte`,
`form {nome, celular, comSenha, email, senha, consentimento}`, `erro`.

| Passo | Tela | Ação ao avançar |
|---|---|---|
| 1 | cartões de serviço (do `#dados-pagina`) | seleciona `servico` |
| 2 | calendário do mês; `GET /api/agenda/dias?ano=&mes=&servico_id=` pinta dias livres; setas de mês respeitam meses liberados (resposta vazia = mês fechado) | seleciona `dia` |
| 3 | grade de horários; `GET /api/agenda/horarios?data=&servico_id=`; entra na sala `agenda:<data>` via `realtime.js`; ao clicar num horário → `POST /api/agenda/lock` → inicia cronômetro `lockAte = agora+5min` | vai ao passo 4 |
| 4 | formulário nome+celular; link "quero criar senha" revela email+senha; checkbox LGPD obrigatório; heartbeat `POST /api/agenda/lock/renovar` a cada 2 min enquanto `passo>=4 && passo<6` | `POST /api/agenda/cadastro` → sessão de cliente |
| 5 | revisão (serviço, data, hora, preço, observações) | `POST /api/agenda/confirmar` → 201 → passo 6 |
| 6 | sucesso: resumo + "você receberá confirmação no WhatsApp" + link p/ `/minha-conta` | — |

Regras de UX:
- Cronômetro visível "reservado por MM:SS". Ao zerar: volta ao passo 3, limpa
  `horario`, recarrega a grade, mostra aviso.
- Botão "voltar" do passo 3→2 ou sair da página → `POST /api/agenda/lock/liberar`
  (best-effort, `navigator.sendBeacon` no `pagehide`).
- Eventos recebidos na sala `agenda:<data>`:
  - `horario_reservado {data,horario}` → marca aquele horário como indisponível;
    se era o `horario` que o cliente tinha selecionado mas ainda não travou,
    alerta "Esse horário acabou de ser reservado".
  - `horario_liberado` → reabre o horário na grade.
  - `agenda_atualizada` → re-`GET /api/agenda/horarios`.
- `409` em `/lock` (`SLOT_TRAVADO`/`SLOT_OCUPADO`) ou em `/confirmar`
  (`HORARIO_INDISPONIVEL`) → volta ao passo 3, recarrega, mensagem clara.
- Fallback sem WebSocket: `realtime.js` já reconecta via polling; além disso o
  passo 3 tem `setInterval` de 30 s re-consultando os horários.

---

## 8. Área do cliente (`minha-conta.ejs` + `public/js/minha-conta.js`)

`x-data="areaCliente()"`. Ao montar, `GET /api/cliente/me`:
- `401` → mostra o formulário de login (`{celular, senha}` → `POST
  /api/auth/cliente/login`; link "entrar sem senha" reusa
  `POST /api/agenda/cadastro` com nome+celular).
- `200` → mostra abas:
  - **Próximos:** `GET /api/cliente/agendamentos?quando=futuros`. Cada item:
    botão Cancelar (modal pede `motivo` → `POST .../:id/cancelar`) e Remarcar
    (abre mini-fluxo: escolhe nova data/horário reusando `/api/agenda/dias` e
    `/horarios` → `POST .../:id/remarcar`). Erros de antecedência
    (`FORA_DA_ANTECEDENCIA` etc.) aparecem inline.
  - **Histórico:** `GET /api/cliente/agendamentos?quando=historico`, somente
    leitura.
- Botão Sair → `POST /api/auth/logout` → recarrega.

---

## 9. Painel admin

`admin/comum.js` abre o socket, entra implicitamente na sala `admin` (o handshake
compartilha o cookie; P2 já resolve isso), e:
- `novo_agendamento` → se a tela é Dashboard ou Agendamentos, insere linha +
  toast + beep.
- `agendamento_atualizado` → atualiza a linha/ील estado.
- `dashboard_tick` → atualiza os 4 cards se estiverem na página.

Cada tela é um `x-data` que faz `GET` no `/api/admin/*` correspondente ao montar e
`POST/PATCH/DELETE` nas ações. Nenhuma lógica de negócio nova no cliente —
validação real é a do P2; o front só melhora a mensagem.

| Tela | Endpoints P2 usados |
|---|---|
| Dashboard | `GET /api/admin/dashboard` |
| Agendamentos | `GET /api/admin/agendamentos` (filtros+página), `PATCH /:id/status`, `POST /api/admin/agendamentos`, `POST /api/admin/mensagens/enviar` |
| Meses | `GET/POST /api/admin/disponibilidade` |
| Bloqueios | `GET/POST/DELETE /api/admin/bloqueios` |
| Serviços | `GET/POST/PATCH/DELETE /api/admin/servicos` |
| Clientes | `GET /api/admin/clientes`, `GET /:id`, `POST /:id/anonimizar` |
| Comissões | `GET /api/admin/comissoes` (PDF/Excel desabilitados) |
| Configuração | `GET/PUT /api/admin/configuracao` |
| Templates | `GET/PUT /api/admin/templates` (com preview client-side via `lib/template` — reimplementado em JS pequeno, ou preview textual simples) |
| Mensagens | `GET /api/admin/mensagens` |

Barra lateral fixa em desktop, colapsável (hambúrguer) em mobile. Cores de status
por classe CSS (`.status-pendente` etc.).

---

## 10. CSS

Um arquivo `public/css/app.css`. Tokens no `:root` (cores, espaçamento, raio,
sombra). Tema **dark** único (sem toggle — fora de escopo). Mobile-first, um
breakpoint em `48rem` para o layout de barra lateral do admin e grades mais
largas. Componentes: botão, campo/label, card, tabela responsiva
(`overflow-x:auto`), modal, toast, badge de status, cronômetro, grade de
horários, calendário. Contraste AA; foco visível em tudo que é focável; alvo de
toque ≥ 44px.

---

## 11. Segurança (deltas do P3)

- CSP real (seção 5). Sem `'unsafe-inline'` em `script-src`; inline só com nonce.
- Rotas de página são GET e não mudam estado — não precisam do check de `Origin`.
  Todas as mutações continuam passando pelos `/api/*` do P2, que já têm
  `exigirOrigemConfiavel` + zod + rate-limit.
- `minha-conta` e `agendar` nunca embutem dados de outro cliente no HTML; o que
  é do cliente vem por `fetch` autenticado depois do load.
- EJS escapa com `<%= %>` por padrão; `<%- %>` só para HTML que o servidor montou
  (nunca entrada de usuário).
- Página de erro não vaza stack (`erro.ejs` mostra mensagem genérica; detalhe só
  no log pino).
- `Cache-Control: no-store` nas páginas autenticadas do admin; `public, max-age`
  curto na landing; assets de `public/` com `express.static` (`maxAge` 1h,
  `immutable` quando vier hash no nome — P3 não versiona por hash, então 1h só).

---

## 12. Testes

`node:test` + supertest, no mesmo esquema de isolamento por schema do P1/P2.

- `test/http/paginas.test.js`
  - `GET /` → 200, `content-type: text/html`, contém o nome da barbearia semeado
    e um `<a href="https://wa.me/...">`, e **não** contém link para `/agendar`
    dentro do botão flutuante (o botão é só dúvida).
  - `GET /agendar` → 200, contém o `#dados-pagina` com os serviços.
  - `GET /minha-conta` → 200.
  - `GET /privacidade` → 200, contém "LGPD" e o contato do controlador.
  - `GET /rota-inexistente` → 404 (JSON, comportamento atual mantido para
    caminhos não-página).
- `test/http/admin-paginas.test.js`
  - `GET /admin` sem sessão → 302 para `/admin/login?next=%2Fadmin`.
  - `GET /admin/login` sem sessão → 200.
  - Com sessão de equipe (helper que faz `POST /api/auth/admin/login` com o admin
    semeado e reaproveita o cookie) → `GET /admin` e `GET /admin/agendamentos`
    → 200 e contêm a barra lateral.
  - `GET /admin/login` **com** sessão → 302 para `/admin`.
- `test/http/csp.test.js`
  - `GET /` tem header `content-security-policy` com `script-src` contendo
    `'self'` e `'unsafe-eval'` e **sem** `'unsafe-inline'`; `default-src 'self'`.
  - O `<script>` de dados iniciais na página carrega com `nonce=` e o mesmo valor
    aparece na diretiva `script-src`.

Não há teste de execução de JS de navegador no P3. Se um componente Alpine tiver
lógica pura destacável (ex.: cálculo do cronômetro, montagem do calendário),
extrair para uma função em `public/js/` importável e cobrir com `node:test` pontual.

---

## 13. Impacto em P1/P2

- `src/app.js`: + view engine, + `express.static('src/public')`, + CSP real,
  + `res.locals` (nonce/appUrl), + mount de `paginas` e `adminPaginas`. O 404
  JSON e o `errorHandler` continuam por último; as rotas de página entram antes
  deles. **Ordem:** static → paginas (GET públicas) → rotas `/api` e `/webhooks`
  (como hoje) → adminPaginas → 404 → errorHandler.
- `src/auth/middleware.js`: + `paginaEquipe`, + `paginaCliente`.
- `package.json`: + `ejs`; + `scripts/sync-vendor.js` no `postinstall`/`prestart`;
  `test` script inalterado.
- `.gitignore`: `src/public/vendor/` **não** é ignorado (Alpine é versionado);
  `socket.io.min.js` também é commitado (sync-vendor só reescreve, é idempotente).
- Nenhuma migração de banco. Nenhuma mudança nos endpoints `/api/*` do P2.
- `src/server.js` inalterado.

---

## 14. Próximas fases

- **P4 — Deploy + Docs + CI:** `docs/DEPLOY.md` (Render + VPS), `.env.example`
  completo, GitHub Actions rodando `npm test` contra um Postgres de serviço,
  credenciais reais (Google Maps, WhatsApp Cloud API, Twilio), os 3 templates
  para aprovação na Meta, healthcheck e migração automática no start.
- **Pós-núcleo:** escolha de barbeiro na UI, agenda por profissional, PDF/Excel
  de comissões, PWA, upload de imagens da galeria, lembrete 24h.
