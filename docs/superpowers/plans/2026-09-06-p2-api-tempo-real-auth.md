# P2 — API + Tempo Real + Auth — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a camada HTTP+tempo real do sistema: servidor Express + Socket.io, sessões, autenticação de cliente e de equipe, e todas as rotas REST (pública, cliente, admin) que orquestram o motor de agenda do P1, com worker de mensagens e stubs de WhatsApp/SMS/mapa.

**Architecture:** `src/app.js` monta o app Express puro (sem `listen`, sem cron) para os testes; `src/server.js` sobe HTTP + Socket.io + `node-cron` e é o ponto de entrada. As rotas validam com `zod`, chamam repositórios finos (`src/repos/*`) e o motor do P1 (`src/agenda/*`), e — só na camada de rota — emitem eventos de tempo real e invalidam o cache. Sessão em Postgres via `connect-pg-simple` com `schemaName` = o schema do pool (isolamento de teste herdado do P1).

**Tech Stack:** Node 20+, ESM, Express 4, express-session + connect-pg-simple, socket.io 4, helmet, express-rate-limit, node-cron, pino; testes com `node:test` + supertest + socket.io-client, contra o PostgreSQL do Supabase no schema `test`.

**Spec:** `docs/superpowers/specs/2026-09-06-p2-api-tempo-real-auth-design.md` (deriva de `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` seções 5, 6, 8, 9).

## Global Constraints

- **Runtime:** Node 20+. `package.json` tem `"type": "module"` e `"engines": { "node": ">=20" }`. ESM only, nunca `require`.
- **Banco:** PostgreSQL (Supabase), conexão com SSL. Isolamento de teste por schema: `NODE_ENV=test` → tudo roda no schema de `config.TEST_SCHEMA` (default `test`) via `search_path` do pool. Não existe `DATABASE_URL_TEST`.
- **`.env` e `.env.test` já existem** na raiz, git-ignorados. As tarefas só editam `.env.example`. `npm test` = `node --env-file=.env --env-file=.env.test --test --test-concurrency=1` (arquivos em série — compartilham o schema `test`).
- **SQL 100% parametrizado.** Interpolar só constantes internas do código e o identificador `schema` (já validado por regex no `config`).
- **O motor (`src/agenda/*`) não muda e não conhece HTTP.** Emissão de eventos de tempo real e `cache.invalidarData` acontecem **só na camada de rota** (design pai §4.4 passo 8), nunca dentro de `src/agenda/*` nem `src/repos/*`.
- **Nada em `src/agenda/`, `src/lib/`, `src/repos/`, `src/services/` importa `express` ou `socket.io`.** Só `src/app.js`, `src/server.js`, `src/routes/*`, `src/http/*`, `src/auth/*` e `src/realtime/*` podem.
- **Forma de erro HTTP:** toda resposta de erro é `{ erro: 'CODIGO_MAIUSCULO', ... }`. O `mapaErroHttp` (Task A2) traduz códigos do motor para status. Exceção não mapeada → `500 { erro: 'ERRO_INTERNO' }` (stack logada, nunca no corpo).
- **Timezone:** a app assume o fuso da barbearia via `TZ` no ambiente. Cálculo de "hoje"/mês usa `src/lib/datas.js`; nunca `new Date()` cru para lógica de calendário nas rotas.
- **Idioma:** identificadores, comentários e mensagens em pt-BR.
- **Testes:** `node:test` + `supertest` (rotas, sem `listen`) + `socket.io-client` (tempo real, server efêmero em porta 0). Cada arquivo: `beforeEach` = `prepararBanco()` + `semearBase()` + `cache.limparTudo()` **+ `resetRateLimit()`** (de `src/auth/rateLimit.js`, existe a partir da Task B11) em todo arquivo de teste HTTP que bate em `/api/auth/*` ou `/api/admin/mensagens/enviar`. Toda rota nova ganha teste no mesmo commit (TDD).
- **Commits frequentes**, um por tarefa no mínimo, mensagem em pt-BR terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos criada neste plano

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | +deps HTTP; scripts `start`, `dev` |
| `.env.example` | +vars da spec §11 |
| `src/config.js` (mod.) | +`ORIGENS_PERMITIDAS`, `COOKIE_SECURE`, `WHATSAPP_APP_SECRET`, `LOG_LEVEL`; `SESSION_SECRET` ≥32 em produção |
| `src/http/async.js` | `rota(fn)` — encaminha rejeição ao error handler |
| `src/http/erros.js` | `mapaErroHttp`, `errorHandler`, `respostaDeErro(codigo)` |
| `src/http/validar.js` | `validarCorpo(schema)`, `validarQuery(schema)` |
| `src/http/origem.js` | `exigirOrigemConfiavel` |
| `src/lib/celular.js` | `normalizarCelular` |
| `src/lib/datas.js` | `hoje`, `inicioDoMes`, `fimDoMes`, `ehData` |
| `src/auth/senha.js` | `hashSenha`, `verificarSenha` |
| `src/auth/sessao.js` | `criarSessaoMiddleware()` |
| `src/auth/middleware.js` | `anexarSessaoAnonima`, `requireCliente`, `requireEquipe`, `requireAdmin` |
| `src/auth/rateLimit.js` | `limiteLogin`, `limiteMensagens` |
| `src/realtime/eventos.js` | constantes de nome de evento |
| `src/realtime/emitir.js` | `emitir*` (6 funções) |
| `src/realtime/io.js` | `criarIo(httpServer, sessaoMw)`, `getIo()` |
| `src/repos/*.js` | acesso a dados p/ as rotas (11 arquivos) |
| `src/services/whatsapp.js` | `enviar(row)` — driver `simulado`/`meta` |
| `src/services/sms.js` | `enviarOtp`, `verificarOtp` — driver `simulado`/`twilio` |
| `src/services/mapa.js` | `dadosMapa()` |
| `src/services/mensageiro.js` | `processarPendentes()` |
| `src/routes/saude.js` | `GET /healthz` |
| `src/routes/auth.js` | `/api/auth/*` |
| `src/routes/publicas.js` | `/api/agenda/*` |
| `src/routes/clienteApi.js` | `/api/cliente/*` |
| `src/routes/adminApi.js` | `/api/admin/*` |
| `src/routes/webhooks.js` | `/webhooks/whatsapp` |
| `src/app.js` | monta o Express (recebe `io`) |
| `src/server.js` | HTTP + Socket.io + cron; entrypoint |
| `src/db/migrations/002_session.sql` | tabela `session` |
| `test/http/*`, `test/realtime/*`, `test/services/*`, `test/lib/*` | testes |

**Fora do P2** (P3/P4): views EJS/CSS/Alpine, `/`, `/agendar`, `/minha-conta`, `/privacidade` (HTML); `DEPLOY.md`, Render, CI; driver real da WhatsApp Cloud API exercitado com credencial; OTP no fluxo de cadastro; export PDF/Excel; CSRF por token.

---

### Task A1: Dependências, config e scripts

**Files:**
- Modify: `package.json`, `.env.example`, `src/config.js`
- Test: `test/config.test.js` (acrescentar casos)

**Interfaces:**
- Consumes: `carregarConfig(env)` de `src/config.js` (P1).
- Produces: `config` ganha `ORIGENS_PERMITIDAS` (string, default `''`), `COOKIE_SECURE` (string, default `''`), `WHATSAPP_APP_SECRET` (string, default `''`), `LOG_LEVEL` (string, default `'info'`). `SESSION_SECRET` exige ≥32 chars quando `NODE_ENV==='production'`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `test/config.test.js`:

```js
test('novas vars de P2 têm defaults', () => {
  const c = carregarConfig(base);
  assert.equal(c.ORIGENS_PERMITIDAS, '');
  assert.equal(c.COOKIE_SECURE, '');
  assert.equal(c.WHATSAPP_APP_SECRET, '');
  assert.equal(c.LOG_LEVEL, 'info');
});

test('SESSION_SECRET curto é rejeitado só em produção', () => {
  assert.doesNotThrow(() => carregarConfig({ ...base, SESSION_SECRET: 'curto' }));
  assert.throws(
    () => carregarConfig({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'curto' }),
    /SESSION_SECRET/,
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/config.test.js`
Expected: FAIL (`ORIGENS_PERMITIDAS` undefined; produção não lança).

- [ ] **Step 3: Editar `src/config.js`**

No objeto `schema` do `zod`, acrescentar após `TWILIO_VERIFY_SERVICE_SID`:

```js
  ORIGENS_PERMITIDAS: z.string().default(''),
  COOKIE_SECURE: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
```

Trocar a linha `export function carregarConfig(env = process.env) {` e o corpo por:

```js
export function carregarConfig(env = process.env) {
  const r = schema.safeParse(env);
  if (!r.success) {
    const detalhe = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${detalhe}`);
  }
  if (r.data.NODE_ENV === 'production' && r.data.SESSION_SECRET.length < 32) {
    throw new Error('Configuração de ambiente inválida — SESSION_SECRET: mínimo 32 caracteres em produção');
  }
  return r.data;
}
```

- [ ] **Step 4: Editar `package.json`**

Em `scripts`, acrescentar:

```json
    "start": "node --env-file=.env src/server.js",
    "dev": "node --env-file=.env --watch src/server.js"
```

Em `dependencies`, acrescentar:

```json
    "connect-pg-simple": "^9.0.1",
    "cookie": "^0.6.0",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "express-session": "^1.18.0",
    "helmet": "^7.1.0",
    "node-cron": "^3.0.3",
    "pino": "^9.3.2",
    "pino-http": "^10.2.0",
    "socket.io": "^4.7.5"
```

Acrescentar bloco `devDependencies`:

```json
  "devDependencies": {
    "socket.io-client": "^4.7.5",
    "supertest": "^7.0.0"
  }
```

- [ ] **Step 5: Editar `.env.example`**

Acrescentar ao final:

```
ORIGENS_PERMITIDAS=
COOKIE_SECURE=
WHATSAPP_APP_SECRET=
LOG_LEVEL=info
```

- [ ] **Step 6: Instalar e rodar a suíte**

Run:
```bash
npm install
npm test -- test/config.test.js
npm test
```
Expected: `npm install` ok; config 6/6; suíte inteira verde (65 + os 2 novos = 67).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/config.js test/config.test.js
git commit -m "chore(p2): dependências HTTP, scripts start/dev e novas vars de config

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A2: `src/http/async.js` e `src/http/erros.js`

**Files:**
- Create: `src/http/async.js`, `src/http/erros.js`
- Test: `test/http/erros.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `rota(fn) => (req,res,next)` — chama `fn(req,res,next)` e faz `.catch(next)`.
  - `mapaErroHttp: Record<string, number>` — código → status.
  - `respostaDeErro(codigo) => { status, corpo }` — `corpo` = `{ erro: codigo }`; status do mapa ou 500 (`ERRO_INTERNO`).
  - `errorHandler(err, req, res, next)` — se `err.codigoHttp` (string) usa `respostaDeErro`; senão loga `err` via `req.log?.error` e responde `500 { erro: 'ERRO_INTERNO' }`.
  - `ErroHttp` — `class ErroHttp extends Error { constructor(codigo){ super(codigo); this.codigoHttp = codigo } }` para rotas lançarem.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/erros.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mapaErroHttp, respostaDeErro, ErroHttp } from '../../src/http/erros.js';

test('mapaErroHttp cobre os códigos do motor', () => {
  for (const c of ['HORARIO_INDISPONIVEL', 'MES_FECHADO', 'NAO_ENCONTRADO', 'JA_CANCELADO',
    'NAO_AUTENTICADO', 'SEM_PERMISSAO', 'VALIDACAO']) {
    assert.equal(typeof mapaErroHttp[c], 'number');
  }
});

test('respostaDeErro mapeia e cai para 500 no desconhecido', () => {
  assert.deepEqual(respostaDeErro('HORARIO_INDISPONIVEL'), { status: 409, corpo: { erro: 'HORARIO_INDISPONIVEL' } });
  assert.deepEqual(respostaDeErro('MES_FECHADO'), { status: 422, corpo: { erro: 'MES_FECHADO' } });
  assert.deepEqual(respostaDeErro('BANANA'), { status: 500, corpo: { erro: 'ERRO_INTERNO' } });
});

test('ErroHttp carrega o código', () => {
  const e = new ErroHttp('SEM_PERMISSAO');
  assert.equal(e.codigoHttp, 'SEM_PERMISSAO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/erros.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar `src/http/async.js`**

```js
// src/http/async.js
export function rota(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
```

- [ ] **Step 4: Implementar `src/http/erros.js`**

```js
// src/http/erros.js
export const mapaErroHttp = {
  VALIDACAO: 400,
  NAO_AUTENTICADO: 401,
  CREDENCIAIS_INVALIDAS: 401,
  SEM_PERMISSAO: 403,
  FORA_DO_PRAZO: 403,
  FORA_DO_EXPEDIENTE: 422,
  NAO_ENCONTRADO: 404,
  HORARIO_INDISPONIVEL: 409,
  SLOT_TRAVADO: 409,
  SLOT_OCUPADO: 409,
  LOCK_EXPIRADO: 409,
  JA_CANCELADO: 409,
  JA_CONCLUIDO: 409,
  CELULAR_EM_USO: 409,
  MES_FECHADO: 422,
  DIA_FECHADO: 422,
  ANTECEDENCIA: 422,
  LIMITE_ATINGIDO: 422,
  SERVICO_INVALIDO: 422,
  MUITAS_TENTATIVAS: 429,
};

export class ErroHttp extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'ErroHttp';
    this.codigoHttp = codigo;
  }
}

export function respostaDeErro(codigo) {
  const status = mapaErroHttp[codigo];
  if (!status) return { status: 500, corpo: { erro: 'ERRO_INTERNO' } };
  return { status, corpo: { erro: codigo } };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err && typeof err.codigoHttp === 'string') {
    const { status, corpo } = respostaDeErro(err.codigoHttp);
    if (err.campos) corpo.campos = err.campos;
    return res.status(status).json(corpo);
  }
  (req.log?.error ?? console.error)({ err }, 'erro não tratado na rota');
  res.status(500).json({ erro: 'ERRO_INTERNO' });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/erros.test.js`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add src/http/async.js src/http/erros.js test/http/erros.test.js
git commit -m "feat(p2): rota() async wrapper e mapaErroHttp/errorHandler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A3: `src/http/validar.js`

**Files:**
- Create: `src/http/validar.js`
- Test: `test/http/validar.test.js`

**Interfaces:**
- Consumes: `zod`; `ErroHttp` de `src/http/erros.js`.
- Produces:
  - `validarCorpo(schema) => (req,res,next)` — `schema.safeParse(req.body)`; em erro chama `next` com um `ErroHttp('VALIDACAO')` que carrega `.campos = [{ caminho, mensagem }]`; em sucesso `req.body = parsed` e `next()`.
  - `validarQuery(schema)` — idem para `req.query`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/validar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { validarCorpo } from '../../src/http/validar.js';

function rodar(mw, req) {
  return new Promise((resolve) => {
    const res = {};
    mw(req, res, (err) => resolve({ err, req }));
  });
}

test('validarCorpo passa e coage', async () => {
  const mw = validarCorpo(z.object({ n: z.coerce.number(), s: z.string() }));
  const { err, req } = await rodar(mw, { body: { n: '3', s: 'x' } });
  assert.equal(err, undefined);
  assert.deepEqual(req.body, { n: 3, s: 'x' });
});

test('validarCorpo rejeita com ErroHttp VALIDACAO + campos', async () => {
  const mw = validarCorpo(z.object({ s: z.string() }));
  const { err } = await rodar(mw, { body: {} });
  assert.equal(err.codigoHttp, 'VALIDACAO');
  assert.ok(Array.isArray(err.campos) && err.campos[0].caminho === 's');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/validar.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar**

```js
// src/http/validar.js
import { ErroHttp } from './erros.js';

function fazer(fonte) {
  return (schema) => (req, res, next) => {
    const r = schema.safeParse(req[fonte]);
    if (!r.success) {
      const e = new ErroHttp('VALIDACAO');
      e.campos = r.error.issues.map((i) => ({ caminho: i.path.join('.'), mensagem: i.message }));
      return next(e);
    }
    req[fonte] = r.data;
    next();
  };
}

export const validarCorpo = fazer('body');
export const validarQuery = fazer('query');
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/validar.test.js`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/http/validar.js test/http/validar.test.js
git commit -m "feat(p2): validarCorpo/validarQuery (zod -> ErroHttp VALIDACAO)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A4: `src/http/origem.js`

**Files:**
- Create: `src/http/origem.js`
- Test: `test/http/origem.test.js`

**Interfaces:**
- Consumes: `config` de `src/config.js`; `ErroHttp`.
- Produces: `exigirOrigemConfiavel(req,res,next)` — para métodos que não são `GET`/`HEAD`/`OPTIONS`: extrai a origem de `req.headers.origin` (ou o `origin` derivado de `req.headers.referer`); se ausente **e** o método é mutador → `next(new ErroHttp('SEM_PERMISSAO'))`; se presente e não está no conjunto `{ config.APP_URL } ∪ split(config.ORIGENS_PERMITIDAS, ',')` → mesmo erro; senão `next()`. `GET`/`HEAD`/`OPTIONS` passam sempre.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/origem.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { exigirOrigemConfiavel } from '../../src/http/origem.js';
import { config } from '../../src/config.js';

function rodar(req) {
  return new Promise((resolve) => exigirOrigemConfiavel(req, {}, (err) => resolve(err)));
}

test('GET passa sem Origin', async () => {
  assert.equal(await rodar({ method: 'GET', headers: {} }), undefined);
});

test('POST sem Origin é barrado', async () => {
  const err = await rodar({ method: 'POST', headers: {} });
  assert.equal(err.codigoHttp, 'SEM_PERMISSAO');
});

test('POST com Origin = APP_URL passa; origem estranha é barrada', async () => {
  assert.equal(await rodar({ method: 'POST', headers: { origin: config.APP_URL } }), undefined);
  const err = await rodar({ method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(err.codigoHttp, 'SEM_PERMISSAO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/origem.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar**

```js
// src/http/origem.js
import { config } from '../config.js';
import { ErroHttp } from './erros.js';

const SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function origensPermitidas() {
  const extras = config.ORIGENS_PERMITIDAS.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([config.APP_URL, ...extras]);
}

function origemDe(req) {
  if (req.headers.origin) return req.headers.origin;
  const ref = req.headers.referer;
  if (!ref) return null;
  try { return new URL(ref).origin; } catch { return null; }
}

export function exigirOrigemConfiavel(req, res, next) {
  if (SEGUROS.has(req.method)) return next();
  const origem = origemDe(req);
  if (!origem || !origensPermitidas().has(origem)) return next(new ErroHttp('SEM_PERMISSAO'));
  next();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/origem.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/http/origem.js test/http/origem.test.js
git commit -m "feat(p2): exigirOrigemConfiavel (defesa CSRF de linha de base)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A5: `src/lib/celular.js` e `src/lib/datas.js`

**Files:**
- Create: `src/lib/celular.js`, `src/lib/datas.js`
- Test: `test/lib/celular.test.js`, `test/lib/datas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `normalizarCelular(bruto: string) => string` — só dígitos; se 10–11 dígitos (DDD+número) prefixa `55`; se já começa com `55` e tem 12–13 dígitos mantém; lança `Error('CELULAR_INVALIDO')` fora de 10–13 dígitos após limpeza.
  - `datas.hoje() => 'YYYY-MM-DD'` (data local do processo).
  - `datas.inicioDoMes(ano, mes) => 'YYYY-MM-01'`; `datas.fimDoMes(ano, mes) => 'YYYY-MM-DD'` (último dia).
  - `datas.ehData(s) => boolean` — casa `^\d{4}-\d{2}-\d{2}$` e é uma data real.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/lib/celular.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCelular } from '../../src/lib/celular.js';

test('normaliza formatos comuns', () => {
  assert.equal(normalizarCelular('(28) 99967-5424'), '5528999675424');
  assert.equal(normalizarCelular('28999675424'), '5528999675424');
  assert.equal(normalizarCelular('+55 28 99967-5424'), '5528999675424');
  assert.equal(normalizarCelular('5528999675424'), '5528999675424');
});

test('rejeita entrada absurda', () => {
  assert.throws(() => normalizarCelular('123'), /CELULAR_INVALIDO/);
});
```

```js
// test/lib/datas.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as datas from '../../src/lib/datas.js';

test('inicio/fim do mês', () => {
  assert.equal(datas.inicioDoMes(2026, 9), '2026-09-01');
  assert.equal(datas.fimDoMes(2026, 9), '2026-09-30');
  assert.equal(datas.fimDoMes(2026, 2), '2026-02-28');
});

test('ehData', () => {
  assert.equal(datas.ehData('2026-09-10'), true);
  assert.equal(datas.ehData('2026-13-01'), false);
  assert.equal(datas.ehData('10/09/2026'), false);
});

test('hoje tem o formato certo', () => {
  assert.match(datas.hoje(), /^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/lib/celular.test.js test/lib/datas.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/lib/celular.js`**

```js
// src/lib/celular.js
export function normalizarCelular(bruto) {
  const d = String(bruto ?? '').replace(/\D+/g, '');
  if (d.length >= 12 && d.length <= 13 && d.startsWith('55')) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  throw new Error('CELULAR_INVALIDO');
}
```

- [ ] **Step 4: Implementar `src/lib/datas.js`**

```js
// src/lib/datas.js
function pad(n) { return String(n).padStart(2, '0'); }

export function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function inicioDoMes(ano, mes) {
  return `${ano}-${pad(mes)}-01`;
}

export function fimDoMes(ano, mes) {
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate(); // mes é 1-based; dia 0 = último do mês anterior
  return `${ano}-${pad(mes)}-${pad(ultimo)}`;
}

export function ehData(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/lib/celular.test.js test/lib/datas.test.js`
Expected: PASS (celular 2, datas 3).

- [ ] **Step 6: Commit**

```bash
git add src/lib/celular.js src/lib/datas.js test/lib/celular.test.js test/lib/datas.test.js
git commit -m "feat(p2): lib/celular (normalizarCelular) e lib/datas (hoje, mês, ehData)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A6: `src/app.js` + `GET /healthz`

**Files:**
- Create: `src/app.js`, `src/routes/saude.js`
- Test: `test/http/saude.test.js`

**Interfaces:**
- Consumes: `express`, `helmet`, `pino-http`; `errorHandler` de `src/http/erros.js`; `rota` de `src/http/async.js`; `query` de `src/db/pool.js`; `config`.
- Produces:
  - `buildApp({ io = null } = {}) => Express` — app pronto, **sem** `listen`. Middlewares na ordem: `express.json({ limit: '100kb' })` — **mas** o router de webhooks (Task Webhook) monta ANTES com seu próprio parser; aqui só o global. `helmet(...)`, `pino-http({ level: config.LOG_LEVEL, redact: ['req.body.senha','req.headers.cookie'] })`, `app.set('trust proxy', 1)`, injeta `req.io = io`. Depois as rotas (adicionadas nas tasks seguintes — nesta task só `saude`). Por fim `app.use((req,res)=>res.status(404).json({ erro: 'NAO_ENCONTRADO' }))` e `app.use(errorHandler)`.
  - `saude` — `express.Router()` com `GET /healthz` → `rota(async (req,res) => { try { await query('SELECT 1'); res.json({ ok: true, db: true }); } catch { res.status(503).json({ ok: false, db: false }); } })`.
- Nota de ordem: cada task de rota subsequente **insere seu `app.use(...)` antes do 404**. O plano indica o ponto exato em cada uma. Para não reescrever `app.js` toda hora, `buildApp` monta as rotas chamando uma função `montarRotas(app)` — as tasks seguintes editam só `montarRotas`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/saude.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { fecharBanco } from '../helpers/db.js';

test.after(() => fecharBanco());

test('GET /healthz responde ok com db:true', async () => {
  const res = await request(buildApp()).get('/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, db: true });
});

test('rota inexistente => 404 NAO_ENCONTRADO', async () => {
  const res = await request(buildApp()).get('/nao-existe');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { erro: 'NAO_ENCONTRADO' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/saude.test.js`
Expected: FAIL (`src/app.js` não encontrado).

- [ ] **Step 3: Implementar `src/routes/saude.js`**

```js
// src/routes/saude.js
import express from 'express';
import { rota } from '../http/async.js';
import { query } from '../db/pool.js';

export const saude = express.Router();

saude.get('/healthz', rota(async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: true });
  } catch {
    res.status(503).json({ ok: false, db: false });
  }
}));
```

- [ ] **Step 4: Implementar `src/app.js`**

```js
// src/app.js
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config.js';
import { errorHandler } from './http/erros.js';
import { saude } from './routes/saude.js';

// As tasks seguintes de rota editam SÓ esta função (inserem app.use antes do comentário-âncora).
function montarRotas(app) {
  app.use(saude);
  // <-- ROTAS P2 (não remover esta linha)
}

export function buildApp({ io = null } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(pinoHttp({
    level: config.LOG_LEVEL,
    redact: ['req.body.senha', 'req.headers.cookie', 'req.headers.authorization'],
  }));
  app.use((req, res, next) => { req.io = io; next(); });
  app.use(helmet({ contentSecurityPolicy: false })); // CSP entra no P3 com os assets
  app.use(express.json({ limit: '100kb' }));

  montarRotas(app);

  app.use((req, res) => res.status(404).json({ erro: 'NAO_ENCONTRADO' }));
  app.use(errorHandler);
  return app;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/saude.test.js`
Expected: PASS (2 testes).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add src/app.js src/routes/saude.js test/http/saude.test.js
git commit -m "feat(p2): buildApp() + GET /healthz + 404/errorHandler

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B7: `src/auth/senha.js` + refactor do seed

**Files:**
- Create: `src/auth/senha.js`
- Modify: `src/db/seed.js`
- Test: `test/auth/senha.test.js`

**Interfaces:**
- Consumes: `bcrypt`.
- Produces: `hashSenha(texto) => Promise<string>` (bcrypt cost 12); `verificarSenha(texto, hash) => Promise<boolean>` (`bcrypt.compare`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/auth/senha.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSenha, verificarSenha } from '../../src/auth/senha.js';

test('hash e verificação batem; senha errada não', async () => {
  const h = await hashSenha('segredo123');
  assert.match(h, /^\$2[aby]\$12\$/);
  assert.equal(await verificarSenha('segredo123', h), true);
  assert.equal(await verificarSenha('outra', h), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/auth/senha.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar `src/auth/senha.js`**

```js
// src/auth/senha.js
import bcrypt from 'bcrypt';

const CUSTO = 12;

export function hashSenha(texto) {
  return bcrypt.hash(texto, CUSTO);
}

export function verificarSenha(texto, hash) {
  return bcrypt.compare(texto, hash);
}
```

- [ ] **Step 4: Refatorar `src/db/seed.js`**

Trocar `import bcrypt from 'bcrypt';` por `import { hashSenha } from '../auth/senha.js';`.
Trocar `const hash = await bcrypt.hash(config.ADMIN_SENHA, 12);` por `const hash = await hashSenha(config.ADMIN_SENHA);`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/auth/senha.test.js test/db/seed.test.js`
Expected: PASS (senha 1; seed continua igual).

- [ ] **Step 6: Commit**

```bash
git add src/auth/senha.js src/db/seed.js test/auth/senha.test.js
git commit -m "feat(p2): auth/senha (hashSenha/verificarSenha); seed usa o helper

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B8: Migração `002_session.sql`

**Files:**
- Create: `src/db/migrations/002_session.sql`
- Modify: `test/db/migrate.test.js`
- Test: `test/db/migrate.test.js`

**Interfaces:**
- Consumes: runner `migrar` do P1 (aplica `.sql` numerados em ordem, cada um numa transação).
- Produces: tabela `session` (`sid` varchar PK, `sess` jsonb NOT NULL, `expire` timestamptz(6) NOT NULL) + índice em `expire`, criada no schema corrente (sem qualificar — o `search_path` resolve).

- [ ] **Step 1: Editar o teste**

Em `test/db/migrate.test.js`, na lista `nomes` do primeiro teste, acrescentar `'session'` (o `assert.equal(r.rows.length, nomes.length)` continua igual — só cresceu a lista). Acrescentar um teste:

```js
test('002 cria a tabela session com a coluna expire indexada', async () => {
  await migrar({ silent: true });
  const col = await query(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='session' AND column_name='expire'`, [schema]);
  assert.equal(col.rows[0].data_type, 'timestamp with time zone');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/db/migrate.test.js`
Expected: FAIL (tabela `session` não existe; lista tem 15 nomes mas só 14 tabelas).

- [ ] **Step 3: Criar `src/db/migrations/002_session.sql`**

```sql
-- Tabela de sessão do connect-pg-simple (DDL padrão). Criada no schema
-- corrente via search_path — sem qualificar.
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSONB NOT NULL,
  expire TIMESTAMPTZ(6) NOT NULL
);
ALTER TABLE session
  ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS IDX_session_expire ON session (expire);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/db/migrate.test.js`
Expected: PASS (2 testes, incl. o novo).

- [ ] **Step 5: Aplicar no schema de dev**

Run: `npm run db:migrate`
Expected: "migração aplicada: 002_session.sql" (uma vez), depois "migrations em dia".

- [ ] **Step 6: Commit**

```bash
git add src/db/migrations/002_session.sql test/db/migrate.test.js
git commit -m "feat(p2): migração 002 — tabela session (connect-pg-simple)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B9: `src/auth/sessao.js` + fiação no app

**Files:**
- Create: `src/auth/sessao.js`
- Modify: `src/app.js`
- Test: `test/http/sessao.test.js`

**Interfaces:**
- Consumes: `express-session`, `connect-pg-simple`; `pool` e `schema` de `src/db/pool.js`; `config`.
- Produces: `criarSessaoMiddleware() => RequestHandler`. Store = `connect-pg-simple` com `{ pool, schemaName: schema, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: false }`. Cookie `{ httpOnly: true, sameSite: 'lax', secure: config.NODE_ENV === 'production' || config.COOKIE_SECURE === '1', maxAge: 30*24*3600*1000 }`. `secret: config.SESSION_SECRET`, `resave: false`, `saveUninitialized: false`, `rolling: true`, `name: 'barbearia.sid'`.
- `buildApp` chama `app.use(criarSessaoMiddleware())` logo após `express.json(...)` e antes de `montarRotas(app)`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/sessao.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { criarSessaoMiddleware } from '../../src/auth/sessao.js';
import { prepararBanco, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';

test.beforeEach(() => prepararBanco());
test.after(() => fecharBanco());

function appDeTeste() {
  const app = express();
  app.use(express.json());
  app.use(criarSessaoMiddleware());
  app.post('/set', (req, res) => { req.session.n = (req.session.n ?? 0) + 1; res.json({ n: req.session.n }); });
  app.get('/get', (req, res) => res.json({ n: req.session.n ?? 0 }));
  return app;
}

test('sessão persiste entre requests do mesmo agent (store em Postgres)', async () => {
  const agent = request.agent(appDeTeste());
  await agent.post('/set');
  const r2 = await agent.post('/set');
  assert.equal(r2.body.n, 2);
  const g = await agent.get('/get');
  assert.equal(g.body.n, 2);
  const row = await query('SELECT count(*)::int AS n FROM session');
  assert.ok(row.rows[0].n >= 1);
});

test('agents diferentes não compartilham sessão', async () => {
  const app = appDeTeste();
  const a = request.agent(app); const b = request.agent(app);
  await a.post('/set');
  const g = await b.get('/get');
  assert.equal(g.body.n, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/sessao.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar `src/auth/sessao.js`**

```js
// src/auth/sessao.js
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool, schema } from '../db/pool.js';
import { config } from '../config.js';

const PgStore = connectPgSimple(session);

export function criarSessaoMiddleware() {
  return session({
    name: 'barbearia.sid',
    store: new PgStore({
      pool,
      schemaName: schema,
      tableName: 'session',
      createTableIfMissing: false,
      pruneSessionInterval: false,
    }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production' || config.COOKIE_SECURE === '1',
      maxAge: 30 * 24 * 3600 * 1000,
    },
  });
}
```

- [ ] **Step 4: Fiar em `src/app.js`**

Adicionar `import { criarSessaoMiddleware } from './auth/sessao.js';` no topo. Em `buildApp`, logo após `app.use(express.json({ limit: '100kb' }));` acrescentar:

```js
  app.use(criarSessaoMiddleware());
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/sessao.test.js test/http/saude.test.js`
Expected: PASS (sessão 2; saúde 2).

- [ ] **Step 6: Commit**

```bash
git add src/auth/sessao.js src/app.js test/http/sessao.test.js
git commit -m "feat(p2): sessão em Postgres (connect-pg-simple, schema-aware) fiada no app

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B10: `src/auth/middleware.js`

**Files:**
- Create: `src/auth/middleware.js`
- Test: `test/auth/middleware.test.js`

**Interfaces:**
- Consumes: `ErroHttp` de `src/http/erros.js`.
- Produces:
  - `anexarSessaoAnonima(req,res,next)` — `req.sessionId = req.sessionID`; sempre `next()`.
  - `requireCliente` — `req.session?.clienteId` truthy → `next()`; senão `next(new ErroHttp('NAO_AUTENTICADO'))`.
  - `requireEquipe` — `req.session?.usuarioId` e `role ∈ ('admin','barbeiro')` e `Date.now() <= req.session.equipeExpiraEm` (senão `session.destroy` + erro). Falha → `NAO_AUTENTICADO`.
  - `requireAdmin` — `requireEquipe` e `req.session.role === 'admin'`; senão `SEM_PERMISSAO`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/auth/middleware.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { requireCliente, requireEquipe, requireAdmin } from '../../src/auth/middleware.js';

function rodar(mw, session) {
  return new Promise((resolve) => {
    const req = { session };
    mw(req, {}, (err) => resolve(err?.codigoHttp ?? 'OK'));
  });
}
const daqui1h = () => Date.now() + 3600_000;

test('requireCliente', async () => {
  assert.equal(await rodar(requireCliente, { clienteId: 1 }), 'OK');
  assert.equal(await rodar(requireCliente, {}), 'NAO_AUTENTICADO');
});

test('requireEquipe respeita expiração', async () => {
  assert.equal(await rodar(requireEquipe, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: daqui1h() }), 'OK');
  assert.equal(await rodar(requireEquipe, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: 1 }), 'NAO_AUTENTICADO');
  assert.equal(await rodar(requireEquipe, { clienteId: 9 }), 'NAO_AUTENTICADO');
});

test('requireAdmin', async () => {
  assert.equal(await rodar(requireAdmin, { usuarioId: 1, role: 'admin', equipeExpiraEm: daqui1h() }), 'OK');
  assert.equal(await rodar(requireAdmin, { usuarioId: 1, role: 'barbeiro', equipeExpiraEm: daqui1h() }), 'SEM_PERMISSAO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/auth/middleware.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar**

```js
// src/auth/middleware.js
import { ErroHttp } from '../http/erros.js';

export function anexarSessaoAnonima(req, res, next) {
  req.sessionId = req.sessionID;
  next();
}

export function requireCliente(req, res, next) {
  if (req.session?.clienteId) return next();
  next(new ErroHttp('NAO_AUTENTICADO'));
}

export function requireEquipe(req, res, next) {
  const s = req.session;
  const ok = s?.usuarioId && (s.role === 'admin' || s.role === 'barbeiro');
  if (!ok) return next(new ErroHttp('NAO_AUTENTICADO'));
  if (!s.equipeExpiraEm || Date.now() > s.equipeExpiraEm) {
    s.destroy?.(() => {});
    return next(new ErroHttp('NAO_AUTENTICADO'));
  }
  next();
}

export function requireAdmin(req, res, next) {
  requireEquipe(req, res, (err) => {
    if (err) return next(err);
    if (req.session.role !== 'admin') return next(new ErroHttp('SEM_PERMISSAO'));
    next();
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/auth/middleware.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.js test/auth/middleware.test.js
git commit -m "feat(p2): middlewares requireCliente/requireEquipe/requireAdmin + sessão anônima

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B11: Repos de auth + `src/auth/rateLimit.js`

**Files:**
- Create: `src/repos/usuarios.js`, `src/repos/clientes.js`, `src/repos/logs.js`, `src/auth/rateLimit.js`
- Test: `test/repos/auth-repos.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`; `express-rate-limit`; `ErroHttp`.
- Produces:
  - `usuarios.porEmail(email) => Promise<{ id, nome, email, senha_hash, role, ativo } | null>`.
  - `clientes.porCelular(celular) => Promise<{ id, nome, celular, email, senha_hash, celular_verificado } | null>`.
  - `clientes.criar({ nome, celular, email = null, senha_hash = null }) => Promise<{ id, nome }>`.
  - `logs.registrar({ quem_tipo, quem_id = null, acao, ip = null, detalhe = null }) => Promise<void>` — `INSERT INTO logs_acesso`.
  - `limiteLogin` — `rateLimit({ windowMs: 15*60_000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: (req) => `${req.ip}:${req.body?.email ?? req.body?.celular ?? ''}`, handler: (req,res,next) => next(new ErroHttp('MUITAS_TENTATIVAS')) })`.
  - `limiteMensagens` — `rateLimit({ windowMs: 5*60_000, limit: 30, keyGenerator: (req) => req.ip, handler: … 'MUITAS_TENTATIVAS' })`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/repos/auth-repos.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import * as usuarios from '../../src/repos/usuarios.js';
import * as clientes from '../../src/repos/clientes.js';
import * as logs from '../../src/repos/logs.js';
import { query } from '../../src/db/pool.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('usuarios.porEmail acha o admin semeado', async () => {
  const u = await usuarios.porEmail('dono@teste.local');
  assert.equal(u.role, 'admin');
  assert.ok(u.senha_hash);
  assert.equal(await usuarios.porEmail('ninguem@x.com'), null);
});

test('clientes.criar + porCelular', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5528999990000' });
  assert.ok(c.id);
  const achado = await clientes.porCelular('5528999990000');
  assert.equal(achado.nome, 'Ana');
  assert.equal(achado.senha_hash, null);
});

test('logs.registrar insere linha', async () => {
  await logs.registrar({ quem_tipo: 'usuario', quem_id: 1, acao: 'login_ok', ip: '1.2.3.4' });
  const r = await query(`SELECT acao FROM logs_acesso WHERE quem_id=1`);
  assert.equal(r.rows[0].acao, 'login_ok');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/repos/auth-repos.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/repos/usuarios.js`**

```js
// src/repos/usuarios.js
import { query } from '../db/pool.js';

export async function porEmail(email) {
  const r = await query(
    `SELECT id, nome, email, senha_hash, role, ativo FROM usuarios WHERE email=$1`, [email]);
  return r.rows[0] ?? null;
}
```

- [ ] **Step 4: Implementar `src/repos/clientes.js`**

```js
// src/repos/clientes.js
import { query } from '../db/pool.js';

export async function porCelular(celular) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE celular=$1`, [celular]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, celular, email = null, senha_hash = null }) {
  const r = await query(
    `INSERT INTO clientes (nome, celular, email, senha_hash)
     VALUES ($1,$2,$3,$4) RETURNING id, nome`,
    [nome, celular, email, senha_hash]);
  return r.rows[0];
}
```

- [ ] **Step 5: Implementar `src/repos/logs.js`**

```js
// src/repos/logs.js
import { query } from '../db/pool.js';

export async function registrar({ quem_tipo, quem_id = null, acao, ip = null, detalhe = null }) {
  await query(
    `INSERT INTO logs_acesso (quem_tipo, quem_id, acao, ip, detalhe)
     VALUES ($1,$2,$3,$4,$5)`,
    [quem_tipo, quem_id, acao, ip, detalhe]);
}
```

- [ ] **Step 6: Implementar `src/auth/rateLimit.js`**

```js
// src/auth/rateLimit.js
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { ErroHttp } from '../http/erros.js';

const bloqueio = (req, res, next) => next(new ErroHttp('MUITAS_TENTATIVAS'));

// Stores exportados para os testes zerarem entre casos (rate-limit é global do módulo).
export const storeLogin = new MemoryStore();
export const storeMensagens = new MemoryStore();

export function resetRateLimit() {
  storeLogin.resetAll?.();
  storeMensagens.resetAll?.();
}

export const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  store: storeLogin,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.email ?? req.body?.celular ?? ''}`,
  handler: bloqueio,
});

export const limiteMensagens = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  store: storeMensagens,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});
```

> `MemoryStore` de `express-rate-limit` v7 tem `resetAll()`. Todo teste HTTP que
> não exercita o limite deve chamar `resetRateLimit()` no `beforeEach` (importar de
> `src/auth/rateLimit.js`) para não herdar contadores de outro caso do mesmo arquivo.

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test -- test/repos/auth-repos.test.js`
Expected: PASS (3 testes).

- [ ] **Step 8: Commit**

```bash
git add src/repos/usuarios.js src/repos/clientes.js src/repos/logs.js src/auth/rateLimit.js test/repos/auth-repos.test.js
git commit -m "feat(p2): repos usuarios/clientes/logs + limitadores de rate

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B12: `src/routes/auth.js` — login / logout

**Files:**
- Create: `src/routes/auth.js`
- Modify: `src/app.js` (`montarRotas`: `app.use('/api/auth', anexarSessaoAnonima, exigirOrigemConfiavel, auth)` antes da linha-âncora)
- Test: `test/http/auth.test.js`

**Interfaces:**
- Consumes: `express`, `zod`; `rota`, `ErroHttp`; `validarCorpo`; `verificarSenha`; `usuarios.porEmail`, `clientes.porCelular`; `logs.registrar`; `limiteLogin`; `normalizarCelular`.
- Produces: `auth` (`express.Router()`):
  - `POST /admin/login` `{ email, senha }` → em sucesso `req.session.usuarioId = u.id; req.session.role = u.role; req.session.equipeExpiraEm = Date.now()+12*3600_000; delete req.session.clienteId;` responde `200 { usuario: { id, nome, role } }`. Falha (sem usuário, inativo, senha errada) → `logs.registrar('login_falha')` + `next(new ErroHttp('CREDENCIAIS_INVALIDAS'))`. Sucesso → `logs.registrar('login_ok')`.
  - `POST /cliente/login` `{ celular, senha }` → `normalizarCelular`; `clientes.porCelular`; se não tem `senha_hash` → `CREDENCIAIS_INVALIDAS` (esse cliente não usa senha); `verificarSenha`; sucesso → `req.session.clienteId = c.id; delete req.session.usuarioId; delete req.session.role;` `200 { cliente: { id, nome } }`.
  - `POST /logout` → `req.session.destroy(() => res.status(204).end())`.
  - Ambos `/*/login` usam `limiteLogin` antes do `validarCorpo`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/auth.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); resetRateLimit(); });

test('admin login ok abre sessão de equipe e grava log', async () => {
  const agent = request.agent(buildApp());
  const res = await agent.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  assert.equal(res.status, 200);
  assert.equal(res.body.usuario.role, 'admin');
  const log = await query(`SELECT acao FROM logs_acesso ORDER BY id DESC LIMIT 1`);
  assert.equal(log.rows[0].acao, 'login_ok');
});

test('admin login com senha errada => 401 e log de falha', async () => {
  const res = await request(buildApp()).post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'errada' });
  assert.equal(res.status, 401);
  assert.equal(res.body.erro, 'CREDENCIAIS_INVALIDAS');
  const log = await query(`SELECT acao FROM logs_acesso ORDER BY id DESC LIMIT 1`);
  assert.equal(log.rows[0].acao, 'login_falha');
});

test('rate limit dispara na 6ª tentativa', async () => {
  const app = buildApp();
  for (let i = 0; i < 5; i++) {
    await request(app).post('/api/auth/admin/login').set('Origin', ORIGIN)
      .send({ email: 'dono@teste.local', senha: 'errada' });
  }
  const res = await request(app).post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'errada' });
  assert.equal(res.status, 429);
  assert.equal(res.body.erro, 'MUITAS_TENTATIVAS');
});

test('POST sem Origin confiável => 403', async () => {
  const res = await request(buildApp()).post('/api/auth/admin/login')
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  assert.equal(res.status, 403);
});

test('logout apaga a sessão', async () => {
  const agent = request.agent(buildApp());
  await agent.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  const out = await agent.post('/api/auth/logout').set('Origin', ORIGIN);
  assert.equal(out.status, 204);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/auth.test.js`
Expected: FAIL (rota não montada).

- [ ] **Step 3: Implementar `src/routes/auth.js`**

```js
// src/routes/auth.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo } from '../http/validar.js';
import { verificarSenha } from '../auth/senha.js';
import { limiteLogin } from '../auth/rateLimit.js';
import { normalizarCelular } from '../lib/celular.js';
import * as usuarios from '../repos/usuarios.js';
import * as clientes from '../repos/clientes.js';
import * as logs from '../repos/logs.js';

export const auth = express.Router();
const DOZE_HORAS = 12 * 3600_000;

auth.post('/admin/login', limiteLogin,
  validarCorpo(z.object({ email: z.string().email(), senha: z.string().min(1) })),
  rota(async (req, res, next) => {
    const u = await usuarios.porEmail(req.body.email);
    const ok = u && u.ativo && await verificarSenha(req.body.senha, u.senha_hash);
    if (!ok) {
      await logs.registrar({ quem_tipo: 'usuario', quem_id: u?.id ?? null, acao: 'login_falha', ip: req.ip });
      return next(new ErroHttp('CREDENCIAIS_INVALIDAS'));
    }
    req.session.usuarioId = u.id;
    req.session.role = u.role;
    req.session.equipeExpiraEm = Date.now() + DOZE_HORAS;
    delete req.session.clienteId;
    await logs.registrar({ quem_tipo: 'usuario', quem_id: u.id, acao: 'login_ok', ip: req.ip });
    res.json({ usuario: { id: u.id, nome: u.nome, role: u.role } });
  }));

auth.post('/cliente/login', limiteLogin,
  validarCorpo(z.object({ celular: z.string().min(1), senha: z.string().min(1) })),
  rota(async (req, res, next) => {
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { return next(new ErroHttp('CREDENCIAIS_INVALIDAS')); }
    const c = await clientes.porCelular(celular);
    const ok = c && c.senha_hash && await verificarSenha(req.body.senha, c.senha_hash);
    if (!ok) {
      await logs.registrar({ quem_tipo: 'cliente', quem_id: c?.id ?? null, acao: 'login_falha', ip: req.ip });
      return next(new ErroHttp('CREDENCIAIS_INVALIDAS'));
    }
    req.session.clienteId = c.id;
    delete req.session.usuarioId;
    delete req.session.role;
    delete req.session.equipeExpiraEm;
    await logs.registrar({ quem_tipo: 'cliente', quem_id: c.id, acao: 'login_ok', ip: req.ip });
    res.json({ cliente: { id: c.id, nome: c.nome } });
  }));

auth.post('/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});
```

- [ ] **Step 4: Montar em `src/app.js`**

No topo: `import { auth } from './routes/auth.js';` e `import { anexarSessaoAnonima } from './auth/middleware.js';` e `import { exigirOrigemConfiavel } from './http/origem.js';`. Em `montarRotas`, antes da linha `// <-- ROTAS P2`:

```js
  app.use('/api/auth', anexarSessaoAnonima, exigirOrigemConfiavel, auth);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/auth.test.js`
Expected: PASS (5 testes).

- [ ] **Step 6: Rodar a suíte inteira**

Run: `npm test`
Expected: verde.

- [ ] **Step 7: Commit**

```bash
git add src/routes/auth.js src/app.js test/http/auth.test.js
git commit -m "feat(p2): rotas /api/auth (admin/login, cliente/login, logout) com rate-limit e logs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task C13: `src/realtime/eventos.js` + `src/realtime/emitir.js`

**Files:**
- Create: `src/realtime/eventos.js`, `src/realtime/emitir.js`
- Test: `test/realtime/emitir.test.js`

**Interfaces:**
- Consumes: nada (recebe um `io`-like com `.to(sala).emit(evento, payload)`).
- Produces:
  - `EVENTOS = { HORARIO_RESERVADO, HORARIO_LIBERADO, AGENDA_ATUALIZADA, NOVO_AGENDAMENTO, AGENDAMENTO_ATUALIZADO, DASHBOARD_TICK }` (valores string).
  - `emitirHorarioReservado(io, { data, horario })` → `io.to('agenda:'+data).emit(EVENTOS.HORARIO_RESERVADO, { data, horario })`.
  - `emitirHorarioLiberado(io, { data, horario })` → sala `agenda:<data>`, `HORARIO_LIBERADO`.
  - `emitirAgendaAtualizada(io, { data })` → sala `agenda:<data>`, `AGENDA_ATUALIZADA`, `{ data }`.
  - `emitirNovoAgendamento(io, ag)` → sala `admin`, `NOVO_AGENDAMENTO`, `{ id, cliente, servico, data, horario, status }` (campos vindos de `ag`).
  - `emitirAgendamentoAtualizado(io, { id, status })` → sala `admin`, `AGENDAMENTO_ATUALIZADO`, `{ id, status }`.
  - `emitirDashboardTick(io, contadores)` → sala `admin`, `DASHBOARD_TICK`, `contadores`.
  - Todas fazem **no-op** se `io` for falsy (rotas em teste sem io).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/realtime/emitir.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENTOS, emitirHorarioReservado, emitirAgendaAtualizada, emitirNovoAgendamento } from '../../src/realtime/emitir.js';

function ioFake() {
  const chamadas = [];
  return {
    chamadas,
    to(sala) { return { emit: (ev, payload) => chamadas.push({ sala, ev, payload }) }; },
  };
}

test('emitirHorarioReservado vai para a sala da data', () => {
  const io = ioFake();
  emitirHorarioReservado(io, { data: '2026-09-10', horario: '09:00' });
  assert.deepEqual(io.chamadas[0], { sala: 'agenda:2026-09-10', ev: EVENTOS.HORARIO_RESERVADO, payload: { data: '2026-09-10', horario: '09:00' } });
});

test('emitirNovoAgendamento vai para admin com os campos certos', () => {
  const io = ioFake();
  emitirNovoAgendamento(io, { id: 7, cliente: 'Ana', servico: 'Corte', data: '2026-09-10', horario: '09:00', status: 'pendente', extra: 'ignora' });
  assert.equal(io.chamadas[0].sala, 'admin');
  assert.deepEqual(io.chamadas[0].payload, { id: 7, cliente: 'Ana', servico: 'Corte', data: '2026-09-10', horario: '09:00', status: 'pendente' });
});

test('io falsy => no-op', () => {
  assert.doesNotThrow(() => emitirAgendaAtualizada(null, { data: '2026-09-10' }));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/realtime/emitir.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/realtime/eventos.js`**

```js
// src/realtime/eventos.js
export const EVENTOS = {
  HORARIO_RESERVADO: 'horario_reservado',
  HORARIO_LIBERADO: 'horario_liberado',
  AGENDA_ATUALIZADA: 'agenda_atualizada',
  NOVO_AGENDAMENTO: 'novo_agendamento',
  AGENDAMENTO_ATUALIZADO: 'agendamento_atualizado',
  DASHBOARD_TICK: 'dashboard_tick',
};
```

- [ ] **Step 4: Implementar `src/realtime/emitir.js`**

```js
// src/realtime/emitir.js
import { EVENTOS } from './eventos.js';

export { EVENTOS };

const salaAgenda = (data) => `agenda:${data}`;

export function emitirHorarioReservado(io, { data, horario }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.HORARIO_RESERVADO, { data, horario });
}

export function emitirHorarioLiberado(io, { data, horario }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.HORARIO_LIBERADO, { data, horario });
}

export function emitirAgendaAtualizada(io, { data }) {
  if (!io) return;
  io.to(salaAgenda(data)).emit(EVENTOS.AGENDA_ATUALIZADA, { data });
}

export function emitirNovoAgendamento(io, ag) {
  if (!io) return;
  const { id, cliente, servico, data, horario, status } = ag;
  io.to('admin').emit(EVENTOS.NOVO_AGENDAMENTO, { id, cliente, servico, data, horario, status });
}

export function emitirAgendamentoAtualizado(io, { id, status }) {
  if (!io) return;
  io.to('admin').emit(EVENTOS.AGENDAMENTO_ATUALIZADO, { id, status });
}

export function emitirDashboardTick(io, contadores) {
  if (!io) return;
  io.to('admin').emit(EVENTOS.DASHBOARD_TICK, contadores);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/realtime/emitir.test.js`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add src/realtime/eventos.js src/realtime/emitir.js test/realtime/emitir.test.js
git commit -m "feat(p2): realtime/eventos + emitir* (no-op sem io)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task C14: `src/realtime/io.js` — Socket.io com salas por sessão

**Files:**
- Create: `src/realtime/io.js`
- Test: `test/realtime/io.test.js`

**Interfaces:**
- Consumes: `socket.io` (`Server`); `ehData` de `src/lib/datas.js`.
- Produces:
  - `criarIo(httpServer, sessaoMw) => io` — `new Server(httpServer, { transports: ['websocket','polling'] })`; `io.engine.use(sessaoMw)`; em `connection`: se `socket.request.session?.usuarioId` e `role ∈ ('admin','barbeiro')` → `socket.join('admin')`. Handlers: `socket.on('entrar_agenda', ({ data }) => { if (!ehData(data)) return; for (const s of socket.rooms) if (s.startsWith('agenda:')) socket.leave(s); socket.join('agenda:'+data); })`; `socket.on('sair_agenda', () => { for (const s of socket.rooms) if (s.startsWith('agenda:')) socket.leave(s); })`. Guarda `io` num módulo-singleton.
  - `getIo() => io | null`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/realtime/io.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as Client } from 'socket.io-client';
import { criarIo } from '../../src/realtime/io.js';
import { EVENTOS } from '../../src/realtime/emitir.js';

function esperar(socket, ev) {
  return new Promise((resolve) => socket.once(ev, resolve));
}

test('cliente entra na sala da data e recebe agenda_atualizada', async () => {
  const server = http.createServer();
  const io = criarIo(server, (req, res, next) => next()); // sem sessão
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;
  const cli = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => cli.on('connect', r));
  cli.emit('entrar_agenda', { data: '2026-09-10' });
  await new Promise((r) => setTimeout(r, 50));

  const recebido = esperar(cli, EVENTOS.AGENDA_ATUALIZADA);
  io.to('agenda:2026-09-10').emit(EVENTOS.AGENDA_ATUALIZADA, { data: '2026-09-10' });
  assert.deepEqual(await recebido, { data: '2026-09-10' });

  cli.close();
  io.close();
  await new Promise((r) => server.close(r));
});

test('socket sem sessão de equipe não entra em admin', async () => {
  const server = http.createServer();
  const io = criarIo(server, (req, res, next) => next());
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;
  const cli = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => cli.on('connect', r));
  await new Promise((r) => setTimeout(r, 50));
  const sockets = await io.in('admin').fetchSockets();
  assert.equal(sockets.length, 0);
  cli.close(); io.close();
  await new Promise((r) => server.close(r));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/realtime/io.test.js`
Expected: FAIL (módulo não encontrado).

- [ ] **Step 3: Implementar**

```js
// src/realtime/io.js
import { Server } from 'socket.io';
import { ehData } from '../lib/datas.js';

let ioSingleton = null;

export function criarIo(httpServer, sessaoMw) {
  const io = new Server(httpServer, { transports: ['websocket', 'polling'] });
  io.engine.use(sessaoMw);

  io.on('connection', (socket) => {
    const s = socket.request.session;
    if (s?.usuarioId && (s.role === 'admin' || s.role === 'barbeiro')) socket.join('admin');

    const sairDaAgenda = () => {
      for (const sala of socket.rooms) if (sala.startsWith('agenda:')) socket.leave(sala);
    };
    socket.on('entrar_agenda', ({ data } = {}) => {
      if (!ehData(data)) return;
      sairDaAgenda();
      socket.join(`agenda:${data}`);
    });
    socket.on('sair_agenda', sairDaAgenda);
  });

  ioSingleton = io;
  return io;
}

export function getIo() {
  return ioSingleton;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/realtime/io.test.js`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/realtime/io.js test/realtime/io.test.js
git commit -m "feat(p2): criarIo — Socket.io com salas agenda:<data> e admin via sessão

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task H15: `src/services/whatsapp.js` + `src/services/mensageiro.js`

**Files:**
- Create: `src/services/whatsapp.js`, `src/services/mensageiro.js`
- Test: `test/services/whatsapp.test.js`, `test/services/mensageiro.test.js`

**Interfaces:**
- Consumes: `config`; `withTransaction`/`query` de `src/db/pool.js`.
- Produces:
  - `whatsapp.enviar(row) => Promise<{ status, wamid?, erro? }>` — `row` tem `{ id, telefone_destino, mensagem_final }`. Sem `config.WHATSAPP_TOKEN` **ou** `config.WHATSAPP_PHONE_NUMBER_ID` → driver `simulado`: `{ status: 'simulado' }`. Com ambos → driver `meta`: `fetch('https://graph.facebook.com/v20.0/'+id+'/messages', { method:'POST', headers:{ Authorization:'Bearer '+token, 'content-type':'application/json' }, body: JSON.stringify({ messaging_product:'whatsapp', to: row.telefone_destino, type:'text', text:{ body: row.mensagem_final } }) })` → `2xx` → `{ status:'enviado', wamid: json.messages?.[0]?.id }`; senão `{ status:'falha', erro: <texto curto> }`.
  - `mensageiro.processarPendentes({ limite = 20 } = {}) => Promise<{ processadas, falhas }>` — `withTransaction`: `SELECT id, telefone_destino, mensagem_final FROM mensagens_whatsapp WHERE status_envio='pendente' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`; para cada, `whatsapp.enviar(row)`; `UPDATE mensagens_whatsapp SET status_envio=$2, enviado_em=CASE WHEN $2 IN ('enviado','simulado','entregue') THEN now() ELSE enviado_em END, erro=$3 WHERE id=$1`. Conta `processadas`/`falhas`.

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/services/whatsapp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { enviar } from '../../src/services/whatsapp.js';
import { config } from '../../src/config.js';

test('sem credencial => driver simulado', async () => {
  assert.equal(config.WHATSAPP_TOKEN, '');
  const r = await enviar({ id: 1, telefone_destino: '5528999990000', mensagem_final: 'oi' });
  assert.deepEqual(r, { status: 'simulado' });
});
```

```js
// test/services/mensageiro.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { processarPendentes } from '../../src/services/mensageiro.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

async function pend(n) {
  for (let i = 0; i < n; i++) {
    await query(
      `INSERT INTO mensagens_whatsapp (telefone_destino, mensagem_final, status_envio)
       VALUES ($1,$2,'pendente')`, [`552899999000${i}`, `msg ${i}`]);
  }
}

test('processarPendentes marca simulado e enviado_em', async () => {
  await pend(3);
  const r = await processarPendentes();
  assert.equal(r.processadas, 3);
  const rows = await query(`SELECT status_envio, enviado_em FROM mensagens_whatsapp`);
  assert.ok(rows.rows.every((x) => x.status_envio === 'simulado' && x.enviado_em));
});

test('dois processarPendentes paralelos não processam a mesma linha (SKIP LOCKED)', async () => {
  await pend(6);
  const [a, b] = await Promise.all([processarPendentes({ limite: 6 }), processarPendentes({ limite: 6 })]);
  assert.equal(a.processadas + b.processadas, 6);
  const restantes = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp WHERE status_envio='pendente'`);
  assert.equal(restantes.rows[0].n, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/services/whatsapp.test.js test/services/mensageiro.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/services/whatsapp.js`**

```js
// src/services/whatsapp.js
import { config } from '../config.js';

function temCredencial() {
  return Boolean(config.WHATSAPP_TOKEN && config.WHATSAPP_PHONE_NUMBER_ID);
}

export async function enviar(row) {
  if (!temCredencial()) return { status: 'simulado' };
  try {
    const resp = await fetch(
      `https://graph.facebook.com/v20.0/${config.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: row.telefone_destino,
          type: 'text',
          text: { body: row.mensagem_final },
        }),
      },
    );
    if (!resp.ok) {
      const txt = (await resp.text()).slice(0, 300);
      return { status: 'falha', erro: `HTTP ${resp.status}: ${txt}` };
    }
    const json = await resp.json();
    return { status: 'enviado', wamid: json.messages?.[0]?.id };
  } catch (e) {
    return { status: 'falha', erro: String(e.message).slice(0, 300) };
  }
}
```

- [ ] **Step 4: Implementar `src/services/mensageiro.js`**

```js
// src/services/mensageiro.js
import { withTransaction } from '../db/pool.js';
import { enviar } from './whatsapp.js';

export async function processarPendentes({ limite = 20 } = {}) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT id, telefone_destino, mensagem_final
       FROM mensagens_whatsapp
       WHERE status_envio='pendente'
       ORDER BY created_at
       LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limite],
    );
    let processadas = 0;
    let falhas = 0;
    for (const row of rows) {
      const r = await enviar(row);
      await c.query(
        `UPDATE mensagens_whatsapp
         SET status_envio=$2,
             enviado_em = CASE WHEN $2 IN ('enviado','simulado','entregue') THEN now() ELSE enviado_em END,
             erro=$3
         WHERE id=$1`,
        [row.id, r.status, r.erro ?? null],
      );
      if (r.status === 'falha') falhas++; else processadas++;
    }
    return { processadas, falhas };
  });
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/services/whatsapp.test.js test/services/mensageiro.test.js`
Expected: PASS (whatsapp 1; mensageiro 2).

- [ ] **Step 6: Commit**

```bash
git add src/services/whatsapp.js src/services/mensageiro.js test/services/whatsapp.test.js test/services/mensageiro.test.js
git commit -m "feat(p2): whatsapp.enviar (simulado/meta) + mensageiro.processarPendentes (SKIP LOCKED)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task H16: `src/services/sms.js` + `src/services/mapa.js`

**Files:**
- Create: `src/services/sms.js`, `src/services/mapa.js`
- Test: `test/services/sms.test.js`, `test/services/mapa.test.js`

**Interfaces:**
- Consumes: `config`; `query` de `src/db/pool.js`; `hashSenha`/`verificarSenha` de `src/auth/senha.js`.
- Produces:
  - `sms.enviarOtp(celular) => Promise<{ enviado: true }>` — gera código (`'000000'` no driver `simulado`, senão 6 dígitos aleatórios), `INSERT INTO otp_codigos (celular, codigo_hash, expira_em) VALUES ($1,$2, now()+interval '10 minutes')` com `codigo_hash = await hashSenha(codigo)`. Driver real (Twilio) fica só documentado — no P2 sempre `simulado` (sem `TWILIO_ACCOUNT_SID`).
  - `sms.verificarOtp(celular, codigo) => Promise<boolean>` — pega o `otp_codigos` mais recente não verificado e não expirado do celular; incrementa `tentativas`; se `tentativas > 5` → `false`; `verificarSenha(codigo, row.codigo_hash)`; em acerto `UPDATE ... SET verificado=true` e `UPDATE clientes SET celular_verificado=true WHERE celular=$1`.
  - `mapa.dadosMapa() => Promise<{ provedor, embedUrl, comoChegarUrl }>` — lê `latitude`/`longitude`/`endereco` da `configuracao`. Com `config.GOOGLE_MAPS_API_KEY` → `provedor:'google'`, `embedUrl` do Maps Embed API; senão `provedor:'osm'`, `embedUrl` do OpenStreetMap `export/embed.html`. `comoChegarUrl` = `https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` (ou por endereço se faltam coords).

- [ ] **Step 1: Escrever os testes que falham**

```js
// test/services/sms.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { enviarOtp, verificarOtp } from '../../src/services/sms.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('enviarOtp grava hash; verificarOtp aceita 000000 no driver simulado', async () => {
  await enviarOtp('5528999990000');
  const r = await query(`SELECT count(*)::int AS n FROM otp_codigos WHERE celular='5528999990000'`);
  assert.equal(r.rows[0].n, 1);
  assert.equal(await verificarOtp('5528999990000', '000000'), true);
  assert.equal(await verificarOtp('5528999990000', '111111'), false);
});
```

```js
// test/services/mapa.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { dadosMapa } from '../../src/services/mapa.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('sem GOOGLE_MAPS_API_KEY usa OSM e monta comoChegarUrl', async () => {
  await query(`UPDATE configuracao SET latitude=-20.32, longitude=-40.29, endereco='Rua X, 1' WHERE id=1`);
  const d = await dadosMapa();
  assert.equal(d.provedor, 'osm');
  assert.match(d.embedUrl, /openstreetmap/);
  assert.match(d.comoChegarUrl, /destination=-20.32,-40.29/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/services/sms.test.js test/services/mapa.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/services/sms.js`**

```js
// src/services/sms.js
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { hashSenha, verificarSenha } from '../auth/senha.js';

function driverSimulado() {
  return !config.TWILIO_ACCOUNT_SID;
}

function gerarCodigo() {
  return driverSimulado() ? '000000' : String(Math.floor(100000 + Math.random() * 900000));
}

export async function enviarOtp(celular) {
  const codigo = gerarCodigo();
  const hash = await hashSenha(codigo);
  await query(
    `INSERT INTO otp_codigos (celular, codigo_hash, expira_em)
     VALUES ($1, $2, now() + interval '10 minutes')`,
    [celular, hash],
  );
  // driver real (Twilio Verify) fica p/ pós-P4; no P2 o código simulado é 000000.
  return { enviado: true };
}

export async function verificarOtp(celular, codigo) {
  const { rows } = await query(
    `SELECT id, codigo_hash, tentativas FROM otp_codigos
     WHERE celular=$1 AND verificado=false AND expira_em > now()
     ORDER BY id DESC LIMIT 1`,
    [celular],
  );
  const row = rows[0];
  if (!row) return false;
  await query(`UPDATE otp_codigos SET tentativas = tentativas + 1 WHERE id=$1`, [row.id]);
  if (row.tentativas + 1 > 5) return false;
  const ok = await verificarSenha(String(codigo), row.codigo_hash);
  if (!ok) return false;
  await query(`UPDATE otp_codigos SET verificado=true WHERE id=$1`, [row.id]);
  await query(`UPDATE clientes SET celular_verificado=true WHERE celular=$1`, [celular]);
  return true;
}
```

- [ ] **Step 4: Implementar `src/services/mapa.js`**

```js
// src/services/mapa.js
import { config } from '../config.js';
import { query } from '../db/pool.js';

export async function dadosMapa() {
  const { rows } = await query(
    `SELECT latitude, longitude, endereco FROM configuracao WHERE id=1`);
  const { latitude, longitude, endereco } = rows[0] ?? {};
  const temCoords = latitude != null && longitude != null;

  const destino = temCoords
    ? `${latitude},${longitude}`
    : encodeURIComponent(endereco ?? '');
  const comoChegarUrl = `https://www.google.com/maps/dir/?api=1&destination=${destino}`;

  if (config.GOOGLE_MAPS_API_KEY) {
    const q = temCoords ? `${latitude},${longitude}` : encodeURIComponent(endereco ?? '');
    return {
      provedor: 'google',
      embedUrl: `https://www.google.com/maps/embed/v1/place?key=${config.GOOGLE_MAPS_API_KEY}&q=${q}`,
      comoChegarUrl,
    };
  }
  const bbox = temCoords
    ? `${Number(longitude) - 0.01},${Number(latitude) - 0.01},${Number(longitude) + 0.01},${Number(latitude) + 0.01}`
    : '-180,-85,180,85';
  const marker = temCoords ? `&marker=${latitude},${longitude}` : '';
  return {
    provedor: 'osm',
    embedUrl: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik${marker}`,
    comoChegarUrl,
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/services/sms.test.js test/services/mapa.test.js`
Expected: PASS (sms 1; mapa 1).

- [ ] **Step 6: Commit**

```bash
git add src/services/sms.js src/services/mapa.js test/services/sms.test.js test/services/mapa.test.js
git commit -m "feat(p2): sms.enviarOtp/verificarOtp (stub) + mapa.dadosMapa (google/osm)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task D17: Repos `servicos`, `configuracao`, `disponibilidadeMeses`, `bloqueios`

**Files:**
- Create: `src/repos/servicos.js`, `src/repos/configuracao.js`, `src/repos/disponibilidadeMeses.js`, `src/repos/bloqueios.js`
- Test: `test/repos/dados-repos.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`.
- Produces:
  - `servicos.ativos() => Promise<[{ id, nome, duracao_minutos, preco }]>` (`WHERE ativo ORDER BY nome`).
  - `servicos.todos() => Promise<[...]>` (inclui inativos, todos os campos).
  - `servicos.porId(id) => Promise<row | null>`.
  - `servicos.criar({ nome, duracao_minutos, preco, comissao_percentual }) => Promise<row>`.
  - `servicos.atualizar(id, campos) => Promise<row | null>` — `campos` ⊆ `{ nome, duracao_minutos, preco, comissao_percentual, ativo }`; UPDATE dinâmico só das chaves presentes; `RETURNING *`.
  - `servicos.remover(id) => Promise<'hard' | 'soft'>` — se `EXISTS (SELECT 1 FROM agendamentos WHERE servico_id=id)` → `UPDATE ativo=false` e retorna `'soft'`; senão `DELETE` e `'hard'`.
  - `configuracao.obter() => Promise<{ ...configuracao (id=1), expediente: [{ dia_semana, aberto, abre, fecha }] }>`.
  - `configuracao.atualizar(campos, expediente?) => Promise<obter()>` — UPDATE dinâmico da linha 1 (campos ⊆ colunas de `configuracao` exceto `id`); se `expediente` (array de 7) → `UPDATE horario_funcionamento` por `dia_semana`.
  - `disponibilidadeMeses.doAno(ano, barbeiroId = null) => Promise<[{ mes, status, limite_por_dia }]>` — 12 linhas, default `{ status:'fechado', limite_por_dia:null }` para meses sem registro; usa a linha global ou do barbeiro (barbeiro vence).
  - `disponibilidadeMeses.definir({ ano, mes, status, limite_por_dia = null, barbeiro_id = null }) => Promise<row>` — `INSERT ... ON CONFLICT (ano, mes, barbeiro_id) DO UPDATE SET status=EXCLUDED.status, limite_por_dia=EXCLUDED.limite_por_dia`.
  - `bloqueios.entre(de, ate, barbeiroId = null) => Promise<[row]>`.
  - `bloqueios.criar({ data, hora_inicio = null, hora_fim = null, motivo = null, barbeiro_id = null, criado_por = null }) => Promise<row>`.
  - `bloqueios.remover(id) => Promise<boolean>` (rowCount>0).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/repos/dados-repos.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as servicos from '../../src/repos/servicos.js';
import * as configuracao from '../../src/repos/configuracao.js';
import * as meses from '../../src/repos/disponibilidadeMeses.js';
import * as bloqueios from '../../src/repos/bloqueios.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('servicos: ativos, criar, atualizar, remover soft x hard', async () => {
  assert.equal((await servicos.ativos()).length, 3);
  const novo = await servicos.criar({ nome: 'Sobrancelha', duracao_minutos: 20, preco: 15, comissao_percentual: 40 });
  assert.ok(novo.id);
  const upd = await servicos.atualizar(novo.id, { preco: 18, ativo: false });
  assert.equal(Number(upd.preco), 18);
  assert.equal(await servicos.remover(novo.id), 'hard'); // nunca usado

  const corte = (await servicos.todos()).find((s) => s.nome === 'Corte');
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('C','1') RETURNING id`)).rows[0].id;
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','concluido',10)`, [cli, corte.id, b]);
  assert.equal(await servicos.remover(corte.id), 'soft');
});

test('configuracao.obter/atualizar mexe na linha 1 e no expediente', async () => {
  const c0 = await configuracao.obter();
  assert.equal(c0.expediente.length, 7);
  const c1 = await configuracao.atualizar({ nome_barbearia: 'Nova', intervalo_minutos: 40 },
    c0.expediente.map((e) => e.dia_semana === 1 ? { ...e, abre: '10:00' } : e));
  assert.equal(c1.nome_barbearia, 'Nova');
  assert.equal(c1.intervalo_minutos, 40);
  assert.equal(c1.expediente.find((e) => e.dia_semana === 1).abre, '10:00:00');
});

test('meses.doAno tem 12 linhas; definir faz upsert', async () => {
  const l = await meses.doAno(2026);
  assert.equal(l.length, 12);
  assert.ok(l.every((m) => m.status === 'fechado'));
  await meses.definir({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 8 });
  await meses.definir({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 10 }); // upsert
  const l2 = await meses.doAno(2026);
  assert.equal(l2.find((m) => m.mes === 9).limite_por_dia, 10);
});

test('bloqueios: criar, listar entre, remover', async () => {
  const b = await bloqueios.criar({ data: '2026-09-10', motivo: 'feriado' });
  assert.ok(b.id);
  assert.equal((await bloqueios.entre('2026-09-01', '2026-09-30')).length, 1);
  assert.equal(await bloqueios.remover(b.id), true);
  assert.equal((await bloqueios.entre('2026-09-01', '2026-09-30')).length, 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/repos/dados-repos.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/repos/servicos.js`**

```js
// src/repos/servicos.js
import { query } from '../db/pool.js';

const COLS = ['nome', 'duracao_minutos', 'preco', 'comissao_percentual', 'ativo'];

export async function ativos() {
  const r = await query(
    `SELECT id, nome, duracao_minutos, preco FROM servicos WHERE ativo ORDER BY nome`);
  return r.rows;
}

export async function todos() {
  const r = await query(
    `SELECT id, nome, duracao_minutos, preco, comissao_percentual, ativo FROM servicos ORDER BY nome`);
  return r.rows;
}

export async function porId(id) {
  const r = await query(`SELECT * FROM servicos WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, duracao_minutos, preco, comissao_percentual }) {
  const r = await query(
    `INSERT INTO servicos (nome, duracao_minutos, preco, comissao_percentual)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [nome, duracao_minutos, preco, comissao_percentual]);
  return r.rows[0];
}

export async function atualizar(id, campos) {
  const entradas = Object.entries(campos).filter(([k]) => COLS.includes(k));
  if (entradas.length === 0) return porId(id);
  const set = entradas.map(([k], i) => `${k}=$${i + 2}`).join(', ');
  const r = await query(
    `UPDATE servicos SET ${set} WHERE id=$1 RETURNING *`,
    [id, ...entradas.map(([, v]) => v)]);
  return r.rows[0] ?? null;
}

export async function remover(id) {
  const usado = await query(`SELECT 1 FROM agendamentos WHERE servico_id=$1 LIMIT 1`, [id]);
  if (usado.rowCount > 0) {
    await query(`UPDATE servicos SET ativo=false WHERE id=$1`, [id]);
    return 'soft';
  }
  await query(`DELETE FROM servicos WHERE id=$1`, [id]);
  return 'hard';
}
```

- [ ] **Step 4: Implementar `src/repos/configuracao.js`**

```js
// src/repos/configuracao.js
import { query } from '../db/pool.js';

const COLS = ['nome_barbearia', 'endereco', 'latitude', 'longitude', 'telefone_whatsapp',
  'intervalo_minutos', 'antecedencia_min_horas', 'limite_dias_futuros', 'barbeiro_padrao_id'];

export async function obter() {
  const cfg = await query(`SELECT * FROM configuracao WHERE id=1`);
  const exp = await query(
    `SELECT dia_semana, aberto, to_char(abre,'HH24:MI:SS') AS abre, to_char(fecha,'HH24:MI:SS') AS fecha
     FROM horario_funcionamento ORDER BY dia_semana`);
  return { ...cfg.rows[0], expediente: exp.rows };
}

export async function atualizar(campos, expediente) {
  const entradas = Object.entries(campos ?? {}).filter(([k]) => COLS.includes(k));
  if (entradas.length > 0) {
    const set = entradas.map(([k], i) => `${k}=$${i + 1}`).join(', ');
    await query(`UPDATE configuracao SET ${set}, updated_at=now() WHERE id=1`,
      entradas.map(([, v]) => v));
  }
  if (Array.isArray(expediente)) {
    for (const e of expediente) {
      await query(
        `UPDATE horario_funcionamento SET aberto=$2, abre=$3, fecha=$4 WHERE dia_semana=$1`,
        [e.dia_semana, e.aberto, e.abre, e.fecha]);
    }
  }
  return obter();
}
```

- [ ] **Step 5: Implementar `src/repos/disponibilidadeMeses.js`**

```js
// src/repos/disponibilidadeMeses.js
import { query } from '../db/pool.js';

export async function doAno(ano, barbeiroId = null) {
  const { rows } = await query(
    `SELECT DISTINCT ON (mes) mes, status, limite_por_dia
     FROM agenda_disponibilidade
     WHERE ano=$1 AND (barbeiro_id IS NULL OR barbeiro_id=$2)
     ORDER BY mes, barbeiro_id NULLS LAST`,
    [ano, barbeiroId]);
  const porMes = new Map(rows.map((r) => [r.mes, r]));
  return Array.from({ length: 12 }, (_, i) => porMes.get(i + 1) ?? { mes: i + 1, status: 'fechado', limite_por_dia: null });
}

export async function definir({ ano, mes, status, limite_por_dia = null, barbeiro_id = null }) {
  const r = await query(
    `INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status, limite_por_dia)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (ano, mes, barbeiro_id) DO UPDATE
       SET status=EXCLUDED.status, limite_por_dia=EXCLUDED.limite_por_dia
     RETURNING *`,
    [ano, mes, barbeiro_id, status, limite_por_dia]);
  return r.rows[0];
}
```

- [ ] **Step 6: Implementar `src/repos/bloqueios.js`**

```js
// src/repos/bloqueios.js
import { query } from '../db/pool.js';

export async function entre(de, ate, barbeiroId = null) {
  const r = await query(
    `SELECT id, barbeiro_id, data,
            to_char(hora_inicio,'HH24:MI') AS hora_inicio,
            to_char(hora_fim,'HH24:MI') AS hora_fim, motivo
     FROM bloqueios_agenda
     WHERE data BETWEEN $1 AND $2 AND (barbeiro_id IS NULL OR barbeiro_id=$3)
     ORDER BY data`,
    [de, ate, barbeiroId]);
  return r.rows;
}

export async function criar({ data, hora_inicio = null, hora_fim = null, motivo = null, barbeiro_id = null, criado_por = null }) {
  const r = await query(
    `INSERT INTO bloqueios_agenda (barbeiro_id, data, hora_inicio, hora_fim, motivo, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [barbeiro_id, data, hora_inicio, hora_fim, motivo, criado_por]);
  return r.rows[0];
}

export async function remover(id) {
  const r = await query(`DELETE FROM bloqueios_agenda WHERE id=$1`, [id]);
  return r.rowCount > 0;
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test -- test/repos/dados-repos.test.js`
Expected: PASS (4 testes).

- [ ] **Step 8: Commit**

```bash
git add src/repos/servicos.js src/repos/configuracao.js src/repos/disponibilidadeMeses.js src/repos/bloqueios.js test/repos/dados-repos.test.js
git commit -m "feat(p2): repos servicos/configuracao/disponibilidadeMeses/bloqueios

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task D18: Repo `agendamentos` (listagem, dashboard, comissões, templates, mensagens)

**Files:**
- Create: `src/repos/agendamentos.js`, `src/repos/comissoes.js`, `src/repos/templates.js`, `src/repos/mensagens.js`
- Test: `test/repos/agendamentos-repo.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`; `datas` de `src/lib/datas.js`.
- Produces:
  - `agendamentos.listar({ de, ate, status, cliente, page = 1, tamanho = 20 }) => Promise<{ itens, total, page }>` — join `clientes`+`servicos`+`usuarios`; filtros opcionais (`data BETWEEN`, `status=`, `clientes.nome ILIKE '%'||$||'%' OR clientes.celular LIKE ...`); `ORDER BY data_agendamento DESC, horario_inicio DESC`; `LIMIT/OFFSET`. `itens[i]` = `{ id, data_agendamento, horario_inicio, horario_fim, status, valor_total, comissao_valor, observacoes, cliente:{ id, nome, celular }, servico:{ id, nome, preco }, barbeiro:{ id, nome } }`.
  - `agendamentos.doCliente(clienteId, quando) => Promise<[item]>` — `quando ∈ 'futuros'|'historico'`; `futuros` = `data_agendamento >= hoje() AND status IN ('pendente','confirmado')` ordenado asc; `historico` = o resto desc.
  - `agendamentos.porId(id) => Promise<item | null>`.
  - `agendamentos.dashboard() => Promise<{ hoje: [item], contadores: { cortes_hoje, agendamentos_mes, faturamento_mes, comissao_mes } }>` — `hoje` = ativos de `hoje()`; `mes` = mês corrente; `faturamento_mes`/`comissao_mes` somam `status='concluido'`.
  - `agendamentos.concluir(id) => Promise<item | null>` — `UPDATE status='concluido', updated_at=now() WHERE id=$1 AND status IN ('pendente','confirmado') RETURNING *` → recarrega via `porId`.
  - `agendamentos.confirmarStatus(id) => Promise<item | null>` — idem para `status='confirmado'`.
  - `comissoes.relatorio({ ano, mes, barbeiroId = null }) => Promise<{ linhas: [{ servico, qtd, faturamento, percentual, comissao }], total: { qtd, faturamento, comissao } }>` — base `status='concluido'` e mês/ano de `data_agendamento`; agrupado por serviço.
  - `templates.todos() => Promise<[{ chave, titulo, corpo, ativo }]>`; `templates.porChave(chave)`; `templates.atualizar(chave, { titulo, corpo, ativo }) => Promise<row | null>`.
  - `mensagens.listar({ agendamento_id, status, page = 1, tamanho = 20 }) => Promise<{ itens, total, page }>`; `mensagens.enfileirar({ agendamento_id, template_chave, telefone_destino, mensagem_final }) => Promise<row>` (`status_envio='pendente'`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/repos/agendamentos-repo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as ag from '../../src/repos/agendamentos.js';
import * as comissoes from '../../src/repos/comissoes.js';
import * as templates from '../../src/repos/templates.js';
import { hoje } from '../../src/lib/datas.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

async function base() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, preco, comissao_percentual FROM servicos WHERE nome='Corte'`)).rows[0];
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5511') RETURNING id`)).rows[0].id;
  return { b, s, cli };
}
async function criar(b, s, cli, data, hora, status) {
  await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento,
    horario_inicio, horario_fim, status, valor_total, comissao_valor)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cli, s.id, b, data, hora, hora, status, s.preco, (s.preco * s.comissao_percentual / 100)]);
}

test('listar filtra por status e pagina', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, '2026-09-10', '09:00', 'pendente');
  await criar(b, s, cli, '2026-09-11', '09:00', 'cancelado');
  const r = await ag.listar({ status: 'pendente' });
  assert.equal(r.total, 1);
  assert.equal(r.itens[0].cliente.nome, 'Ana');
  assert.equal(r.itens[0].servico.nome, 'Corte');
});

test('doCliente separa futuros e histórico', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, hoje(), '18:00', 'confirmado');
  await criar(b, s, cli, '2020-01-01', '09:00', 'concluido');
  assert.equal((await ag.doCliente(cli, 'futuros')).length, 1);
  assert.equal((await ag.doCliente(cli, 'historico')).length, 1);
});

test('dashboard soma faturamento/comissão de concluídos do mês', async () => {
  const { b, s, cli } = await base();
  const [ano, mes] = hoje().split('-');
  await criar(b, s, cli, `${ano}-${mes}-05`, '09:00', 'concluido');
  await criar(b, s, cli, `${ano}-${mes}-06`, '09:00', 'concluido');
  const d = await ag.dashboard();
  assert.equal(Number(d.contadores.faturamento_mes), 90);
  assert.equal(Number(d.contadores.comissao_mes), 45);
});

test('comissoes.relatorio agrupa por serviço com total', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, '2026-09-05', '09:00', 'concluido');
  await criar(b, s, cli, '2026-09-06', '09:00', 'concluido');
  const r = await comissoes.relatorio({ ano: 2026, mes: 9 });
  assert.equal(r.linhas[0].qtd, 2);
  assert.equal(Number(r.total.comissao), 45);
});

test('templates.atualizar muda o corpo', async () => {
  const t = await templates.atualizar('confirmacao', { titulo: 'T', corpo: 'novo {{nome_cliente}}', ativo: true });
  assert.equal(t.corpo, 'novo {{nome_cliente}}');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/repos/agendamentos-repo.test.js`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `src/repos/agendamentos.js`**

```js
// src/repos/agendamentos.js
import { query } from '../db/pool.js';
import { hoje, inicioDoMes, fimDoMes } from '../lib/datas.js';

const SELECT_ITEM = `
  SELECT a.id, a.data_agendamento, to_char(a.horario_inicio,'HH24:MI') AS horario_inicio,
         to_char(a.horario_fim,'HH24:MI') AS horario_fim, a.status, a.valor_total,
         a.comissao_valor, a.observacoes,
         c.id AS c_id, c.nome AS c_nome, c.celular AS c_celular,
         s.id AS s_id, s.nome AS s_nome, s.preco AS s_preco,
         u.id AS u_id, u.nome AS u_nome
  FROM agendamentos a
  JOIN clientes c ON c.id = a.cliente_id
  JOIN servicos s ON s.id = a.servico_id
  JOIN usuarios u ON u.id = a.barbeiro_id`;

function moldar(r) {
  return {
    id: r.id, data_agendamento: r.data_agendamento,
    horario_inicio: r.horario_inicio, horario_fim: r.horario_fim,
    status: r.status, valor_total: r.valor_total, comissao_valor: r.comissao_valor,
    observacoes: r.observacoes,
    cliente: { id: r.c_id, nome: r.c_nome, celular: r.c_celular },
    servico: { id: r.s_id, nome: r.s_nome, preco: r.s_preco },
    barbeiro: { id: r.u_id, nome: r.u_nome },
  };
}

export async function listar({ de, ate, status, cliente, page = 1, tamanho = 20 } = {}) {
  const cond = [];
  const params = [];
  if (de) { params.push(de); cond.push(`a.data_agendamento >= $${params.length}`); }
  if (ate) { params.push(ate); cond.push(`a.data_agendamento <= $${params.length}`); }
  if (status) { params.push(status); cond.push(`a.status = $${params.length}`); }
  if (cliente) {
    params.push(`%${cliente}%`);
    cond.push(`(c.nome ILIKE $${params.length} OR c.celular LIKE $${params.length})`);
  }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const tot = await query(
    `SELECT count(*)::int AS n FROM agendamentos a JOIN clientes c ON c.id=a.cliente_id ${where}`, params);
  params.push(tamanho, (page - 1) * tamanho);
  const r = await query(
    `${SELECT_ITEM} ${where} ORDER BY a.data_agendamento DESC, a.horario_inicio DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { itens: r.rows.map(moldar), total: tot.rows[0].n, page };
}

export async function doCliente(clienteId, quando) {
  const futuros = quando === 'futuros';
  const r = await query(
    `${SELECT_ITEM}
     WHERE a.cliente_id = $1 AND (
       ($2 AND a.data_agendamento >= $3 AND a.status IN ('pendente','confirmado'))
       OR (NOT $2 AND (a.data_agendamento < $3 OR a.status IN ('concluido','cancelado')))
     )
     ORDER BY a.data_agendamento ${futuros ? 'ASC' : 'DESC'}, a.horario_inicio`,
    [clienteId, futuros, hoje()]);
  return r.rows.map(moldar);
}

export async function porId(id) {
  const r = await query(`${SELECT_ITEM} WHERE a.id = $1`, [id]);
  return r.rows[0] ? moldar(r.rows[0]) : null;
}

export async function dashboard() {
  const h = hoje();
  const [ano, mes] = h.split('-').map(Number);
  const ini = inicioDoMes(ano, mes);
  const fim = fimDoMes(ano, mes);
  const hojeRows = await query(
    `${SELECT_ITEM} WHERE a.data_agendamento = $1 AND a.status IN ('pendente','confirmado')
     ORDER BY a.horario_inicio`, [h]);
  const cont = await query(
    `SELECT
       (SELECT count(*)::int FROM agendamentos WHERE data_agendamento=$1 AND status IN ('pendente','confirmado')) AS cortes_hoje,
       (SELECT count(*)::int FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status <> 'cancelado') AS agendamentos_mes,
       (SELECT COALESCE(SUM(valor_total),0) FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status='concluido') AS faturamento_mes,
       (SELECT COALESCE(SUM(comissao_valor),0) FROM agendamentos WHERE data_agendamento BETWEEN $2 AND $3 AND status='concluido') AS comissao_mes`,
    [h, ini, fim]);
  return { hoje: hojeRows.rows.map(moldar), contadores: cont.rows[0] };
}

async function mudarStatus(id, novo, deOrigem) {
  const r = await query(
    `UPDATE agendamentos SET status=$2, updated_at=now()
     WHERE id=$1 AND status IN (${deOrigem}) RETURNING id`, [id, novo]);
  return r.rowCount ? porId(id) : null;
}
export const concluir = (id) => mudarStatus(id, 'concluido', `'pendente','confirmado'`);
export const confirmarStatus = (id) => mudarStatus(id, 'confirmado', `'pendente'`);
```

- [ ] **Step 4: Implementar `src/repos/comissoes.js`**

```js
// src/repos/comissoes.js
import { query } from '../db/pool.js';
import { inicioDoMes, fimDoMes } from '../lib/datas.js';

export async function relatorio({ ano, mes, barbeiroId = null }) {
  const r = await query(
    `SELECT s.nome AS servico,
            count(*)::int AS qtd,
            COALESCE(SUM(a.valor_total),0) AS faturamento,
            s.comissao_percentual AS percentual,
            COALESCE(SUM(a.comissao_valor),0) AS comissao
     FROM agendamentos a JOIN servicos s ON s.id=a.servico_id
     WHERE a.status='concluido'
       AND a.data_agendamento BETWEEN $1 AND $2
       AND ($3::int IS NULL OR a.barbeiro_id=$3)
     GROUP BY s.nome, s.comissao_percentual
     ORDER BY comissao DESC`,
    [inicioDoMes(ano, mes), fimDoMes(ano, mes), barbeiroId]);
  const total = r.rows.reduce((acc, l) => ({
    qtd: acc.qtd + l.qtd,
    faturamento: acc.faturamento + Number(l.faturamento),
    comissao: acc.comissao + Number(l.comissao),
  }), { qtd: 0, faturamento: 0, comissao: 0 });
  return { linhas: r.rows, total };
}
```

- [ ] **Step 5: Implementar `src/repos/templates.js`**

```js
// src/repos/templates.js
import { query } from '../db/pool.js';

export async function todos() {
  const r = await query(`SELECT chave, titulo, corpo, ativo FROM templates_mensagem ORDER BY chave`);
  return r.rows;
}

export async function porChave(chave) {
  const r = await query(`SELECT chave, titulo, corpo, ativo FROM templates_mensagem WHERE chave=$1`, [chave]);
  return r.rows[0] ?? null;
}

export async function atualizar(chave, { titulo, corpo, ativo }) {
  const r = await query(
    `UPDATE templates_mensagem SET titulo=$2, corpo=$3, ativo=$4 WHERE chave=$1
     RETURNING chave, titulo, corpo, ativo`,
    [chave, titulo, corpo, ativo]);
  return r.rows[0] ?? null;
}
```

- [ ] **Step 6: Implementar `src/repos/mensagens.js`**

```js
// src/repos/mensagens.js
import { query } from '../db/pool.js';

export async function listar({ agendamento_id, status, page = 1, tamanho = 20 } = {}) {
  const cond = [];
  const params = [];
  if (agendamento_id) { params.push(agendamento_id); cond.push(`agendamento_id=$${params.length}`); }
  if (status) { params.push(status); cond.push(`status_envio=$${params.length}`); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  const tot = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp ${where}`, params);
  params.push(tamanho, (page - 1) * tamanho);
  const r = await query(
    `SELECT id, agendamento_id, template_chave, telefone_destino, mensagem_final,
            status_envio, erro, enviado_em, created_at
     FROM mensagens_whatsapp ${where}
     ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { itens: r.rows, total: tot.rows[0].n, page };
}

export async function enfileirar({ agendamento_id, template_chave, telefone_destino, mensagem_final }) {
  const r = await query(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1,$2,$3,$4,'pendente') RETURNING *`,
    [agendamento_id, template_chave, telefone_destino, mensagem_final]);
  return r.rows[0];
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm test -- test/repos/agendamentos-repo.test.js`
Expected: PASS (5 testes).

- [ ] **Step 8: Commit**

```bash
git add src/repos/agendamentos.js src/repos/comissoes.js src/repos/templates.js src/repos/mensagens.js test/repos/agendamentos-repo.test.js
git commit -m "feat(p2): repos agendamentos/comissoes/templates/mensagens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task E19: `src/routes/publicas.js` parte 1 — servicos / dias / horarios

**Files:**
- Create: `src/routes/publicas.js`
- Modify: `src/app.js` (`montarRotas`: `app.use('/api/agenda', anexarSessaoAnonima, exigirOrigemConfiavel, publicas)` antes da âncora)
- Test: `test/http/agenda-consulta.test.js`

**Interfaces:**
- Consumes: `express`, `zod`; `rota`, `ErroHttp`; `validarQuery`; `horariosDisponiveis` de `src/agenda/disponibilidade.js`; `servicos.ativos` de `src/repos/servicos.js`; `ehData` de `src/lib/datas.js`; `query` de `src/db/pool.js` (p/ barbeiro padrão).
- Produces: `publicas` (`express.Router()`) com:
  - `GET /servicos` → `200 { servicos: [...] }`.
  - `GET /dias?ano&mes&servico_id[&barbeiro_id]` → itera cada dia do mês chamando `horariosDisponiveis`; `200 { dias: [...], fechado: <string|null> }` (se o 1º dia já vem `fechado:'mes_fechado'`, retorna `{ dias:[], fechado:'MES_FECHADO' }`).
  - `GET /horarios?data&servico_id[&barbeiro_id]` → `horariosDisponiveis({ ..., sessionId: req.sessionId })` → `200 { horarios: [...], fechado: <MAIÚSCULO|null> }`.
  - Helper interno `barbeiroPadrao()` — `SELECT barbeiro_padrao_id FROM configuracao WHERE id=1`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/agenda-consulta.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function servicoCorte() {
  return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
}

test('GET /api/agenda/servicos lista os 3 ativos', async () => {
  const res = await request(buildApp()).get('/api/agenda/servicos');
  assert.equal(res.status, 200);
  assert.equal(res.body.servicos.length, 3);
});

test('GET /horarios com mês fechado => fechado MES_FECHADO', async () => {
  const res = await request(buildApp())
    .get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { horarios: [], fechado: 'MES_FECHADO' });
});

test('GET /horarios com mês aberto lista a grade', async () => {
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const res = await request(buildApp())
    .get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.equal(res.body.fechado, null);
  assert.equal(res.body.horarios[0], '09:00');
});

test('GET /dias devolve os dias com vaga no mês aberto', async () => {
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const res = await request(buildApp())
    .get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: await servicoCorte() });
  assert.equal(res.status, 200);
  assert.ok(res.body.dias.includes('2026-09-10'));   // quinta
  assert.ok(!res.body.dias.includes('2026-09-13'));  // domingo (expediente fechado)
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/agenda-consulta.test.js`
Expected: FAIL (rota não montada).

- [ ] **Step 3: Implementar `src/routes/publicas.js`**

```js
// src/routes/publicas.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { validarQuery } from '../http/validar.js';
import { query } from '../db/pool.js';
import { horariosDisponiveis } from '../agenda/disponibilidade.js';
import * as servicos from '../repos/servicos.js';
import { ehData, fimDoMes } from '../lib/datas.js';

export const publicas = express.Router();

async function barbeiroPadrao() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0]?.id ?? null;
}

const MAIUSC = (s) => (s ? s.toUpperCase() : null);

publicas.get('/servicos', rota(async (req, res) => {
  res.json({ servicos: await servicos.ativos() });
}));

publicas.get('/horarios',
  validarQuery(z.object({
    data: z.string().refine(ehData, 'data inválida'),
    servico_id: z.coerce.number().int().positive(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const barbeiroId = req.query.barbeiro_id ?? await barbeiroPadrao();
    const r = await horariosDisponiveis({
      barbeiroId, data: req.query.data, servicoId: req.query.servico_id, sessionId: req.sessionId,
    });
    res.json({ horarios: r.disponivel, fechado: MAIUSC(r.fechado) });
  }));

publicas.get('/dias',
  validarQuery(z.object({
    ano: z.coerce.number().int(),
    mes: z.coerce.number().int().min(1).max(12),
    servico_id: z.coerce.number().int().positive(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const { ano, mes } = req.query;
    const barbeiroId = req.query.barbeiro_id ?? await barbeiroPadrao();
    const ultimo = Number(fimDoMes(ano, mes).slice(-2));
    const dias = [];
    let fechado = null;
    for (let d = 1; d <= ultimo; d++) {
      const data = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const r = await horariosDisponiveis({ barbeiroId, data, servicoId: req.query.servico_id, sessionId: req.sessionId });
      if (r.fechado === 'mes_fechado') { fechado = 'MES_FECHADO'; break; }
      if (r.disponivel.length > 0) dias.push(data);
    }
    res.json({ dias, fechado });
  }));
```

- [ ] **Step 4: Montar em `src/app.js`**

No topo: `import { publicas } from './routes/publicas.js';`. Em `montarRotas`, antes da âncora:

```js
  app.use('/api/agenda', anexarSessaoAnonima, exigirOrigemConfiavel, publicas);
```

(`anexarSessaoAnonima` e `exigirOrigemConfiavel` já importados na Task B12.)

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/agenda-consulta.test.js`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/publicas.js src/app.js test/http/agenda-consulta.test.js
git commit -m "feat(p2): GET /api/agenda/servicos|dias|horarios

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task E20: `src/routes/publicas.js` parte 2 — lock / renovar / liberar

**Files:**
- Modify: `src/routes/publicas.js`
- Test: `test/http/agenda-lock.test.js`

**Interfaces:**
- Consumes: `criarLock`, `renovarLock`, `liberarLock` de `src/agenda/locks.js`; `servicos.porId`; `emitirHorarioReservado`, `emitirHorarioLiberado` de `src/realtime/emitir.js`; `cache.invalidarData`; `ErroHttp`.
- Produces (acrescenta a `publicas`):
  - `POST /lock` `{ data, horario, servico_id, barbeiro_id? }` → resolve barbeiro; `criarLock({ barbeiroId, data, horario, sessionId: req.sessionId })`; se `{ ok:false }` → `next(new ErroHttp(erro))` (`SLOT_TRAVADO`/`SLOT_OCUPADO`); sucesso → `emitirHorarioReservado(req.io, { data, horario })`; `cache.invalidarData(data)`; `200 { ok:true, expira_em }` (`expira_em` = ISO de `now()+5min` — devolvido pelo lock; ver nota).
  - `POST /lock/renovar` idem → `{ ok:false }` de `renovarLock` → `next(new ErroHttp('LOCK_EXPIRADO'))`; sucesso `200 { ok:true }`.
  - `POST /lock/liberar` → `liberarLock(...)`; `emitirHorarioLiberado`; `cache.invalidarData(data)`; `200 { ok:true }`.
- **Nota:** `criarLock`/`renovarLock` do P1 retornam só `{ ok }`. Esta task **estende** `src/agenda/locks.js` minimamente: `criarLock` e `renovarLock` passam a incluir `expira_em` (ISO string) no retorno de sucesso — `RETURNING to_char(expira_em, ...)` já existe no `RETURNING id`; trocar para `RETURNING id, to_char(expira_em,'YYYY-MM-DD"T"HH24:MI:SSOF') AS expira_em` e devolver `{ ok:true, expira_em: res.rows[0].expira_em }`. Os testes do P1 de locks continuam passando (só checam `.ok`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/agenda-lock.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('lock cria, segunda sessão recebe 409 SLOT_TRAVADO, liberar solta', async () => {
  const s = await corte();
  const a = request.agent(buildApp());
  const r1 = await a.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r1.status, 200);
  assert.ok(r1.body.expira_em);

  const b = request.agent(buildApp());
  const r2 = await b.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.erro, 'SLOT_TRAVADO');

  const r3 = await a.post('/api/agenda/lock/liberar').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r3.status, 200);
  const r4 = await b.post('/api/agenda/lock').set('Origin', ORIGIN).send({ data: '2026-09-10', horario: '09:00', servico_id: s });
  assert.equal(r4.status, 200);
});

test('renovar sem lock => 409 LOCK_EXPIRADO', async () => {
  const s = await corte();
  const res = await request(buildApp()).post('/api/agenda/lock/renovar').set('Origin', ORIGIN)
    .send({ data: '2026-09-10', horario: '10:10', servico_id: s });
  assert.equal(res.status, 409);
  assert.equal(res.body.erro, 'LOCK_EXPIRADO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/agenda-lock.test.js`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Estender `src/agenda/locks.js`**

Em `criarLock`, trocar `RETURNING id` por `RETURNING id, to_char(expira_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS expira_em` e o retorno final `return res.rowCount === 0 ? { ok: false, erro: 'SLOT_TRAVADO' } : { ok: true };` por:

```js
  if (res.rowCount === 0) return { ok: false, erro: 'SLOT_TRAVADO' };
  return { ok: true, expira_em: res.rows[0].expira_em };
```

Em `renovarLock`, trocar o `UPDATE ...` para `... RETURNING to_char(expira_em, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS expira_em` e o retorno por:

```js
  return { ok: res.rowCount > 0, expira_em: res.rows[0]?.expira_em };
```

- [ ] **Step 4: Acrescentar as rotas a `src/routes/publicas.js`**

Imports no topo: `import { criarLock, renovarLock, liberarLock } from '../agenda/locks.js';`, `import { validarCorpo } from '../http/validar.js';`, `import { ErroHttp } from '../http/erros.js';`, `import { emitirHorarioReservado, emitirHorarioLiberado } from '../realtime/emitir.js';`, `import * as cache from '../agenda/cache.js';`.

```js
const corpoLock = z.object({
  data: z.string().refine(ehData, 'data inválida'),
  horario: z.string().regex(/^\d{2}:\d{2}$/),
  servico_id: z.coerce.number().int().positive(),
  barbeiro_id: z.coerce.number().int().positive().optional(),
});

publicas.post('/lock', validarCorpo(corpoLock), rota(async (req, res, next) => {
  const { data, horario } = req.body;
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  const r = await criarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  if (!r.ok) return next(new ErroHttp(r.erro));
  emitirHorarioReservado(req.io, { data, horario });
  cache.invalidarData(data);
  res.json({ ok: true, expira_em: r.expira_em });
}));

publicas.post('/lock/renovar', validarCorpo(corpoLock), rota(async (req, res, next) => {
  const { data, horario } = req.body;
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  const r = await renovarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  if (!r.ok) return next(new ErroHttp('LOCK_EXPIRADO'));
  res.json({ ok: true, expira_em: r.expira_em });
}));

publicas.post('/lock/liberar', validarCorpo(corpoLock), rota(async (req, res) => {
  const { data, horario } = req.body;
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  await liberarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  emitirHorarioLiberado(req.io, { data, horario });
  cache.invalidarData(data);
  res.json({ ok: true });
}));
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/agenda-lock.test.js test/agenda/locks.test.js`
Expected: PASS (lock http 2; locks P1 6 — continuam verdes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/publicas.js src/agenda/locks.js test/http/agenda-lock.test.js
git commit -m "feat(p2): POST /api/agenda/lock|/renovar|/liberar (+ expira_em no lock)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task E21: `src/routes/publicas.js` parte 3 — cadastro / confirmar

**Files:**
- Modify: `src/routes/publicas.js`
- Test: `test/http/agenda-confirmar.test.js`

**Interfaces:**
- Consumes: `confirmarAgendamento` de `src/agenda/agendar.js`; `clientes.porCelular`, `clientes.criar`; `servicos.porId`; `hashSenha`; `normalizarCelular`; `emitirAgendaAtualizada`, `emitirNovoAgendamento`, `emitirDashboardTick`; `agendamentos.porId`, `agendamentos.dashboard`; `processarPendentes` de `src/services/mensageiro.js`; `cache.invalidarData`; `ErroHttp`.
- Produces (acrescenta a `publicas`):
  - `POST /cadastro` `{ nome, celular, email?, senha?, consentimento:true }` → `normalizarCelular` (erro → `ErroHttp('VALIDACAO')` com campo `celular`); `clientes.porCelular`: se existe **com** `senha_hash` → `ErroHttp('CELULAR_EM_USO')`; se existe sem senha → reusa; senão `clientes.criar` (com `hashSenha(senha)` se veio `senha` — e então `email` é obrigatório). `req.session.clienteId = cliente.id`; `201 { cliente: { id, nome } }`.
  - `POST /confirmar` `{ servico_id, data, horario, observacoes?, barbeiro_id? }` + `requireCliente` → `confirmarAgendamento({ clienteId: req.session.clienteId, servicoId, barbeiroId, data, horario, sessionId: req.sessionId, observacoes })`; `{ ok:false }` → `next(new ErroHttp(erro))`; sucesso → recarrega item via `agendamentos.porId`, emite os 3 eventos + `emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores)`, `cache.invalidarData(data)`, `await processarPendentes({ limite: 5 }).catch((e)=>req.log?.error({e},'worker'))`; `201 { agendamento: item }`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/agenda-confirmar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('cadastro simples + confirmar cria agendamento e enfileira msg processada', async () => {
  const s = await corte();
  const a = request.agent(buildApp());
  const cad = await a.post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '(28) 99999-0000', consentimento: true });
  assert.equal(cad.status, 201);

  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '15:25' });
  assert.equal(conf.status, 201);
  assert.equal(conf.body.agendamento.status, 'pendente');

  const msg = await query(`SELECT status_envio FROM mensagens_whatsapp WHERE agendamento_id=$1`, [conf.body.agendamento.id]);
  assert.equal(msg.rows[0].status_envio, 'simulado');
});

test('confirmar sem sessão de cliente => 401', async () => {
  const s = await corte();
  const res = await request(buildApp()).post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '15:25' });
  assert.equal(res.status, 401);
});

test('segundo confirmar no mesmo slot => 409 HORARIO_INDISPONIVEL', async () => {
  const s = await corte();
  const a = request.agent(buildApp()); const b = request.agent(buildApp());
  for (const [ag, cel] of [[a, '(28) 90000-0001'], [b, '(28) 90000-0002']]) {
    await ag.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'X', celular: cel, consentimento: true });
  }
  const r1 = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  assert.equal(r1.status, 201);
  const r2 = await b.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.erro, 'HORARIO_INDISPONIVEL');
});

test('cadastro com celular já usado com senha => 409 CELULAR_EM_USO', async () => {
  await query(`INSERT INTO clientes (nome, celular, email, senha_hash) VALUES ('J','5528911112222','j@x.com','$2b$12$abcdefghijklmnopqrstuv')`);
  const res = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'J2', celular: '28911112222', consentimento: true });
  assert.equal(res.status, 409);
  assert.equal(res.body.erro, 'CELULAR_EM_USO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/agenda-confirmar.test.js`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Acrescentar as rotas a `src/routes/publicas.js`**

Imports no topo: `import { confirmarAgendamento } from '../agenda/agendar.js';`, `import * as clientes from '../repos/clientes.js';`, `import * as agendamentos from '../repos/agendamentos.js';`, `import { hashSenha } from '../auth/senha.js';`, `import { normalizarCelular } from '../lib/celular.js';`, `import { requireCliente } from '../auth/middleware.js';`, `import { emitirAgendaAtualizada, emitirNovoAgendamento, emitirDashboardTick } from '../realtime/emitir.js';`, `import { processarPendentes } from '../services/mensageiro.js';`.

```js
publicas.post('/cadastro',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100),
    celular: z.string().min(1),
    email: z.string().email().optional(),
    senha: z.string().min(6).optional(),
    consentimento: z.literal(true),
  })),
  rota(async (req, res, next) => {
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'celular', mensagem: 'inválido' }]; return next(e); }
    if (req.body.senha && !req.body.email) {
      const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'email', mensagem: 'obrigatório com senha' }]; return next(e);
    }
    const existente = await clientes.porCelular(celular);
    if (existente?.senha_hash) return next(new ErroHttp('CELULAR_EM_USO'));
    const cliente = existente ?? await clientes.criar({
      nome: req.body.nome, celular,
      email: req.body.email ?? null,
      senha_hash: req.body.senha ? await hashSenha(req.body.senha) : null,
    });
    req.session.clienteId = cliente.id;
    delete req.session.usuarioId;
    res.status(201).json({ cliente: { id: cliente.id, nome: cliente.nome } });
  }));

publicas.post('/confirmar', requireCliente,
  validarCorpo(z.object({
    servico_id: z.coerce.number().int().positive(),
    data: z.string().refine(ehData, 'data inválida'),
    horario: z.string().regex(/^\d{2}:\d{2}$/),
    observacoes: z.string().max(1000).optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res, next) => {
    const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
    const r = await confirmarAgendamento({
      clienteId: req.session.clienteId,
      servicoId: req.body.servico_id,
      barbeiroId,
      data: req.body.data,
      horario: req.body.horario,
      sessionId: req.sessionId,
      observacoes: req.body.observacoes ?? null,
    });
    if (!r.ok) return next(new ErroHttp(r.erro));
    const item = await agendamentos.porId(r.agendamento.id);
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirNovoAgendamento(req.io, {
      id: item.id, cliente: item.cliente.nome, servico: item.servico.nome,
      data: item.data_agendamento, horario: item.horario_inicio, status: item.status,
    });
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    cache.invalidarData(req.body.data);
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker de mensagens'));
    res.status(201).json({ agendamento: item });
  }));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/agenda-confirmar.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/routes/publicas.js test/http/agenda-confirmar.test.js
git commit -m "feat(p2): POST /api/agenda/cadastro e /confirmar (eventos + cache + worker)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task F22: `src/routes/clienteApi.js` — área do cliente

**Files:**
- Create: `src/routes/clienteApi.js`
- Modify: `src/app.js` (`montarRotas`: `app.use('/api/cliente', anexarSessaoAnonima, exigirOrigemConfiavel, requireCliente, clienteApi)`)
- Test: `test/http/cliente.test.js`

**Interfaces:**
- Consumes: `express`, `zod`; `rota`, `ErroHttp`; `validarQuery`, `validarCorpo`; `requireCliente`; `agendamentos.doCliente`, `agendamentos.porId`; `cancelarAgendamento`, `remarcarAgendamento` de `src/agenda/agendar.js`; `query` (config de antecedência); `emitir*`; `cache.invalidarData`; `clientes.porCelular` (p/ `me` — na verdade um `SELECT` direto).
- Produces: `clienteApi` (`express.Router()`):
  - `GET /me` → `SELECT id, nome, celular, email, celular_verificado FROM clientes WHERE id=$1` → `200 { cliente }`.
  - `GET /agendamentos?quando=futuros|historico` → `200 { agendamentos: [item] }`.
  - `POST /agendamentos/:id/cancelar` `{ motivo }` → carrega `agendamentos.porId`; `404 NAO_ENCONTRADO` se `null` ou `cliente.id !== req.session.clienteId`; calcula horas até o agendamento; se ≤ `antecedencia_min_horas` → `ErroHttp('FORA_DO_PRAZO')`; `cancelarAgendamento(id, { motivo })`; emite `emitirAgendaAtualizada` + `emitirAgendamentoAtualizado({ id, status:'cancelado' })` + `emitirDashboardTick`; `cache.invalidarData`; `200 { agendamento: <porId> }`.
  - `POST /agendamentos/:id/remarcar` `{ nova_data, novo_horario }` → mesma checagem de posse; `remarcarAgendamento(id, { novaData, novoHorario })`; `{ ok:false }` → `next(new ErroHttp(erro))`; emite eventos nas 2 datas (antiga e nova) + tick; invalida cache nas 2; `200 { agendamento: <novo, via porId> }`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/cliente.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { hoje } from '../../src/lib/datas.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026,9,NULL,'aberto'), (extract(year from now())::int, extract(month from now())::int, NULL, 'aberto')`);
});

async function logar() {
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const a = request.agent(buildApp());
  await a.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'Ana', celular: '28999990000', consentimento: true });
  return { a, s };
}

test('GET /me e /agendamentos', async () => {
  const { a } = await logar();
  const me = await a.get('/api/cliente/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.cliente.nome, 'Ana');
  const lst = await a.get('/api/cliente/agendamentos').query({ quando: 'futuros' });
  assert.deepEqual(lst.body.agendamentos, []);
});

test('cancelar dentro do prazo funciona; agendamento de outro => 404', async () => {
  const { a, s } = await logar();
  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  const id = conf.body.agendamento.id;
  const canc = await a.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'imprevisto' });
  assert.equal(canc.status, 200);
  assert.equal(canc.body.agendamento.status, 'cancelado');

  const outro = request.agent(buildApp());
  await outro.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'B', celular: '28900001111', consentimento: true });
  const naoDele = await outro.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'x' });
  assert.equal(naoDele.status, 404);
});

test('cancelar fora do prazo => 403 FORA_DO_PRAZO', async () => {
  const { a, s } = await logar();
  // agendamento daqui a 1h (antecedência padrão 2h)
  const daqui1h = new Date(Date.now() + 3600_000);
  const hh = String(daqui1h.getHours()).padStart(2, '0') + ':00';
  await query(`UPDATE horario_funcionamento SET aberto=true, abre='00:00', fecha='23:59'`);
  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: hoje(), horario: hh });
  // se o confirmar recusar por antecedência, este teste é inconclusivo — então
  // inserimos direto:
  let id = conf.body?.agendamento?.id;
  if (!id) {
    const cli = (await query(`SELECT id FROM clientes WHERE nome='Ana'`)).rows[0].id;
    const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
    id = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
      VALUES ($1,$2,$3,$4,$5,$5,'confirmado',10) RETURNING id`, [cli, s, b, hoje(), hh])).rows[0].id;
  }
  const canc = await a.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'x' });
  assert.equal(canc.status, 403);
  assert.equal(canc.body.erro, 'FORA_DO_PRAZO');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/cliente.test.js`
Expected: FAIL (rota não montada).

- [ ] **Step 3: Implementar `src/routes/clienteApi.js`**

```js
// src/routes/clienteApi.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo, validarQuery } from '../http/validar.js';
import { query } from '../db/pool.js';
import { ehData } from '../lib/datas.js';
import * as agendamentos from '../repos/agendamentos.js';
import { cancelarAgendamento, remarcarAgendamento } from '../agenda/agendar.js';
import { emitirAgendaAtualizada, emitirAgendamentoAtualizado, emitirDashboardTick } from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';

export const clienteApi = express.Router();

async function meuAgendamento(id, clienteId) {
  const item = await agendamentos.porId(id);
  if (!item || item.cliente.id !== clienteId) return null;
  return item;
}

async function antecedenciaHoras() {
  const r = await query(`SELECT antecedencia_min_horas FROM configuracao WHERE id=1`);
  return r.rows[0].antecedencia_min_horas;
}

clienteApi.get('/me', rota(async (req, res) => {
  const r = await query(
    `SELECT id, nome, celular, email, celular_verificado FROM clientes WHERE id=$1`,
    [req.session.clienteId]);
  res.json({ cliente: r.rows[0] });
}));

clienteApi.get('/agendamentos',
  validarQuery(z.object({ quando: z.enum(['futuros', 'historico']).default('futuros') })),
  rota(async (req, res) => {
    res.json({ agendamentos: await agendamentos.doCliente(req.session.clienteId, req.query.quando) });
  }));

clienteApi.post('/agendamentos/:id/cancelar',
  validarCorpo(z.object({ motivo: z.string().max(500).optional() })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const item = await meuAgendamento(id, req.session.clienteId);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    const quando = new Date(`${item.data_agendamento}T${item.horario_inicio}:00`);
    if ((quando - Date.now()) / 3600_000 <= await antecedenciaHoras()) {
      return next(new ErroHttp('FORA_DO_PRAZO'));
    }
    const r = await cancelarAgendamento(id, { motivo: req.body.motivo ?? null });
    if (!r.ok) return next(new ErroHttp(r.erro));
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirAgendamentoAtualizado(req.io, { id, status: 'cancelado' });
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    cache.invalidarData(item.data_agendamento);
    res.json({ agendamento: await agendamentos.porId(id) });
  }));

clienteApi.post('/agendamentos/:id/remarcar',
  validarCorpo(z.object({
    nova_data: z.string().refine(ehData, 'data inválida'),
    novo_horario: z.string().regex(/^\d{2}:\d{2}$/),
  })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const item = await meuAgendamento(id, req.session.clienteId);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    const r = await remarcarAgendamento(id, { novaData: req.body.nova_data, novoHorario: req.body.novo_horario });
    if (!r.ok) return next(new ErroHttp(r.erro));
    for (const d of new Set([item.data_agendamento, req.body.nova_data])) {
      emitirAgendaAtualizada(req.io, { data: d });
      cache.invalidarData(d);
    }
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    res.json({ agendamento: await agendamentos.porId(r.agendamento.id) });
  }));
```

- [ ] **Step 4: Montar em `src/app.js`**

No topo: `import { clienteApi } from './routes/clienteApi.js';` e `import { requireCliente } from './auth/middleware.js';`. Em `montarRotas`, antes da âncora:

```js
  app.use('/api/cliente', anexarSessaoAnonima, exigirOrigemConfiavel, requireCliente, clienteApi);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/cliente.test.js`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/clienteApi.js src/app.js test/http/cliente.test.js
git commit -m "feat(p2): /api/cliente (me, agendamentos, cancelar, remarcar)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task G23: `src/routes/adminApi.js` parte 1 — dashboard / agendamentos / status / criação manual

**Files:**
- Create: `src/routes/adminApi.js`
- Modify: `src/app.js` (`montarRotas`: `app.use('/api/admin', anexarSessaoAnonima, exigirOrigemConfiavel, requireEquipe, adminApi)`)
- Test: `test/http/admin-agendamentos.test.js`

**Interfaces:**
- Consumes: `express`, `zod`; `rota`, `ErroHttp`; `validarCorpo`, `validarQuery`; `requireEquipe`; `agendamentos.*` de `src/repos/agendamentos.js`; `confirmarAgendamento`, `cancelarAgendamento` de `src/agenda/agendar.js`; `templates.porChave`, `mensagens.enfileirar`; `renderizarTemplate` de `src/lib/template.js`; `clientes.porCelular`, `clientes.criar`; `normalizarCelular`; `processarPendentes`; `emitir*`; `cache.invalidarData`; `query` (barbeiro padrão / config).
- Produces: `adminApi` (`express.Router()`):
  - `GET /dashboard` → `200 { hoje, contadores }` (de `agendamentos.dashboard()`).
  - `GET /agendamentos?data?&de?&ate?&status?&cliente?&page?` → `200 { itens, total, page }`.
  - `PATCH /agendamentos/:id/status` `{ status: 'confirmado'|'concluido'|'cancelado', motivo? }`:
    - `confirmado` → `agendamentos.confirmarStatus(id)`;
    - `concluido` → `agendamentos.concluir(id)` + enfileira template `pos_atendimento` (se `ativo`) + `await processarPendentes({limite:5})`;
    - `cancelado` → `cancelarAgendamento(id, { motivo })`.
    - `null` do repo/motor → `404`/`409` conforme. Emite `emitirAgendamentoAtualizado({id,status})` + `emitirAgendaAtualizada({data})` + `emitirDashboardTick`; `cache.invalidarData`. `200 { agendamento: <porId> }`.
  - `POST /agendamentos` `{ cliente_id? , cliente?:{nome,celular}, servico_id, data, horario, barbeiro_id?, observacoes? }` → resolve/cria cliente; `confirmarAgendamento(...)`; mesmos eventos + worker que o `/api/agenda/confirmar`; `201 { agendamento }`.
- Helper `renderConfirmacao(item)` — busca template `confirmacao`, monta as vars e chama `renderizarTemplate` — reaproveitado pelo `POST /agendamentos` (o `confirmarAgendamento` do P1 já enfileira a `confirmacao`, então o manual **não** re-enfileira; só o `concluido` enfileira `pos_atendimento`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/admin-agendamentos.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo(); resetRateLimit();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});
// NOTA: os outros arquivos test/http/admin-*.test.js seguem o mesmo padrão
// (import + resetRateLimit() no beforeEach) — ver Global Constraints.

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN)
    .send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('barbeiro não acessa admin? na verdade acessa (requireEquipe) — sem sessão => 401', async () => {
  const res = await request(buildApp()).get('/api/admin/dashboard');
  assert.equal(res.status, 401);
});

test('criação manual + dashboard reflete', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '09:00' });
  assert.equal(cr.status, 201);
  const d = await a.get('/api/admin/dashboard');
  assert.equal(d.body.contadores.agendamentos_mes >= 0, true);
  const lst = await a.get('/api/admin/agendamentos').query({ status: 'pendente' });
  assert.equal(lst.body.total, 1);
});

test('PATCH status concluido enfileira pos_atendimento', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990001') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '10:10' });
  const id = cr.body.agendamento.id;
  const up = await a.patch(`/api/admin/agendamentos/${id}/status`).set('Origin', ORIGIN).send({ status: 'concluido' });
  assert.equal(up.status, 200);
  assert.equal(up.body.agendamento.status, 'concluido');
  const msg = await query(`SELECT template_chave, status_envio FROM mensagens_whatsapp WHERE agendamento_id=$1 ORDER BY id`, [id]);
  assert.ok(msg.rows.some((m) => m.template_chave === 'pos_atendimento' && m.status_envio === 'simulado'));
});

test('PATCH status cancelado usa o motor e libera o slot', async () => {
  const a = await admin();
  const s = await corte();
  const c = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990002') RETURNING id`)).rows[0].id;
  const cr = await a.post('/api/admin/agendamentos').set('Origin', ORIGIN)
    .send({ cliente_id: c, servico_id: s, data: '2026-09-10', horario: '11:20' });
  const id = cr.body.agendamento.id;
  const up = await a.patch(`/api/admin/agendamentos/${id}/status`).set('Origin', ORIGIN).send({ status: 'cancelado', motivo: 'cliente ligou' });
  assert.equal(up.body.agendamento.status, 'cancelado');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/admin-agendamentos.test.js`
Expected: FAIL (rota não montada).

- [ ] **Step 3: Implementar `src/routes/adminApi.js`**

```js
// src/routes/adminApi.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo, validarQuery } from '../http/validar.js';
import { query } from '../db/pool.js';
import { ehData } from '../lib/datas.js';
import { normalizarCelular } from '../lib/celular.js';
import { renderizarTemplate } from '../lib/template.js';
import * as agendamentos from '../repos/agendamentos.js';
import * as clientes from '../repos/clientes.js';
import * as templates from '../repos/templates.js';
import * as mensagens from '../repos/mensagens.js';
import { confirmarAgendamento, cancelarAgendamento } from '../agenda/agendar.js';
import { processarPendentes } from '../services/mensageiro.js';
import {
  emitirAgendaAtualizada, emitirNovoAgendamento, emitirAgendamentoAtualizado, emitirDashboardTick,
} from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';

export const adminApi = express.Router();

async function barbeiroPadrao() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0]?.id ?? null;
}

async function tick(req) {
  emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
}

async function enfileirarTemplate(item, chave) {
  const tpl = await templates.porChave(chave);
  if (!tpl?.ativo) return;
  const cfg = await query(`SELECT nome_barbearia, endereco FROM configuracao WHERE id=1`);
  const texto = renderizarTemplate(tpl.corpo, {
    nome_cliente: item.cliente.nome,
    nome_servico: item.servico.nome,
    data: item.data_agendamento,
    horario: item.horario_inicio,
    endereco_barbearia: cfg.rows[0].endereco ?? '',
    nome_barbearia: cfg.rows[0].nome_barbearia,
  });
  await mensagens.enfileirar({
    agendamento_id: item.id, template_chave: chave,
    telefone_destino: item.cliente.celular, mensagem_final: texto,
  });
}

adminApi.get('/dashboard', rota(async (req, res) => {
  res.json(await agendamentos.dashboard());
}));

adminApi.get('/agendamentos',
  validarQuery(z.object({
    data: z.string().optional(), de: z.string().optional(), ate: z.string().optional(),
    status: z.enum(['pendente', 'confirmado', 'concluido', 'cancelado']).optional(),
    cliente: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  })),
  rota(async (req, res) => {
    const { data, de, ate, status, cliente, page } = req.query;
    res.json(await agendamentos.listar({ de: data ?? de, ate: data ?? ate, status, cliente, page }));
  }));

adminApi.patch('/agendamentos/:id/status',
  validarCorpo(z.object({
    status: z.enum(['confirmado', 'concluido', 'cancelado']),
    motivo: z.string().max(500).optional(),
  })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const { status, motivo } = req.body;
    let item = null;
    if (status === 'confirmado') item = await agendamentos.confirmarStatus(id);
    else if (status === 'concluido') {
      item = await agendamentos.concluir(id);
      if (item) { await enfileirarTemplate(item, 'pos_atendimento'); }
    } else {
      const r = await cancelarAgendamento(id, { motivo: motivo ?? null });
      if (!r.ok) return next(new ErroHttp(r.erro));
      item = await agendamentos.porId(id);
    }
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    emitirAgendamentoAtualizado(req.io, { id, status: item.status });
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    await tick(req);
    cache.invalidarData(item.data_agendamento);
    if (status === 'concluido') {
      await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    }
    res.json({ agendamento: item });
  }));

adminApi.post('/agendamentos',
  validarCorpo(z.object({
    cliente_id: z.coerce.number().int().positive().optional(),
    cliente: z.object({ nome: z.string().min(1), celular: z.string().min(1) }).optional(),
    servico_id: z.coerce.number().int().positive(),
    data: z.string().refine(ehData, 'data inválida'),
    horario: z.string().regex(/^\d{2}:\d{2}$/),
    barbeiro_id: z.coerce.number().int().positive().optional(),
    observacoes: z.string().max(1000).optional(),
  }).refine((v) => v.cliente_id || v.cliente, { message: 'informe cliente_id ou cliente', path: ['cliente'] })),
  rota(async (req, res, next) => {
    let clienteId = req.body.cliente_id;
    if (!clienteId) {
      const cel = normalizarCelular(req.body.cliente.celular);
      const existente = await clientes.porCelular(cel);
      clienteId = existente?.id ?? (await clientes.criar({ nome: req.body.cliente.nome, celular: cel })).id;
    }
    const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
    const r = await confirmarAgendamento({
      clienteId, servicoId: req.body.servico_id, barbeiroId,
      data: req.body.data, horario: req.body.horario,
      sessionId: `admin:${req.session.usuarioId}`, observacoes: req.body.observacoes ?? null,
    });
    if (!r.ok) return next(new ErroHttp(r.erro));
    const item = await agendamentos.porId(r.agendamento.id);
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirNovoAgendamento(req.io, {
      id: item.id, cliente: item.cliente.nome, servico: item.servico.nome,
      data: item.data_agendamento, horario: item.horario_inicio, status: item.status,
    });
    await tick(req);
    cache.invalidarData(req.body.data);
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    res.status(201).json({ agendamento: item });
  }));
```

- [ ] **Step 4: Montar em `src/app.js`**

No topo: `import { adminApi } from './routes/adminApi.js';` e `import { requireEquipe } from './auth/middleware.js';`. Em `montarRotas`, antes da âncora:

```js
  app.use('/api/admin', anexarSessaoAnonima, exigirOrigemConfiavel, requireEquipe, adminApi);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/admin-agendamentos.test.js`
Expected: PASS (5 testes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/adminApi.js src/app.js test/http/admin-agendamentos.test.js
git commit -m "feat(p2): /api/admin dashboard, agendamentos (listar, PATCH status, criar manual)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task G24: `src/routes/adminApi.js` parte 2 — meses / bloqueios

**Files:**
- Modify: `src/routes/adminApi.js`
- Test: `test/http/admin-agenda-config.test.js`

**Interfaces:**
- Consumes: `disponibilidadeMeses.doAno`, `disponibilidadeMeses.definir`; `bloqueios.entre`, `bloqueios.criar`, `bloqueios.remover`; `cache.limparTudo` (mudança de mês/bloqueio afeta muitas datas → limpar tudo é mais simples e barato).
- Produces (acrescenta a `adminApi`):
  - `GET /disponibilidade?ano` → `200 { meses: [{ mes, status, limite_por_dia }] }`.
  - `POST /disponibilidade` `{ ano, mes, status: 'aberto'|'fechado', limite_por_dia?, barbeiro_id? }` → `definir` + `cache.limparTudo()` + `200 { mes }`.
  - `GET /bloqueios?de&ate` → `200 { bloqueios: [...] }`.
  - `POST /bloqueios` `{ data, dia_inteiro:bool, hora_inicio?, hora_fim?, motivo?, barbeiro_id? }` → se `dia_inteiro` força `hora_inicio=hora_fim=null`; `criar` (com `criado_por: req.session.usuarioId`) + `cache.limparTudo()` + `201 { bloqueio }`.
  - `DELETE /bloqueios/:id` → `remover` → `204` ou `404`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/admin-agenda-config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}
async function corte() { return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id; }

test('abrir mês reflete em GET /api/agenda/dias', async () => {
  const a = await admin();
  const s = await corte();
  let dias = await request(buildApp()).get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: s });
  assert.equal(dias.body.fechado, 'MES_FECHADO');

  const ab = await a.post('/api/admin/disponibilidade').set('Origin', ORIGIN)
    .send({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 8 });
  assert.equal(ab.status, 200);

  dias = await request(buildApp()).get('/api/agenda/dias').query({ ano: 2026, mes: 9, servico_id: s });
  assert.equal(dias.body.fechado, null);
  assert.ok(dias.body.dias.length > 0);

  const meses = await a.get('/api/admin/disponibilidade').query({ ano: 2026 });
  assert.equal(meses.body.meses.find((m) => m.mes === 9).limite_por_dia, 8);
});

test('bloqueio de dia inteiro tira o dia da grade', async () => {
  const a = await admin();
  const s = await corte();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const b = await a.post('/api/admin/bloqueios').set('Origin', ORIGIN)
    .send({ data: '2026-09-10', dia_inteiro: true, motivo: 'feriado' });
  assert.equal(b.status, 201);

  const h = await request(buildApp()).get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: s });
  assert.deepEqual(h.body.horarios, []);

  const lst = await a.get('/api/admin/bloqueios').query({ de: '2026-09-01', ate: '2026-09-30' });
  assert.equal(lst.body.bloqueios.length, 1);
  const del = await a.delete(`/api/admin/bloqueios/${b.body.bloqueio.id}`).set('Origin', ORIGIN);
  assert.equal(del.status, 204);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/admin-agenda-config.test.js`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Acrescentar a `src/routes/adminApi.js`**

Imports: `import * as meses from '../repos/disponibilidadeMeses.js';`, `import * as bloqueios from '../repos/bloqueios.js';`.

```js
adminApi.get('/disponibilidade',
  validarQuery(z.object({ ano: z.coerce.number().int(), barbeiro_id: z.coerce.number().int().positive().optional() })),
  rota(async (req, res) => {
    res.json({ meses: await meses.doAno(req.query.ano, req.query.barbeiro_id ?? null) });
  }));

adminApi.post('/disponibilidade',
  validarCorpo(z.object({
    ano: z.coerce.number().int(),
    mes: z.coerce.number().int().min(1).max(12),
    status: z.enum(['aberto', 'fechado']),
    limite_por_dia: z.coerce.number().int().nonnegative().nullable().optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const m = await meses.definir({
      ano: req.body.ano, mes: req.body.mes, status: req.body.status,
      limite_por_dia: req.body.limite_por_dia ?? null,
      barbeiro_id: req.body.barbeiro_id ?? null,
    });
    cache.limparTudo();
    res.json({ mes: m });
  }));

adminApi.get('/bloqueios',
  validarQuery(z.object({ de: z.string(), ate: z.string(), barbeiro_id: z.coerce.number().int().positive().optional() })),
  rota(async (req, res) => {
    res.json({ bloqueios: await bloqueios.entre(req.query.de, req.query.ate, req.query.barbeiro_id ?? null) });
  }));

adminApi.post('/bloqueios',
  validarCorpo(z.object({
    data: z.string().refine(ehData, 'data inválida'),
    dia_inteiro: z.boolean().default(false),
    hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    hora_fim: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    motivo: z.string().max(200).optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const b = await bloqueios.criar({
      data: req.body.data,
      hora_inicio: req.body.dia_inteiro ? null : (req.body.hora_inicio ?? null),
      hora_fim: req.body.dia_inteiro ? null : (req.body.hora_fim ?? null),
      motivo: req.body.motivo ?? null,
      barbeiro_id: req.body.barbeiro_id ?? null,
      criado_por: req.session.usuarioId,
    });
    cache.limparTudo();
    res.status(201).json({ bloqueio: b });
  }));

adminApi.delete('/bloqueios/:id', rota(async (req, res, next) => {
  const ok = await bloqueios.remover(Number(req.params.id));
  if (!ok) return next(new ErroHttp('NAO_ENCONTRADO'));
  cache.limparTudo();
  res.status(204).end();
}));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/admin-agenda-config.test.js`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/routes/adminApi.js test/http/admin-agenda-config.test.js
git commit -m "feat(p2): /api/admin disponibilidade (meses) e bloqueios

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task G25: `src/routes/adminApi.js` parte 3 — serviços / clientes / anonimizar

**Files:**
- Modify: `src/routes/adminApi.js`
- Test: `test/http/admin-servicos-clientes.test.js`

**Interfaces:**
- Consumes: `servicos.todos`, `servicos.criar`, `servicos.atualizar`, `servicos.remover`; `query` (busca de clientes, ficha, anonimizar); `requireAdmin` (só na rota `anonimizar`).
- Produces (acrescenta a `adminApi`):
  - `GET /servicos` → `200 { servicos: [...] }` (inclui inativos).
  - `POST /servicos` `{ nome, duracao_minutos, preco, comissao_percentual }` → `201 { servico }`.
  - `PATCH /servicos/:id` campos parciais (`nome?, duracao_minutos?, preco?, comissao_percentual?, ativo?`) → `200 { servico }` ou `404`.
  - `DELETE /servicos/:id` → `200 { modo: 'hard'|'soft' }`.
  - `GET /clientes?busca?&page?` → `SELECT id, nome, celular, email, ultimo_agendamento FROM clientes WHERE ($busca IS NULL OR nome ILIKE ... OR celular LIKE ...) ORDER BY nome LIMIT 20 OFFSET ...` → `200 { itens, total, page }`.
  - `GET /clientes/:id` → ficha `{ cliente, historico: agendamentos.doCliente(id, 'historico') + futuros }` — na prática `SELECT` do cliente + `agendamentos.listar({ cliente: <celular> })`; retorna `{ cliente, agendamentos }`. `404` se não existe.
  - `POST /clientes/:id/anonimizar` — **`requireAdmin`** — `UPDATE clientes SET nome='removido', email=NULL, senha_hash=NULL, celular = 'ANON-' || id || '-' || substr(md5(random()::text),1,8) WHERE id=$1` → `200 { ok:true }`; `404` se não existe.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/admin-servicos-clientes.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}
async function barbeiro() {
  const h = await query(`INSERT INTO usuarios (nome, email, senha_hash, role) VALUES ('B','b@x.com','$2b$12$aaaaaaaaaaaaaaaaaaaaaa','barbeiro') RETURNING id`);
  // login como barbeiro: reusa o fluxo — precisamos de senha real; então setamos via seed helper:
  const { hashSenha } = await import('../../src/auth/senha.js');
  await query(`UPDATE usuarios SET senha_hash=$1 WHERE id=$2`, [await hashSenha('barbeiro123'), h.rows[0].id]);
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'b@x.com', senha: 'barbeiro123' });
  return a;
}

test('CRUD de serviços; DELETE de serviço novo é hard', async () => {
  const a = await admin();
  const cr = await a.post('/api/admin/servicos').set('Origin', ORIGIN)
    .send({ nome: 'Pezinho', duracao_minutos: 15, preco: 12, comissao_percentual: 30 });
  assert.equal(cr.status, 201);
  const id = cr.body.servico.id;
  const up = await a.patch(`/api/admin/servicos/${id}`).set('Origin', ORIGIN).send({ preco: 14 });
  assert.equal(Number(up.body.servico.preco), 14);
  const del = await a.delete(`/api/admin/servicos/${id}`).set('Origin', ORIGIN);
  assert.deepEqual(del.body, { modo: 'hard' });
});

test('busca de clientes e ficha', async () => {
  const a = await admin();
  await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana Paula','5528999990000'), ('Bruno','5528911112222')`);
  const busca = await a.get('/api/admin/clientes').query({ busca: 'ana' });
  assert.equal(busca.body.total, 1);
  const id = busca.body.itens[0].id;
  const ficha = await a.get(`/api/admin/clientes/${id}`);
  assert.equal(ficha.body.cliente.nome, 'Ana Paula');
  assert.ok(Array.isArray(ficha.body.agendamentos.itens));
});

test('anonimizar exige admin (barbeiro => 403)', async () => {
  const cliId = (await query(`INSERT INTO clientes (nome, celular) VALUES ('X','5528900000000') RETURNING id`)).rows[0].id;
  const b = await barbeiro();
  const neg = await b.post(`/api/admin/clientes/${cliId}/anonimizar`).set('Origin', ORIGIN);
  assert.equal(neg.status, 403);

  const a = await admin();
  const ok = await a.post(`/api/admin/clientes/${cliId}/anonimizar`).set('Origin', ORIGIN);
  assert.equal(ok.status, 200);
  const row = await query(`SELECT nome, celular FROM clientes WHERE id=$1`, [cliId]);
  assert.equal(row.rows[0].nome, 'removido');
  assert.match(row.rows[0].celular, /^ANON-/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/admin-servicos-clientes.test.js`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Acrescentar a `src/routes/adminApi.js`**

Imports: `import * as servicos from '../repos/servicos.js';`, `import { requireAdmin } from '../auth/middleware.js';`.

```js
adminApi.get('/servicos', rota(async (req, res) => {
  res.json({ servicos: await servicos.todos() });
}));

adminApi.post('/servicos',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100),
    duracao_minutos: z.coerce.number().int().positive(),
    preco: z.coerce.number().nonnegative(),
    comissao_percentual: z.coerce.number().min(0).max(100),
  })),
  rota(async (req, res) => {
    res.status(201).json({ servico: await servicos.criar(req.body) });
  }));

adminApi.patch('/servicos/:id',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100).optional(),
    duracao_minutos: z.coerce.number().int().positive().optional(),
    preco: z.coerce.number().nonnegative().optional(),
    comissao_percentual: z.coerce.number().min(0).max(100).optional(),
    ativo: z.boolean().optional(),
  })),
  rota(async (req, res, next) => {
    const s = await servicos.atualizar(Number(req.params.id), req.body);
    if (!s) return next(new ErroHttp('NAO_ENCONTRADO'));
    res.json({ servico: s });
  }));

adminApi.delete('/servicos/:id', rota(async (req, res, next) => {
  const s = await servicos.porId(Number(req.params.id));
  if (!s) return next(new ErroHttp('NAO_ENCONTRADO'));
  const modo = await servicos.remover(Number(req.params.id));
  res.json({ modo });
}));

adminApi.get('/clientes',
  validarQuery(z.object({ busca: z.string().optional(), page: z.coerce.number().int().positive().default(1) })),
  rota(async (req, res) => {
    const { busca, page } = req.query;
    const params = [];
    let where = '';
    if (busca) { params.push(`%${busca}%`); where = `WHERE nome ILIKE $1 OR celular LIKE $1`; }
    const tot = await query(`SELECT count(*)::int AS n FROM clientes ${where}`, params);
    params.push(20, (page - 1) * 20);
    const r = await query(
      `SELECT id, nome, celular, email, ultimo_agendamento FROM clientes ${where}
       ORDER BY nome LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ itens: r.rows, total: tot.rows[0].n, page });
  }));

adminApi.get('/clientes/:id', rota(async (req, res, next) => {
  const r = await query(
    `SELECT id, nome, celular, email, celular_verificado, created_at, ultimo_agendamento
     FROM clientes WHERE id=$1`, [Number(req.params.id)]);
  if (r.rowCount === 0) return next(new ErroHttp('NAO_ENCONTRADO'));
  const cliente = r.rows[0];
  const ags = await agendamentos.listar({ cliente: cliente.celular, page: 1 });
  res.json({ cliente, agendamentos: ags });
}));

adminApi.post('/clientes/:id/anonimizar', requireAdmin, rota(async (req, res, next) => {
  const r = await query(
    `UPDATE clientes
     SET nome='removido', email=NULL, senha_hash=NULL,
         celular = 'ANON-' || id || '-' || substr(md5(random()::text), 1, 8)
     WHERE id=$1 RETURNING id`, [Number(req.params.id)]);
  if (r.rowCount === 0) return next(new ErroHttp('NAO_ENCONTRADO'));
  res.json({ ok: true });
}));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/admin-servicos-clientes.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/routes/adminApi.js test/http/admin-servicos-clientes.test.js
git commit -m "feat(p2): /api/admin servicos (CRUD), clientes (busca/ficha), anonimizar

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task G26: `src/routes/adminApi.js` parte 4 — comissões / configuração / templates / mensagens

**Files:**
- Modify: `src/routes/adminApi.js`
- Test: `test/http/admin-relatorios.test.js`

**Interfaces:**
- Consumes: `comissoes.relatorio`; `configuracao.obter`, `configuracao.atualizar`; `templates.todos`, `templates.atualizar`; `mensagens.listar`, `mensagens.enfileirar`; `templates.porChave` + `renderizarTemplate` + `agendamentos.porId`; `processarPendentes`; `limiteMensagens` de `src/auth/rateLimit.js`; `requireAdmin`.
- Produces (acrescenta a `adminApi`):
  - `GET /comissoes?ano&mes&barbeiro_id?` → `200 { linhas, total }`.
  - `GET /configuracao` → `200` (de `configuracao.obter()`).
  - `PUT /configuracao` — **`requireAdmin`** — `{ ...campos, expediente?: [{ dia_semana, aberto, abre, fecha }] }` → `configuracao.atualizar(campos, expediente)` + `cache.limparTudo()` → `200` (nova config).
  - `GET /templates` → `200 { templates: [...] }`.
  - `PUT /templates/:chave` `{ titulo, corpo, ativo }` → `200 { template }` ou `404`.
  - `GET /mensagens?agendamento_id?&status?&page?` → `200 { itens, total, page }`.
  - `POST /mensagens/enviar` — `limiteMensagens` — `{ agendamento_id, template_chave }` → carrega `agendamentos.porId` (`404`), `templates.porChave` (`404`), renderiza, `mensagens.enfileirar`, `await processarPendentes({ limite: 5 })` → `202 { mensagem }` (a `mensagem` já com `status_envio` atualizado — recarrega via `mensagens.listar({ agendamento_id })` pega a 1ª, ou devolve o row do `enfileirar` + refetch).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/admin-relatorios.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function admin() {
  const a = request.agent(buildApp());
  await a.post('/api/auth/admin/login').set('Origin', ORIGIN).send({ email: 'dono@teste.local', senha: 'teste123456' });
  return a;
}

test('GET /comissoes agrupa concluídos do mês', async () => {
  const a = await admin();
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, preco, comissao_percentual FROM servicos WHERE nome='Corte'`)).rows[0];
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5511') RETURNING id`)).rows[0].id;
  for (const dia of ['05', '06']) {
    await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total, comissao_valor)
      VALUES ($1,$2,$3,$4,'09:00','09:35','concluido',$5,$6)`, [cli, s.id, b, `2026-09-${dia}`, s.preco, s.preco * s.comissao_percentual / 100]);
  }
  const r = await a.get('/api/admin/comissoes').query({ ano: 2026, mes: 9 });
  assert.equal(r.body.linhas[0].qtd, 2);
  assert.equal(Number(r.body.total.comissao), 45);
});

test('PUT /configuracao muda a grade (intervalo) e exige admin', async () => {
  const a = await admin();
  const cfg = await a.get('/api/admin/configuracao');
  const put = await a.put('/api/admin/configuracao').set('Origin', ORIGIN)
    .send({ intervalo_minutos: 20, expediente: cfg.body.expediente });
  assert.equal(put.status, 200);
  assert.equal(put.body.intervalo_minutos, 20);

  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const h = await request(buildApp()).get('/api/agenda/horarios').query({ data: '2026-09-10', servico_id: s });
  assert.ok(h.body.horarios.includes('09:20'));
});

test('PUT /templates/:chave e POST /mensagens/enviar => enfileira e worker resolve', async () => {
  const a = await admin();
  const t = await a.put('/api/admin/templates/confirmacao').set('Origin', ORIGIN)
    .send({ titulo: 'Conf', corpo: 'Oi {{nome_cliente}}', ativo: true });
  assert.equal(t.body.template.corpo, 'Oi {{nome_cliente}}');

  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const ag = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','confirmado',10) RETURNING id`, [cli, s, b])).rows[0].id;

  const env = await a.post('/api/admin/mensagens/enviar').set('Origin', ORIGIN)
    .send({ agendamento_id: ag, template_chave: 'confirmacao' });
  assert.equal(env.status, 202);
  const lst = await a.get('/api/admin/mensagens').query({ agendamento_id: ag });
  assert.equal(lst.body.itens[0].status_envio, 'simulado');
  assert.match(lst.body.itens[0].mensagem_final, /Ana/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/admin-relatorios.test.js`
Expected: FAIL (rotas não existem).

- [ ] **Step 3: Acrescentar a `src/routes/adminApi.js`**

Imports: `import * as comissoes from '../repos/comissoes.js';`, `import * as configuracao from '../repos/configuracao.js';`, `import { limiteMensagens } from '../auth/rateLimit.js';`.

```js
adminApi.get('/comissoes',
  validarQuery(z.object({
    ano: z.coerce.number().int(), mes: z.coerce.number().int().min(1).max(12),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    res.json(await comissoes.relatorio({ ano: req.query.ano, mes: req.query.mes, barbeiroId: req.query.barbeiro_id ?? null }));
  }));

adminApi.get('/configuracao', rota(async (req, res) => {
  res.json(await configuracao.obter());
}));

adminApi.put('/configuracao', requireAdmin,
  validarCorpo(z.object({
    nome_barbearia: z.string().max(120).optional(),
    endereco: z.string().optional(),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
    telefone_whatsapp: z.string().max(20).optional(),
    intervalo_minutos: z.coerce.number().int().positive().optional(),
    antecedencia_min_horas: z.coerce.number().int().nonnegative().optional(),
    limite_dias_futuros: z.coerce.number().int().positive().optional(),
    expediente: z.array(z.object({
      dia_semana: z.number().int().min(0).max(6),
      aberto: z.boolean(),
      abre: z.string(),
      fecha: z.string(),
    })).length(7).optional(),
  })),
  rota(async (req, res) => {
    const { expediente, ...campos } = req.body;
    const nova = await configuracao.atualizar(campos, expediente);
    cache.limparTudo();
    res.json(nova);
  }));

adminApi.get('/templates', rota(async (req, res) => {
  res.json({ templates: await templates.todos() });
}));

adminApi.put('/templates/:chave',
  validarCorpo(z.object({ titulo: z.string().min(1).max(100), corpo: z.string().min(1), ativo: z.boolean() })),
  rota(async (req, res, next) => {
    const t = await templates.atualizar(req.params.chave, req.body);
    if (!t) return next(new ErroHttp('NAO_ENCONTRADO'));
    res.json({ template: t });
  }));

adminApi.get('/mensagens',
  validarQuery(z.object({
    agendamento_id: z.coerce.number().int().positive().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  })),
  rota(async (req, res) => {
    res.json(await mensagens.listar(req.query));
  }));

adminApi.post('/mensagens/enviar', limiteMensagens,
  validarCorpo(z.object({
    agendamento_id: z.coerce.number().int().positive(),
    template_chave: z.string().min(1),
  })),
  rota(async (req, res, next) => {
    const item = await agendamentos.porId(req.body.agendamento_id);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    await enfileirarTemplate(item, req.body.template_chave); // 404 silencioso se template inativo/ausente
    const tpl = await templates.porChave(req.body.template_chave);
    if (!tpl) return next(new ErroHttp('NAO_ENCONTRADO'));
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    const lst = await mensagens.listar({ agendamento_id: item.id, page: 1 });
    res.status(202).json({ mensagem: lst.itens[0] });
  }));
```

> Ajuste em `enfileirarTemplate` (Task G23): quando `tpl` for `null`/inativo a função retorna sem lançar; a rota `POST /mensagens/enviar` checa `templates.porChave` logo depois e devolve `404` se não existir. Se existir mas inativo, o enfileiramento é pulado e a resposta traz a última mensagem existente (ou `undefined` → `202 { mensagem: null }`). Documente esse caso no teste apenas se quiser; o teste dado usa um template ativo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/http/admin-relatorios.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Rodar a suíte inteira**

Run: `npm test`
Expected: verde.

- [ ] **Step 6: Commit**

```bash
git add src/routes/adminApi.js test/http/admin-relatorios.test.js
git commit -m "feat(p2): /api/admin comissoes, configuracao, templates, mensagens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task G27: `src/routes/webhooks.js` — `/webhooks/whatsapp`

**Files:**
- Create: `src/routes/webhooks.js`
- Modify: `src/app.js` (`buildApp`: montar `webhooks` **antes** do `express.json` global, com `express.raw`)
- Test: `test/http/webhook.test.js`

**Interfaces:**
- Consumes: `express`; `config`; `query`; `crypto` (`node:crypto`); `cancelarAgendamento` de `src/agenda/agendar.js`; `emitir*`; `cache.invalidarData`.
- Produces: `webhooks` (`express.Router()` montado em `/webhooks`):
  - `GET /whatsapp` — se `config.WHATSAPP_VERIFY_TOKEN` vazio → `404`. Senão: `req.query['hub.mode']==='subscribe'` **e** `req.query['hub.verify_token']===config.WHATSAPP_VERIFY_TOKEN` → `200` com `req.query['hub.challenge']` (texto cru); senão `403`.
  - `POST /whatsapp` — corpo **raw** (`express.raw({ type: '*/*' })` neste router). Se `config.WHATSAPP_APP_SECRET` setado: valida `X-Hub-Signature-256` (`'sha256=' + hmac(secret, rawBody)`), incompatível → `403`. Parse do JSON (`JSON.parse(req.body)`); processa `entry[].changes[].value.statuses[]` (atualiza `mensagens_whatsapp` por `wamid` — coluna nova? **não**: guardamos `wamid` só no envio real; no P2 stub não há `wamid`, então statuses são ignorados com log) e `messages[]` com `text.body ∈ {SIM, NAO, NÃO}` → acha o agendamento ativo mais recente do `from` e cancela (NAO) ou confirma (SIM); emite eventos + invalida cache. Sempre responde `200` (a Meta re-tenta em não-2xx).
- **Nota de ordem em `app.js`:** o `app.use('/webhooks', webhooks)` vai **antes** de `app.use(express.json(...))` para o `express.raw` do router pegar o corpo cru.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/http/webhook.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { config } from '../../src/config.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

test('GET /webhooks/whatsapp: 404 sem verify token configurado', async () => {
  assert.equal(config.WHATSAPP_VERIFY_TOKEN, '');
  const res = await request(buildApp()).get('/webhooks/whatsapp')
    .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '123' });
  assert.equal(res.status, 404);
});

test('POST /webhooks/whatsapp: resposta SIM confirma o agendamento pendente do celular', async () => {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5528999990000') RETURNING id`)).rows[0].id;
  const ag = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','pendente',10) RETURNING id`, [cli, s, b])).rows[0].id;

  const payload = {
    entry: [{ changes: [{ value: { messages: [{ from: '5528999990000', text: { body: 'SIM' } }] } }] }],
  };
  const res = await request(buildApp()).post('/webhooks/whatsapp')
    .set('content-type', 'application/json').send(JSON.stringify(payload));
  assert.equal(res.status, 200);
  const row = await query(`SELECT status FROM agendamentos WHERE id=$1`, [ag]);
  assert.equal(row.rows[0].status, 'confirmado');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/http/webhook.test.js`
Expected: FAIL (rota não montada).

- [ ] **Step 3: Implementar `src/routes/webhooks.js`**

```js
// src/routes/webhooks.js
import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { cancelarAgendamento } from '../agenda/agendar.js';
import { emitirAgendaAtualizada, emitirAgendamentoAtualizado, emitirDashboardTick } from '../realtime/emitir.js';
import * as agendamentos from '../repos/agendamentos.js';
import * as cache from '../agenda/cache.js';

export const webhooks = express.Router();

webhooks.get('/whatsapp', (req, res) => {
  if (!config.WHATSAPP_VERIFY_TOKEN) return res.sendStatus(404);
  if (req.query['hub.mode'] === 'subscribe'
    && req.query['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

webhooks.post('/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  if (config.WHATSAPP_APP_SECRET) {
    const esperado = 'sha256=' + crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(raw).digest('hex');
    const recebido = req.get('x-hub-signature-256') ?? '';
    if (recebido.length !== esperado.length
      || !crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(esperado))) {
      return res.sendStatus(403);
    }
  }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(200); }

  const mudancas = payload.entry?.flatMap((e) => e.changes ?? []) ?? [];
  for (const ch of mudancas) {
    for (const m of ch.value?.messages ?? []) {
      const texto = m.text?.body?.trim().toUpperCase();
      if (!['SIM', 'NAO', 'NÃO'].includes(texto)) continue;
      const r = await query(
        `SELECT id, data_agendamento FROM agendamentos
         WHERE cliente_id = (SELECT id FROM clientes WHERE celular=$1)
           AND status IN ('pendente','confirmado')
         ORDER BY created_at DESC LIMIT 1`, [m.from]);
      const ag = r.rows[0];
      if (!ag) continue;
      if (texto === 'SIM') {
        await query(`UPDATE agendamentos SET status='confirmado', updated_at=now() WHERE id=$1`, [ag.id]);
        emitirAgendamentoAtualizado(req.io, { id: ag.id, status: 'confirmado' });
      } else {
        await cancelarAgendamento(ag.id, { motivo: 'cancelado via WhatsApp' });
        emitirAgendamentoAtualizado(req.io, { id: ag.id, status: 'cancelado' });
      }
      emitirAgendaAtualizada(req.io, { data: ag.data_agendamento });
      emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
      cache.invalidarData(ag.data_agendamento);
    }
  }
  res.sendStatus(200);
});
```

- [ ] **Step 4: Montar em `src/app.js`**

No topo: `import { webhooks } from './routes/webhooks.js';`. Em `buildApp`, **antes** de `app.use(express.json({ limit: '100kb' }));`:

```js
  app.use('/webhooks', (req, res, next) => { req.io = io; next(); }, webhooks);
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/http/webhook.test.js`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/webhooks.js src/app.js test/http/webhook.test.js
git commit -m "feat(p2): webhook /webhooks/whatsapp (verify handshake + SIM/NAO)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task I28: `src/server.js` — HTTP + Socket.io + cron + shutdown, e teste de tempo real ponta a ponta

**Files:**
- Create: `src/server.js`
- Test: `test/realtime/fluxo.test.js`

**Interfaces:**
- Consumes: `node:http`; `buildApp` de `src/app.js`; `criarSessaoMiddleware` de `src/auth/sessao.js`; `criarIo` de `src/realtime/io.js`; `limparExpirados` de `src/agenda/locks.js`; `processarPendentes` de `src/services/mensageiro.js`; `emitirHorarioLiberado` de `src/realtime/emitir.js`; `node-cron`; `config`; `fecharPool` de `src/db/pool.js`.
- Produces:
  - `criarServidor() => { app, server, io, parar }` — monta `sessaoMw = criarSessaoMiddleware()`; `server = http.createServer()`; `io = criarIo(server, sessaoMw)`; `app = buildApp({ io })`; `server.on('request', app)`; agenda dois cron jobs (`* * * * *`): (1) `const { removidos, datas } = await limparExpiradosComDatas()` → para cada `{ data, horario }` removido, `emitirHorarioLiberado(io, ...)`; (2) `processarPendentes()`. `parar()` — para os cron tasks, `io.close()`, `server.close()`, `fecharPool()`.
  - **Extensão mínima de `src/agenda/locks.js`:** `limparExpirados()` passa a retornar `{ removidos, itens: [{ data, horario, barbeiro_id }] }` (usar `DELETE ... RETURNING to_char(data,'YYYY-MM-DD') AS data, to_char(horario,'HH24:MI') AS horario, barbeiro_id`). O teste do P1 (`locks.test.js`) só checa `.removidos` — continua verde. Ajustar o objeto: `return { removidos: res.rowCount, itens: res.rows };`.
  - Ao final do arquivo, se `import.meta.url` corresponde ao entrypoint (`process.argv[1]`), chama `criarServidor()` e `server.listen(config.PORT, () => console.log('barbearia ouvindo em', config.PORT))`, e registra `process.on('SIGTERM'|'SIGINT', () => parar().then(() => process.exit(0)))`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/realtime/fluxo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { io as Client } from 'socket.io-client';
import { criarServidor } from '../../src/server.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { EVENTOS } from '../../src/realtime/emitir.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
});

test('confirmar por HTTP dispara agenda_atualizada no socket da data', async () => {
  const { server, io, parar } = criarServidor();
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;

  const socket = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => socket.on('connect', r));
  socket.emit('entrar_agenda', { data: '2026-09-10' });
  await new Promise((r) => setTimeout(r, 60));

  const recebido = new Promise((r) => socket.once(EVENTOS.AGENDA_ATUALIZADA, r));

  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const agent = request.agent(server);
  await agent.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'Ana', celular: '28999990000', consentimento: true });
  const conf = await agent.post('/api/agenda/confirmar').set('Origin', ORIGIN).send({ servico_id: s, data: '2026-09-10', horario: '09:00' });
  assert.equal(conf.status, 201);

  assert.deepEqual(await recebido, { data: '2026-09-10' });

  socket.close();
  await parar();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/realtime/fluxo.test.js`
Expected: FAIL (`src/server.js` não encontrado).

- [ ] **Step 3: Estender `src/agenda/locks.js`**

Trocar `limparExpirados` por:

```js
export async function limparExpirados() {
  const res = await query(
    `DELETE FROM horarios_lock WHERE expira_em < now()
     RETURNING to_char(data,'YYYY-MM-DD') AS data, to_char(horario,'HH24:MI') AS horario, barbeiro_id`);
  return { removidos: res.rowCount, itens: res.rows };
}
```

- [ ] **Step 4: Implementar `src/server.js`**

```js
// src/server.js
import http from 'node:http';
import cron from 'node-cron';
import { config } from './config.js';
import { buildApp } from './app.js';
import { criarSessaoMiddleware } from './auth/sessao.js';
import { criarIo } from './realtime/io.js';
import { emitirHorarioLiberado } from './realtime/emitir.js';
import { limparExpirados } from './agenda/locks.js';
import { processarPendentes } from './services/mensageiro.js';
import { fecharPool } from './db/pool.js';
import * as cache from './agenda/cache.js';

export function criarServidor() {
  const sessaoMw = criarSessaoMiddleware();
  const server = http.createServer();
  const io = criarIo(server, sessaoMw);
  const app = buildApp({ io });
  server.on('request', app);

  const jobLocks = cron.schedule('* * * * *', async () => {
    try {
      const { itens } = await limparExpirados();
      for (const it of itens) {
        emitirHorarioLiberado(io, { data: it.data, horario: it.horario });
        cache.invalidarData(it.data);
      }
    } catch (e) { console.error('cron limparExpirados', e); }
  });

  const jobMsgs = cron.schedule('* * * * *', async () => {
    try { await processarPendentes(); } catch (e) { console.error('cron mensageiro', e); }
  });

  async function parar() {
    jobLocks.stop();
    jobMsgs.stop();
    await new Promise((r) => io.close(r));
    await new Promise((r) => server.close(r));
    await fecharPool();
  }

  return { app, server, io, parar };
}

const ehEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (ehEntrypoint) {
  const { server, parar } = criarServidor();
  server.listen(config.PORT, () => console.log('barbearia ouvindo em', config.PORT));
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => parar().then(() => process.exit(0)));
  }
}
```

> O check `ehEntrypoint` é frágil no Windows com backslash; para robustez, o subagente pode usar o pacote `es-main` OU comparar `import.meta.url` normalizado. Como os testes importam `criarServidor` (nunca executam como entrypoint), o bloco `if` não roda nos testes de qualquer forma — a fragilidade só afeta `npm start`, coberto no P4.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/realtime/fluxo.test.js test/agenda/locks.test.js`
Expected: PASS (fluxo 1; locks P1 6 — continuam verdes).

- [ ] **Step 6: Commit**

```bash
git add src/server.js src/agenda/locks.js test/realtime/fluxo.test.js
git commit -m "feat(p2): server.js (HTTP + Socket.io + cron) e limparExpirados retornando itens

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task J29: README do P2, `.env.example` final e suíte completa

**Files:**
- Modify: `README.md`
- Test: — (roda a suíte inteira)

**Interfaces:**
- Consumes: tudo.
- Produces: `README.md` com a seção do servidor P2; confirmação de `npm test` inteiro verde.

- [ ] **Step 1: Editar `README.md`**

Acrescentar após a seção "O que existe no P1":

````markdown
## P2 — servidor HTTP + tempo real

```bash
npm start            # sobe Express + Socket.io + cron na porta de PORT (.env)
npm run dev          # idem com --watch
```

### Rotas (resumo)
- **Pública** `/api/agenda/*`: `servicos`, `dias`, `horarios`, `lock`/`renovar`/`liberar`,
  `cadastro`, `confirmar`. `/api/auth/*`: `admin/login`, `cliente/login`, `logout`.
  `/healthz`. `/webhooks/whatsapp`.
- **Cliente** `/api/cliente/*` (sessão de cliente): `me`, `agendamentos`, `:id/cancelar`, `:id/remarcar`.
- **Admin** `/api/admin/*` (sessão de equipe; algumas exigem `role=admin`):
  `dashboard`, `agendamentos` (listar / `:id/status` / criar), `disponibilidade`,
  `bloqueios`, `servicos`, `clientes` (+ `:id/anonimizar`), `comissoes`,
  `configuracao`, `templates`, `mensagens` (+ `/enviar`).

### Tempo real (Socket.io, mesmo servidor)
Salas `agenda:<YYYY-MM-DD>` (cliente emite `entrar_agenda`/`sair_agenda`) e `admin`
(automático para sessão de equipe). Eventos: `horario_reservado`,
`horario_liberado`, `agenda_atualizada`, `novo_agendamento`,
`agendamento_atualizado`, `dashboard_tick`.

### Sessão e segurança
Sessão em Postgres (`connect-pg-simple`, schema-aware). Cookie `httpOnly` +
`sameSite=lax` + `secure` em produção. `exigirOrigemConfiavel` em toda rota
mutadora. Rate limit no login (5/15min) e no envio de mensagens (30/5min).
`logs_acesso` em toda tentativa de login.

### Integrações (stub no P2)
- **WhatsApp:** sem `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` → driver `simulado`
  (grava `status_envio='simulado'`). Com ambos → driver `meta` (Cloud API).
  Webhook: `GET /webhooks/whatsapp` faz o handshake se `WHATSAPP_VERIFY_TOKEN`
  estiver setado; `POST` valida `X-Hub-Signature-256` se `WHATSAPP_APP_SECRET`.
- **SMS/OTP:** `src/services/sms.js` pronto em modo simulado (código `000000`);
  não há rota de OTP no P2.
- **Mapa:** `src/services/mapa.js` — Google Embed com `GOOGLE_MAPS_API_KEY`,
  senão OpenStreetMap.

### Novas variáveis (.env)
`ORIGENS_PERMITIDAS` (CSV), `COOKIE_SECURE` (`1` força secure), `WHATSAPP_APP_SECRET`,
`LOG_LEVEL`. `SESSION_SECRET` deve ter ≥32 chars em produção.

## Fora do P2 (P3/P4)
Frontend (EJS/CSS/Alpine), páginas `/`, `/agendar`, `/minha-conta`, `/privacidade`;
`DEPLOY.md` + Render + CI; CSRF por token; export PDF/Excel; OTP no cadastro;
driver real da WhatsApp Cloud API exercitado com credencial.
````

- [ ] **Step 2: Verificar `.env.example`**

Conferir que `.env.example` contém (da Task A1): `ORIGENS_PERMITIDAS=`, `COOKIE_SECURE=`,
`WHATSAPP_APP_SECRET=`, `LOG_LEVEL=info`. Se faltar, acrescentar.

- [ ] **Step 3: Rodar a suíte inteira 3×**

Run: `npm test` (três vezes seguidas)
Expected: PASS todas as vezes — anotar o total de testes. Os testes de tempo real
sobem servidores efêmeros em série (`--test-concurrency=1`), sem vazar handle.

- [ ] **Step 4: `npm run db:reset`**

Run: `npm run db:reset`
Expected: "banco recriado e semeado", exit 0 (schema `public`; agora com a tabela `session`).

- [ ] **Step 5: Fumaça do `npm start`**

Run:
```bash
node --env-file=.env src/server.js &
sleep 2
curl -s http://localhost:3000/healthz
kill %1
```
Expected: `{"ok":true,"db":true}`.

- [ ] **Step 6: Commit**

```bash
git add README.md .env.example
git commit -m "docs(p2): README do servidor HTTP + tempo real; suíte completa verde

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Cobertura da spec P2:**

| Seção da spec | Task |
|---|---|
| §2 estrutura de arquivos | distribuída — cada arquivo tem sua task |
| §3 dependências + scripts | A1 |
| §4 `app.js` vs `server.js` | A6 (`buildApp` + `montarRotas`), I28 (`server.js` + cron + shutdown) |
| §5.1 store de sessão (schema-aware) | B8 (migração), B9 (`criarSessaoMiddleware`) |
| §5.2 duas faces + sessão anônima | B10 (`anexarSessaoAnonima`, middlewares), B12 (grava `clienteId`/`usuarioId`) |
| §5.3 middlewares + expiração 12h da equipe | B10, B12 (`equipeExpiraEm`) |
| §5.4 senha | B7 |
| §5.5 rate limiting + logs | B11 (`limiteLogin`/`limiteMensagens`, `logs`), B12 (aplicação + gravação) |
| §6.1 `validarCorpo`/`validarQuery` | A3 |
| §6.2 `mapaErroHttp` + `fechado` não é erro | A2 (`mapaErroHttp`), E19 (`horarios` devolve `fechado` MAIÚSCULO em 200) |
| §6.3 `rota()` | A2 |
| §7.1 `criarIo` + salas por sessão | C14 |
| §7.2 `eventos` | C13 |
| §7.3 `emitir*` (6) | C13 |
| §7.4 invalidação de cache por rota | E20 (lock/liberar), E21 (confirmar), F22 (cancelar/remarcar), G23 (status/manual), G24 (`limparTudo` em mês/bloqueio), G26 (`limparTudo` em config) |
| §8.1 rotas públicas | A6 (`healthz`), B12 (`auth`), E19–E21 |
| §8.2 rotas de cliente | F22 |
| §8.3 rotas de admin (tabela inteira) | G23 (dashboard/agendamentos/status/manual), G24 (meses/bloqueios), G25 (servicos/clientes/anonimizar), G26 (comissoes/config/templates/mensagens) |
| §8.4 ordem canônica | E19→E20→E21 encadeadas; worker em E21 |
| §9 worker + `whatsapp`/`sms` | H15 (whatsapp + mensageiro), H16 (sms + mapa) |
| §10 webhook (GET handshake, POST assinatura + SIM/NÃO) | G27 |
| §11 acréscimos no `config` | A1 |
| §12 segurança | B7/B9/B10/B11 + A4 (`exigirOrigemConfiavel`) + `helmet` em A6 + anonimizar em G25 |
| §13 estratégia de testes | cada task tem seus testes; fluxo ponta a ponta em I28 |
| §14 impacto no P1 | B7 (seed usa `hashSenha`), B8 (migração 002), A1 (`package.json`), E20/I28 (extensões mínimas de `locks.js` — testes do P1 seguem verdes) |

Sem lacunas.

**2. Placeholders:** nenhum "TBD/TODO" de implementação. As duas notas de fragilidade
(check de entrypoint no Windows em I28; template inativo em G26) trazem o caminho
concreto e não bloqueiam a task. O teste de "fora do prazo" em F22 tem um fallback
explícito (insere direto se o `confirmar` recusar) — não é placeholder, é robustez.

**3. Consistência de tipos/nomes:**
- `rota`, `ErroHttp`, `mapaErroHttp`, `respostaDeErro`, `errorHandler` (A2) usados igual em todas as rotas.
- `validarCorpo`/`validarQuery` (A3) — assinatura `(schema) => middleware` estável.
- `buildApp({ io })` (A6) e `montarRotas(app)` — as tasks de rota editam só `montarRotas` e (G27) a ordem do `express.json`.
- `criarSessaoMiddleware()` (B9) consumido por A6 (fiação) e I28 (`criarServidor`).
- `requireCliente`/`requireEquipe`/`requireAdmin`/`anexarSessaoAnonima` (B10) — nomes idênticos em app.js e nas rotas.
- `EVENTOS` + `emitir*` (C13) — 6 funções, mesmos nomes em E20/E21/F22/G23/G27/I28.
- `criarIo(httpServer, sessaoMw)` / `getIo()` (C14) — usados em I28.
- `processarPendentes({ limite })` (H15) — chamado em E21, G23, G26, I28.
- repos: `servicos.*`, `clientes.*`, `logs.*`, `agendamentos.*`, `comissoes.relatorio`, `templates.*`, `mensagens.*`, `disponibilidadeMeses.*`, `bloqueios.*`, `configuracao.*` — cada assinatura definida na sua task D/B e consumida com o mesmo shape nas rotas.
- `confirmarAgendamento`/`cancelarAgendamento`/`remarcarAgendamento` e `horariosDisponiveis`/`criarLock`/`renovarLock`/`liberarLock`/`limparExpirados` vêm do P1; as extensões (E20: `expira_em` no retorno; I28: `itens` no `limparExpirados`) são aditivas e os testes do P1 (`test/agenda/locks.test.js`) só checam `.ok`/`.removidos`.
- `normalizarCelular` (A5) — E21, F22 (login), G23, G25, B12.
- `datas.hoje/inicioDoMes/fimDoMes/ehData` (A5) — repos D18, comissões, rotas E19/E21/F22.
