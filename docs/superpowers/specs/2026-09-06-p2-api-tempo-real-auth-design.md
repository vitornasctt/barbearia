# P2 — API + Tempo Real + Auth — Spec de Design

- **Data:** 2026-09-06
- **Status:** aprovado para implementação
- **Deriva de:** `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` (seções 5, 6, 8, 9) — a arquitetura geral já foi aprovada lá; esta spec detalha só o que o P2 constrói e as decisões que faltavam.
- **Depende de:** P1 (mergeado em `main`) — `src/agenda/*`, `src/db/*`, `src/lib/*`, `src/services/comissao.js`, `src/config.js`.

---

## 1. Escopo

### No P2

Servidor HTTP (Express) + Socket.io no mesmo processo, sessões, autenticação de
cliente e de equipe, **todas as rotas REST** das seções 5.1–5.3 do design pai,
eventos de tempo real da seção 6, `node-cron` para limpeza de locks, worker de
mensagens, e os **stubs** de WhatsApp/SMS/mapa (interface pronta, modo simulação).

### Fora do P2

- **Frontend** (EJS, CSS, Alpine) → P3.
- **Deploy / Render / CI / `DEPLOY.md`** → P4.
- **Driver real da WhatsApp Cloud API e OTP real por SMS** → fase posterior; o P2
  entrega a interface e o modo `simulado`, e documenta o que cada credencial ativa.
- **Export PDF/Excel de comissões** → P3/posterior (o P2 já devolve o JSON).
- **CSRF por token** → P3, quando existirem formulários HTML. O P2 usa
  `sameSite=lax` + checagem de `Origin`/`Content-Type` nas rotas mutadoras.

---

## 2. Estrutura de arquivos nova

```
src/
├── app.js                    # monta o app Express (sem .listen, sem cron) — para os testes
├── server.js                 # app.js + http.Server + Socket.io + node-cron; ponto de entrada
├── config.js                 # (P1) — estendido: flags de cookie, ORIGENS_PERMITIDAS
├── auth/
│   ├── senha.js              # hashSenha / verificarSenha (bcrypt cost 12) — extraído do seed
│   ├── sessao.js             # cria o middleware express-session (connect-pg-simple, schema-aware)
│   ├── middleware.js         # requireCliente, requireEquipe, requireAdmin, anexarSessaoAnonima
│   └── rateLimit.js          # limitadores (login, envio de mensagem)
├── http/
│   ├── validar.js            # validarCorpo(schema) / validarQuery(schema) — zod → 400
│   ├── erros.js              # mapaErroHttp: código do motor → { status, corpo }
│   ├── origem.js             # exigirOrigemConfiavel — bloqueia mutação cross-site
│   └── async.js              # rota(fn) — wrapper que encaminha rejeição ao error handler
├── realtime/
│   ├── io.js                 # cria/guarda a instância Socket.io; salas; auth via sessão
│   ├── eventos.js            # nomes de eventos (constantes)
│   └── emitir.js             # emitirHorarioReservado / ...Liberado / ...AgendaAtualizada /
│                             #   ...NovoAgendamento / ...AgendamentoAtualizado / ...DashboardTick
├── lib/
│   ├── celular.js            # normalizarCelular (só dígitos, com DDI/DDD)
│   └── datas.js              # helpers de "hoje", início/fim do mês, no fuso da barbearia
├── repos/                    # acesso a dados para as rotas (o motor fica em src/agenda/)
│   ├── clientes.js
│   ├── usuarios.js
│   ├── servicos.js
│   ├── agendamentos.js       # listagens/filtros/paginação, dashboard, criação manual
│   ├── disponibilidadeMeses.js   # agenda_disponibilidade CRUD (abrir/fechar mês)
│   ├── bloqueios.js
│   ├── configuracao.js
│   ├── templates.js
│   ├── comissoes.js          # relatório calculado (JSON)
│   ├── mensagens.js          # log mensagens_whatsapp
│   └── logs.js               # logs_acesso
├── services/
│   ├── whatsapp.js           # enviar(mensagemRow) — driver 'simulado' | 'meta' por env
│   ├── sms.js                # enviarOtp / verificarOtp — driver 'simulado' | 'twilio'
│   ├── mapa.js               # dadosMapa() → { provedor, embedUrl, comoChegarUrl }
│   └── mensageiro.js         # processarPendentes(): drena mensagens_whatsapp 'pendente'
└── routes/
    ├── saude.js              # GET /healthz
    ├── auth.js               # /api/auth/*
    ├── publicas.js           # /api/agenda/*  (+ redireciona / , /agendar ... para P3)
    ├── clienteApi.js         # /api/cliente/*
    ├── adminApi.js           # /api/admin/*
    └── webhooks.js           # /webhooks/whatsapp

src/db/migrations/002_session.sql   # tabela `session` do connect-pg-simple

test/http/…                  # supertest por área
test/realtime/…              # socket.io-client
test/services/…              # mensageiro, whatsapp stub, celular, datas
```

---

## 3. Dependências novas

**Runtime:** `express` (^4.19), `express-session` (^1.18), `connect-pg-simple`
(^9), `socket.io` (^4.7), `helmet` (^7), `express-rate-limit` (^7), `node-cron`
(^3), `pino` (^9), `pino-http` (^10), `cookie` (^0.6 — parse do handshake do
socket).
**Dev:** `supertest` (^7), `socket.io-client` (^4.7).

`package.json` ganha scripts: `"start": "node --env-file=.env src/server.js"` e
`"dev": "node --env-file=.env --watch src/server.js"`. O script `test` continua
`node --env-file=.env --env-file=.env.test --test --test-concurrency=1`.

---

## 4. Servidor: `app.js` vs `server.js`

- **`buildApp({ io } = {})` em `src/app.js`** monta e devolve o app Express: parse
  de JSON (limite 100kb), `pino-http`, `helmet` (CSP mínima — liberada de verdade
  no P3 quando houver assets), `trust proxy` = `1`, o middleware de sessão, as
  rotas, o 404 e o error handler. **Não** chama `listen`, **não** inicia cron.
  Recebe `io` (ou `null`) e o injeta em `req.io` para as rotas emitirem eventos.
- **`src/server.js`** cria `http.createServer`, chama `criarIo(server, sessaoMw)`
  de `realtime/io.js`, monta `buildApp({ io })`, faz `server.listen(config.PORT)`,
  e agenda dois cron jobs com `node-cron`:
  - a cada **1 min**: `locks.limparExpirados()` → para cada lock removido, emitir
    `horario_liberado` e invalidar cache da data.
  - a cada **1 min**: `mensageiro.processarPendentes()` (rede de segurança do
    worker).
  `server.js` também trata `SIGTERM`/`SIGINT`: para o cron, fecha o io, drena o
  server, `fecharPool()`.
- Testes de rota importam `buildApp()` e passam para `supertest(app)` — sem
  `listen`, sem cron, sem porta. Testes de tempo real sobem um `http.Server`
  efêmero (`server.listen(0)`).

---

## 5. Sessão e autenticação

### 5.1 Store

`auth/sessao.js` exporta `criarSessaoMiddleware()` = `session({ store: new
(connectPgSimple(session))({ pool, schemaName: schema, tableName: 'session',
createTableIfMissing: false }), secret: config.SESSION_SECRET, resave: false,
saveUninitialized: false, rolling: true, cookie: { httpOnly: true, sameSite:
'lax', secure: config.NODE_ENV === 'production', maxAge: <ver 5.3> } })`.

`schemaName: schema` (o `schema` exportado por `src/db/pool.js`) faz as sessões de
teste viverem no schema `test` e as de produção no `public`. A tabela é criada
pela migration `002_session.sql` (DDL padrão do connect-pg-simple: `sid` pk,
`sess jsonb`, `expire timestamptz`, índice em `expire`), **sem** qualificar
schema — o `search_path` do pool resolve.

### 5.2 Duas faces da sessão

- **Cliente:** `req.session.clienteId` (número). Criada por
  `POST /api/agenda/cadastro` e `POST /api/auth/cliente/login`.
- **Equipe:** `req.session.usuarioId` + `req.session.role` (`'admin'` |
  `'barbeiro'`). Criada por `POST /api/auth/admin/login`.
- As duas são mutuamente exclusivas: fazer login de equipe limpa `clienteId` e
  vice-versa.
- **Sessão anônima:** o fluxo de agendamento precisa de um `sessionId` estável
  antes do cadastro (para os locks). `anexarSessaoAnonima` garante
  `req.session` salva e usa `req.sessionID` como o `sessionId` passado ao motor
  de locks. Nada é gravado além do cookie até o cadastro.

### 5.3 Middlewares (`auth/middleware.js`)

| Middleware | Regra | Falha |
|---|---|---|
| `anexarSessaoAnonima` | garante cookie de sessão; expõe `req.sessionId = req.sessionID` | — |
| `requireCliente` | `req.session.clienteId` presente | `401 { erro: 'NAO_AUTENTICADO' }` |
| `requireEquipe` | `req.session.usuarioId` e `role ∈ ('admin','barbeiro')` | `401` |
| `requireAdmin` | `requireEquipe` + `role === 'admin'` | `403 { erro: 'SEM_PERMISSAO' }` |

`maxAge`: 30 dias para sessão de cliente, 12 h para equipe. Como o store é único,
o `maxAge` do cookie é o maior (30 d) e a expiração de equipe é reforçada na
aplicação: grava `req.session.equipeExpiraEm = Date.now() + 12h` no login e
`requireEquipe` recusa (e destrói a sessão) se `Date.now() > equipeExpiraEm`.
`rolling: true` renova a cada request.

### 5.4 Senha

`auth/senha.js`: `hashSenha(texto) → Promise<string>` (bcrypt cost 12),
`verificarSenha(texto, hash) → Promise<boolean>`. O `seed.js` do P1 passa a
importar `hashSenha` em vez de chamar `bcrypt` direto (refactor pequeno, mantém
o teste do seed verde).

### 5.5 Rate limiting (`auth/rateLimit.js`)

`express-rate-limit` com store em memória (uma instância só). 
- `limiteLogin`: 5 tentativas / 15 min por `ip` + email/celular do corpo →
  `429 { erro: 'MUITAS_TENTATIVAS' }`. Aplicado a `/api/auth/*/login`.
- `limiteMensagens`: 30 / 5 min por `ip` → aplicado a
  `POST /api/admin/mensagens/enviar`.
Toda tentativa de login (ok e falha) grava em `logs_acesso` via `repos/logs.js`.

---

## 6. Validação e forma de erro

### 6.1 `http/validar.js`

`validarCorpo(schema)` e `validarQuery(schema)` — middlewares que rodam
`schema.safeParse`; em erro respondem `400 { erro: 'VALIDACAO', campos: [{ caminho,
mensagem }] }` e não chamam `next`. Em sucesso substituem `req.body` / `req.query`
pelo objeto parseado (com coerção). Schemas ficam junto de cada arquivo de rota.

### 6.2 `http/erros.js` — `mapaErroHttp`

O motor (`src/agenda/*`) devolve `{ ok:false, erro:'CODIGO' }` ou
`{ fechado:'motivo' }`. A camada HTTP normaliza tudo para **maiúsculo** e mapeia:

| Código do motor | HTTP | Corpo |
|---|---|---|
| `HORARIO_INDISPONIVEL`, `SLOT_TRAVADO`, `SLOT_OCUPADO` | 409 | `{ erro }` |
| `MES_FECHADO`, `DIA_FECHADO`, `FORA_DO_EXPEDIENTE`, `ANTECEDENCIA`, `LIMITE_ATINGIDO`, `SERVICO_INVALIDO` | 422 | `{ erro }` |
| `NAO_ENCONTRADO` | 404 | `{ erro }` |
| `JA_CANCELADO`, `JA_CONCLUIDO` | 409 | `{ erro }` |
| `NAO_AUTENTICADO` | 401 | `{ erro }` |
| `SEM_PERMISSAO` | 403 | `{ erro }` |
| (validação) `VALIDACAO` | 400 | `{ erro, campos }` |
| não mapeado / exceção | 500 | `{ erro: 'ERRO_INTERNO' }` (loga stack, não vaza) |

`fechado:'mes_fechado'` de `horariosDisponiveis` **não** é erro HTTP — a rota
`GET /api/agenda/horarios` responde `200 { horarios: [], fechado: 'MES_FECHADO' }`.

### 6.3 `http/async.js`

`rota(fn)` embrulha um handler async e encaminha rejeições ao error handler
central, que consulta `mapaErroHttp`. Handlers nunca fazem `try/catch` de
infraestrutura.

---

## 7. Tempo real (`src/realtime/`)

### 7.1 `io.js`

`criarIo(httpServer, sessaoMw)`:
- `const io = new Server(httpServer, { transports: ['websocket','polling'] })`.
- `io.engine.use(sessaoMw)` — reaproveita **o mesmo** middleware de sessão do
  Express, então `socket.request.session` traz `clienteId` / `usuarioId` / `role`.
- `io.on('connection')`: se `session.usuarioId` + role de equipe → `socket.join('admin')`.
  O socket escuta `entrar_agenda` `{ data }` → valida `data` (YYYY-MM-DD) → sai da
  sala `agenda:*` anterior e entra em `agenda:<data>`. `sair_agenda` → sai.
- Guarda a instância num módulo (`let io; export const getIo = () => io`) para o
  cron e o worker emitirem sem ter o `req`.

### 7.2 `eventos.js` — constantes

`HORARIO_RESERVADO`, `HORARIO_LIBERADO`, `AGENDA_ATUALIZADA`, `NOVO_AGENDAMENTO`,
`AGENDAMENTO_ATUALIZADO`, `DASHBOARD_TICK`.

### 7.3 `emitir.js` — API que as rotas chamam

Cada função recebe `io` (de `req.io` ou `getIo()`):

| Função | Emite para | Payload |
|---|---|---|
| `emitirHorarioReservado(io, { data, horario })` | `agenda:<data>` | `{ data, horario }` |
| `emitirHorarioLiberado(io, { data, horario })` | `agenda:<data>` | `{ data, horario }` |
| `emitirAgendaAtualizada(io, { data })` | `agenda:<data>` | `{ data }` |
| `emitirNovoAgendamento(io, ag)` | `admin` | `{ id, cliente, servico, data, horario, status }` |
| `emitirAgendamentoAtualizado(io, { id, status, data })` | `admin` | `{ id, status }` |
| `emitirDashboardTick(io)` | `admin` | contadores frescos (via `repos/agendamentos.dashboard()`) |

Regra do design pai (4.4 passo 8): **o motor não emite nada**; a rota, após o
`confirmarAgendamento`/`cancelar`/`remarcar` retornar sucesso, é quem chama
`emitir*` **e** `cache.invalidarData(data)`. O cron e o worker usam `getIo()`.

### 7.4 Invalidação de cache — onde exatamente

| Ação da rota | Depois do sucesso |
|---|---|
| `POST /api/agenda/lock` | `emitirHorarioReservado`; `cache.invalidarData(data)` |
| `POST /api/agenda/lock/liberar` (e expiração via cron) | `emitirHorarioLiberado`; `cache.invalidarData(data)` |
| `POST /api/agenda/confirmar`, `POST /api/admin/agendamentos` | `emitirAgendaAtualizada`; `emitirNovoAgendamento`; `emitirDashboardTick`; `cache.invalidarData(data)`; `await mensageiro.processarPendentes({ limite: 5 })` (stub é rápido; erro do worker não derruba a resposta — é logado e o cron re-tenta) |
| `PATCH /api/admin/agendamentos/:id/status`, `cancelar`, `remarcar` | `emitirAgendaAtualizada` (nas datas afetadas — remarcar mexe em 2); `emitirAgendamentoAtualizado`; `emitirDashboardTick`; `cache.invalidarData` nas datas |

Um helper `pos-escrita.js`? Não — cada rota chama explicitamente, é legível e são
poucas. `renovarLock` **não** invalida (não muda disponibilidade).

---

## 8. Rotas — contrato

Prefixos: `/api/agenda/*` e `/webhooks/*` públicas; `/api/cliente/*` exige
`requireCliente`; `/api/admin/*` exige `requireEquipe` (as de escrita de config e
anonimização exigem `requireAdmin`). Toda rota mutadora passa por
`exigirOrigemConfiavel` (checa `Origin`/`Referer` contra `config.APP_URL` +
`config.ORIGENS_PERMITIDAS`; libera requests sem `Origin` só para `GET`).

### 8.1 Públicas (`routes/publicas.js`, `routes/auth.js`, `routes/saude.js`)

| Método | Rota | Corpo/Query | Resposta |
|---|---|---|---|
| GET | `/healthz` | — | `200 { ok:true, db:true }` ou `503 { ok:false, db:false }` |
| GET | `/api/agenda/servicos` | — | `200 { servicos: [{ id, nome, duracao_minutos, preco }] }` (só `ativo`) |
| GET | `/api/agenda/dias` | `ano, mes, servico_id` | `200 { dias: ['2026-09-10', …] }` — dias do mês com ≥1 horário livre; `{ dias: [], fechado:'MES_FECHADO' }` se o mês não está aberto |
| GET | `/api/agenda/horarios` | `data, servico_id, [barbeiro_id]` | `200 { horarios: ['09:00', …], fechado: null\|'…' }` — usa `req.sessionId` p/ enxergar o próprio lock |
| POST | `/api/agenda/lock` | `{ data, horario, servico_id, [barbeiro_id] }` | `200 { ok:true, expira_em }` \| `409 { erro }` |
| POST | `/api/agenda/lock/renovar` | idem | `200 { ok:true, expira_em }` \| `409 { erro:'LOCK_EXPIRADO' }` |
| POST | `/api/agenda/lock/liberar` | idem | `200 { ok:true }` |
| POST | `/api/agenda/cadastro` | `{ nome, celular, [email], [senha], consentimento:true }` | `201 { cliente: { id, nome } }` + abre sessão de cliente; `409 { erro:'CELULAR_EM_USO' }` se o celular já tem senha e não bate |
| POST | `/api/agenda/confirmar` | `{ servico_id, data, horario, [observacoes], [barbeiro_id] }` + sessão cliente | `201 { agendamento }` \| `4xx { erro }` (via `mapaErroHttp`) |
| POST | `/api/auth/cliente/login` | `{ celular, senha }` | `200 { cliente: { id, nome } }` \| `401 { erro:'CREDENCIAIS_INVALIDAS' }` (rate-limited) |
| POST | `/api/auth/logout` | — | `204` |
| GET/POST | `/webhooks/whatsapp` | ver §10 | — |

`/api/agenda/cadastro`: se `senha` vier, exige `email`; hash com `hashSenha`. Sem
`senha`, cadastro simples (celular+nome). `celular` normalizado por
`normalizarCelular`; `UNIQUE` no banco → se já existe **sem** senha, reusa o
cliente; se existe **com** senha, exige login (não sobrescreve).

### 8.2 Área do cliente (`routes/clienteApi.js`, `requireCliente`)

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/cliente/me` | `{ id, nome, celular, email, celular_verificado }` |
| GET | `/api/cliente/agendamentos?quando=futuros\|historico` | `{ agendamentos: [{ id, data, horario_inicio, horario_fim, status, servico:{nome,preco}, barbeiro:{nome} }] }` |
| POST | `/api/cliente/agendamentos/:id/cancelar` | `{ motivo }` → `200 { agendamento }`; `403 { erro:'FORA_DO_PRAZO' }` se faltam ≤ `antecedencia_min_horas`; `404` se não é dele |
| POST | `/api/cliente/agendamentos/:id/remarcar` | `{ nova_data, novo_horario }` → `200 { agendamento }` \| `4xx { erro }` |

Cancelar/remarcar do cliente: a rota confere `agendamento.cliente_id ===
req.session.clienteId` **antes** de chamar o motor.

### 8.3 Painel admin (`routes/adminApi.js`)

| Área | Método | Rota | Notas |
|---|---|---|---|
| Dashboard | GET | `/api/admin/dashboard` | `{ hoje: [...], contadores: { agendamentos_mes, faturamento_mes, comissao_mes, cortes_hoje } }` |
| Agendamentos | GET | `/api/admin/agendamentos` | query `data?, de?, ate?, status?, cliente?, page?` (20/pág); `{ itens, total, page }` |
| | PATCH | `/api/admin/agendamentos/:id/status` | `{ status: 'confirmado'\|'concluido'\|'cancelado', motivo? }` → usa `confirmar`/`cancelar` do motor ou UPDATE direto p/ `concluido` |
| | POST | `/api/admin/agendamentos` | `{ cliente_id\|{nome,celular}, servico_id, data, horario, barbeiro_id?, observacoes? }` → cria cliente se preciso, chama `confirmarAgendamento` |
| Meses | GET | `/api/admin/disponibilidade?ano=` | `{ meses: [{ mes, status, limite_por_dia }] }` (12 linhas, default `fechado`) |
| | POST | `/api/admin/disponibilidade` | `{ ano, mes, status, limite_por_dia?, barbeiro_id? }` → upsert em `agenda_disponibilidade` |
| Bloqueios | GET | `/api/admin/bloqueios?de=&ate=` | lista |
| | POST | `/api/admin/bloqueios` | `{ data, dia_inteiro:bool, hora_inicio?, hora_fim?, motivo?, barbeiro_id? }` |
| | DELETE | `/api/admin/bloqueios/:id` | `204` |
| Serviços | GET | `/api/admin/servicos` | inclui inativos |
| | POST | `/api/admin/servicos` | `{ nome, duracao_minutos, preco, comissao_percentual }` |
| | PATCH | `/api/admin/servicos/:id` | campos parciais + `ativo` |
| | DELETE | `/api/admin/servicos/:id` | soft (`ativo=false`) se há agendamentos; hard se nunca usado → `204` |
| Clientes | GET | `/api/admin/clientes?busca=&page=` | por nome/celular |
| | GET | `/api/admin/clientes/:id` | ficha + histórico |
| | POST | `/api/admin/clientes/:id/anonimizar` | **`requireAdmin`** — `nome='removido'`, `celular` embaralhado único, `email=null`, `senha_hash=null`; mantém agendamentos |
| Comissões | GET | `/api/admin/comissoes?mes=&ano=&barbeiro_id=` | `{ linhas: [{ servico, qtd, faturamento, percentual, comissao }], total: {...} }` (base: `status='concluido'`) |
| Config | GET | `/api/admin/configuracao` | linha 1 + `horario_funcionamento` (7 linhas) |
| | PUT | `/api/admin/configuracao` | **`requireAdmin`** — campos de `configuracao` + array `expediente` |
| Templates | GET | `/api/admin/templates` | 3 linhas |
| | PUT | `/api/admin/templates/:chave` | `{ titulo, corpo, ativo }` |
| Mensagens | GET | `/api/admin/mensagens?agendamento_id=&status=&page=` | log |
| | POST | `/api/admin/mensagens/enviar` | `{ agendamento_id, template_chave }` → renderiza, insere `pendente`, dispara worker; rate-limited |

`PATCH /status`:
- `→ confirmado`: `UPDATE status='confirmado'` (sem re-verificar slot — já existe).
- `→ concluido`: `UPDATE status='concluido', updated_at=now()`; dispara template
  `pos_atendimento` (insere `pendente`).
- `→ cancelado`: chama `cancelarAgendamento(id, { motivo })` do motor.

### 8.4 Ordem canônica (design pai §6.1) — mapeada para rotas

```
GET /api/agenda/servicos
GET /api/agenda/dias        → GET /api/agenda/horarios
POST /api/agenda/lock       → emite horario_reservado; invalida cache
   (heartbeat POST /api/agenda/lock/renovar a cada ~2 min)
POST /api/agenda/cadastro   → sessão de cliente
POST /api/agenda/confirmar  → confirmarAgendamento (motor, P1)
   sucesso 201 → emite agenda_atualizada + novo_agendamento + dashboard_tick;
                 invalida cache; await mensageiro.processarPendentes (try/catch logando)
   409/422     → cliente volta ao passo do horário
```

---

## 9. Worker de mensagens (`services/mensageiro.js`)

`processarPendentes({ limite = 20 } = {})`:

1. `withTransaction`: `SELECT id FROM mensagens_whatsapp WHERE status_envio='pendente'
   ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`.
2. Para cada, chama `whatsapp.enviar(row)`; grava resultado
   (`status_envio`, `enviado_em`, `erro`). Stub → `'simulado'`.
3. Retorna `{ processadas, falhas }`.

Disparado: (a) `await` (com `try/catch` que só loga) ao fim de `POST /confirmar`,
`POST /api/admin/agendamentos` e `POST /api/admin/mensagens/enviar` — assim o
teste observa o resultado sem polling e uma falha do worker não quebra a
resposta; (b) `node-cron` 1/min como rede de segurança. `FOR UPDATE SKIP LOCKED`
torna concorrência segura (rota + cron ao mesmo tempo).

`services/whatsapp.js`: `enviar(row) → { status, erro? }`. Sem
`WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` no env → driver `simulado`
(`{ status: 'simulado' }`, loga). Com eles → driver `meta` (`POST
graph.facebook.com/v20.0/<id>/messages`, `Authorization: Bearer`, corpo de
`text`); **o driver `meta` fica escrito mas coberto só por teste de unidade com
`fetch` stubado** — sem credencial real, o caminho de rede não roda em CI.

`services/sms.js`: `enviarOtp(celular)` / `verificarOtp(celular, codigo)` usando
`otp_codigos` (hash do código com bcrypt, `expira_em` 10 min, 5 tentativas).
Driver `simulado` → código fixo `000000`, sempre "enviado". **Não há rota de OTP
no P2** — as funções ficam prontas para o P3 plugar no cadastro.

---

## 10. Webhook `/webhooks/whatsapp` (`routes/webhooks.js`)

- **GET**: handshake da Meta. Se `WHATSAPP_VERIFY_TOKEN` setado e
  `req.query['hub.verify_token']` bate e `hub.mode === 'subscribe'` → responde
  `200` com `hub.challenge` cru. Senão `403`. Sem o token no env → `404` (webhook
  desligado).
- **POST**: se `WHATSAPP_APP_SECRET` setado, valida `X-Hub-Signature-256`
  (HMAC-SHA256 do corpo cru) — precisa do corpo raw, então esta rota registra
  `express.raw({ type: '*/*' })` antes do parser JSON global (montada com seu
  próprio parser). Sem o secret → aceita sem validar (modo stub).
  Processa dois tipos de evento do payload da Cloud API:
  - **statuses[]**: `sent/delivered/read/failed` → atualiza a
    `mensagens_whatsapp` correspondente por `wamid` (guardado no envio real) →
    `enviado/entregue/entregue/falha`.
  - **messages[]** com `text.body` ∈ {`SIM`,`NÃO`,`NAO`} (case-insensitive): acha
    o agendamento `pendente`/`confirmado` mais recente do `from` (celular) e
    marca `confirmado` (SIM) ou `cancelado` (NÃO, `motivo='cancelado via WhatsApp'`);
    emite eventos + invalida cache.
  Sempre responde `200` rápido (a Meta re-tenta em não-2xx).

---

## 11. `config.js` — acréscimos

Novos campos no schema `zod` (todos com default seguro):

| Var | Default | Uso |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | já existe; base p/ checagem de origem e webhook |
| `ORIGENS_PERMITIDAS` | `''` | CSV extra p/ `exigirOrigemConfiavel` |
| `COOKIE_SECURE` | `''` | `'1'` força `secure` mesmo fora de produção (p/ deploy atrás de proxy TLS no P4) |
| `WHATSAPP_APP_SECRET` | `''` | valida assinatura do webhook |
| `LOG_LEVEL` | `'info'` | `pino` |

`SESSION_SECRET` (já existe) passa a ser **obrigatório e ≥ 32 hex** quando
`NODE_ENV === 'production'` (refinamento do `.superRefine`).

---

## 12. Segurança (o que o P2 implementa da seção 8 do design pai)

- Sessões `httpOnly` + `sameSite=lax` + `secure` em produção; store em Postgres
  (revogável, sobrevive a restart).
- `bcrypt` cost 12; senha nunca em resposta nem log (`pino` redaction em
  `req.body.senha`).
- `express-rate-limit` no login e no envio de mensagens; `logs_acesso` em toda
  tentativa.
- `helmet` (HSTS só em produção; CSP mínima no P2, ampliada no P3).
- `exigirOrigemConfiavel` em toda rota mutadora (defesa CSRF de linha de base
  junto do `sameSite=lax`; token CSRF fica p/ P3 com os formulários).
- `zod` em todo corpo/query; `pg` 100% parametrizado (herdado do P1).
- LGPD: `POST /clientes/:id/anonimizar` (admin), e o P3 adiciona a página
  `/privacidade` e o consentimento visual (o campo `consentimento` já é exigido
  no cadastro via API).
- **HTTPS, backup, `pg_dump`** → P4 (deploy).

---

## 13. Estratégia de testes

- **`supertest` por área** (`test/http/*.test.js`): sobe `buildApp()` sem
  `listen`. `supertest.agent(app)` para manter cookie entre requests (login →
  rota protegida). Cada arquivo: `beforeEach` = `prepararBanco()` + `semearBase()`
  + `cache.limparTudo()`.
  - auth: cadastro simples/ com senha; login ok/falha; rate-limit dispara no 6º;
    logout; `requireCliente`/`requireEquipe`/`requireAdmin` barram sem sessão e
    com a sessão errada; expiração de 12 h da equipe.
  - agenda pública: `servicos`, `dias`, `horarios` (incl. `fechado`), `lock` →
    `renovar` → `liberar`, `lock` duplicado → 409, `confirmar` feliz + 409 no
    2º, `confirmar` sem sessão → 401.
  - cliente: `me`, listar futuros/histórico, cancelar dentro/fora do prazo,
    cancelar agendamento de outro → 404, remarcar.
  - admin: dashboard com números certos após 2 agendamentos; listar com filtros +
    paginação; `PATCH /status` para cada alvo; criação manual; abrir/fechar mês
    (e refletir em `GET /api/agenda/dias`); bloqueio some da grade; CRUD serviços
    (soft vs hard delete); busca de cliente; anonimizar (e negar p/ `barbeiro`);
    comissões com total; `PUT configuracao` muda a grade; `PUT templates`;
    `mensagens/enviar` insere `pendente` e o worker resolve p/ `simulado`.
- **Tempo real** (`test/realtime/*.test.js`): `http.Server` efêmero + `criarIo` +
  `socket.io-client`. Cliente entra em `agenda:2026-09-10`; um `POST /confirmar`
  noutro `agent` dispara `agenda_atualizada` recebido pelo socket. Socket de
  equipe (sessão de admin no handshake) recebe `novo_agendamento`. Um socket
  anônimo **não** entra na sala `admin`.
- **Unidade** (`test/services`, `test/lib`): `normalizarCelular`,
  `datas.inicioDoMes`/`hoje`, `mapaErroHttp`, `mensageiro.processarPendentes`
  (com `whatsapp.enviar` stubado e `FOR UPDATE SKIP LOCKED` — dois
  `processarPendentes` paralelos não processam a mesma linha), driver `meta` do
  `whatsapp` com `fetch` stubado.
- **Migração**: `002_session.sql` cria a tabela `session` no schema corrente;
  `migrate.test.js` (P1) ganha a asserção da 15ª tabela.
- Suíte roda com `--test-concurrency=1` (já configurado); toda rota que grava usa
  o schema `test` via `search_path`.

---

## 14. Impacto no P1 (mudanças pequenas e cobertas)

1. `src/db/seed.js`: trocar `bcrypt.hash(config.ADMIN_SENHA, 12)` por
   `hashSenha(config.ADMIN_SENHA)` (novo `src/auth/senha.js`). Teste do seed
   permanece igual.
2. `src/db/migrations/002_session.sql`: nova migração (não altera as tabelas do
   P1).
3. `package.json`: novas dependências + scripts `start`/`dev`.
4. `.env.example`: novas vars da seção 11.
5. `docs/superpowers/specs/2026-09-05-…`: sem mudança (esta spec é aditiva).

Nada em `src/agenda/*` muda — o motor já expõe a interface que as rotas
consomem (`confirmarAgendamento`, `cancelarAgendamento`, `remarcarAgendamento`,
`horariosDisponiveis`, `criarLock`/`renovarLock`/`liberarLock`,
`calcularComissao` via repos).

---

## 15. Fases seguintes (contexto)

- **P3 — Frontend:** EJS + Alpine + cliente Socket.io consumindo estas rotas;
  página `/privacidade`; CSRF por token; CSP ampliada; export PDF/Excel.
- **P4 — Deploy:** Render (web service + Postgres), `DEPLOY.md` (+ alternativa
  VPS), GitHub Actions, `TZ`, `pg_dump` agendado, domínio + HTTPS, webhook da
  Meta apontado para `APP_URL`.
- **Pós-P4 — Integrações reais:** credenciais da WhatsApp Cloud API (ativa o
  driver `meta`), provedor de SMS/OTP, templates aprovados na Meta.
