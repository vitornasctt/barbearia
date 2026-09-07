# P4 — Deploy + Docs + CI (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the barbershop system deploy-ready: self-applying migrations + seed on boot, a Postgres-isolated CI pipeline, deploy/API/WhatsApp-template docs, the last missing admin screen (manual booking), and two small DB/boot hardening items carried from P2/P3.

**Architecture:** No new runtime subsystems. `npm start` gains a boot step (`src/bootstrap.js` → `migrar()` + idempotent `semear()`) invoked only from the `server.js` entrypoint. One forward-only migration (`004`). One admin UI screen wired to the already-built `POST /api/admin/agendamentos`. The rest is CI YAML and Markdown docs.

**Tech Stack:** Node 24 (ESM), Express 4, PostgreSQL ≥ 15, `node:test`, GitHub Actions, EJS + Alpine (existing).

**Spec:** `docs/superpowers/specs/2026-09-07-p4-deploy-docs-ci-design.md` (parent: `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` §9–§13)

## Global Constraints

- **Runtime:** Node ≥ 20 (dev machine 24); ESM only (`import`, never `require`); `.js` on every relative import.
- **Tests:** `node:test` only, via `npm test` = `node --env-file=.env --env-file=.env.test --test --test-concurrency=1`. Never add another runner. Keep `--test-concurrency=1` (all test files share one Postgres `test` schema and TRUNCATE in setup).
- **DB isolation:** tests connect with `search_path=<TEST_SCHEMA>` (default `test`); never `CREATE DATABASE`. Migrations are forward-only, one `.sql` file per migration under `src/db/migrations/`, applied in filename sort order inside a transaction by `src/db/migrate.js`. `migrar()` and `semear()` are idempotent.
- **PostgreSQL ≥ 15** is required (`UNIQUE NULLS NOT DISTINCT`). Supabase is 17; CI uses `postgres:17`; DEPLOY.md must state ≥ 15 for the VPS path.
- **Do NOT modify:** `src/app.js`, `src/agenda/*`, `src/services/*`, `src/repos/*` (except a repo may be READ), `src/routes/*Api.js` route logic, `src/routes/webhooks.js`. `POST /api/admin/agendamentos` already exists — consume it, don't touch it.
- **Client JS (Ruling P1, inherited from P3):** any module under `src/public/js/**` wraps top-level `window`/`document` access in `if (typeof window !== 'undefined') { ... }`; pure exports stay plain.
- **Error contract:** `{ erro: 'CODIGO' }` (+ `campos` for `VALIDACAO`); `src/http/erros.js` `mapaErroHttp` maps codes to HTTP status.
- **Commit trailer** on every commit, exactly:
  ```
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/bootstrap.js` | `inicializar({ semear })` — run `migrar()` then optionally `semear()`; called by the `server.js` entrypoint only |
| `src/db/migrations/004_meses_nulls_not_distinct.sql` | replace `disponibilidade_meses` unique constraint with a `NULLS NOT DISTINCT` version |
| `.github/workflows/ci.yml` | CI: Node 24 + `postgres:17` service + `npm ci` + `npm test` |
| `docs/DEPLOY.md` | Render (primary) + VPS (parallel) deploy guide |
| `docs/API.md` | route + Socket.io event reference |
| `docs/whatsapp-templates.md` | the 3 seed templates in Meta Template-Manager submission format |
| `test/boot/bootstrap.test.js` | `inicializar()` applies migrations and (when asked) seed, idempotently |
| `test/db/migrate-004.test.js` | the new constraint exists and rejects a duplicate `barbeiro_id NULL` row |
| `test/http/admin-novo-agendamento.test.js` | `POST /api/admin/agendamentos` via the screen: new client, existing client, 409 on taken slot |
| `test/config/env-example.test.js` | every `.env.example` / `.env.test.example` key parses via `carregarConfig`; every schema field is documented |
| `test/services/templates-meta.test.js` | the 3 seed templates use only the 6 known variables and render with no leftover `{{…}}` |
| `test/auth/cookie-secure.test.js` | session cookie `secure` flag follows `NODE_ENV` / `COOKIE_SECURE` |

**Modified:**

| Path | Change |
|---|---|
| `src/server.js` | entrypoint block (`if (ehEntrypoint)`) awaits `inicializar({ semear: true })` before `server.listen`; `criarServidor()` unchanged |
| `src/views/admin/agendamentos.ejs` | + "Novo agendamento" collapsible form (Alpine) |
| `src/public/js/admin/agendamentos.js` | + form state + methods (client search, dias, horarios, submit) inside `painelAgendamentos()` |
| `.env.example`, `.env.test.example` | regroup + comment; nothing removed |
| `README.md` | rewritten for the whole P1–P4 system |
| `package.json` | (optional) add `"db:setup"` script; no change to `start`/`test` |

---

## Task 1: Boot-time migrate + seed

**Files:**
- Create: `src/bootstrap.js`
- Modify: `src/server.js` (entrypoint block only)
- Test: `test/boot/bootstrap.test.js`

**Interfaces:**
- Consumes: `migrar({ silent })` from `src/db/migrate.js`; `semear(exec?)` from `src/db/seed.js`.
- Produces: `export async function inicializar({ semear?: boolean } = {}): Promise<void>` — awaits `migrar({ silent: false })`, then `await semear()` iff `semear === true`. No return value; throws on migration failure.

- [ ] **Step 1: Write the failing test**

```js
// test/boot/bootstrap.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inicializar } from '../../src/bootstrap.js';
import { query } from '../../src/db/pool.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('inicializar() aplica migrações — schema_migrations tem as 4', async () => {
  await inicializar();
  const { rows } = await query('SELECT nome FROM schema_migrations ORDER BY nome');
  const nomes = rows.map((r) => r.nome);
  assert.ok(nomes.includes('001_init.sql'));
  assert.ok(nomes.includes('004_meses_nulls_not_distinct.sql'));
});

test('inicializar({ semear: true }) popula e é idempotente', async () => {
  await inicializar({ semear: true });
  await inicializar({ semear: true }); // segunda vez não pode lançar nem duplicar
  const s = await query(`SELECT count(*)::int n FROM servicos`);
  const c = await query(`SELECT count(*)::int n FROM configuracao`);
  assert.equal(c.rows[0].n, 1);
  assert.ok(s.rows[0].n >= 3);
});

test('inicializar() sem semear não exige seed', async () => {
  await inicializar(); // não deve tocar em servicos/configuracao além do que a migração faz
  assert.ok(true);
});
```

> `prepararBanco` (in `test/helpers/db.js`) already TRUNCATEs + seeds the `test` schema; these tests then re-run `migrar`/`semear` on top, which must be safe. If `prepararBanco` drops `schema_migrations`, the first assertion still holds because `inicializar()` re-applies. Confirm `test/helpers/db.js` does not TRUNCATE `schema_migrations` in a way that breaks this; if it does, the test for migration presence can instead assert the `disponibilidade_meses` constraint name (see Task 2) is present after `inicializar()`.

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- test/boot/bootstrap.test.js`
Expected: `Cannot find module '../../src/bootstrap.js'`.

- [ ] **Step 3: Create `src/bootstrap.js`**

```js
// src/bootstrap.js
import { migrar } from './db/migrate.js';
import { semear } from './db/seed.js';

export async function inicializar({ semear: comSeed = false } = {}) {
  await migrar({ silent: false });
  if (comSeed) await semear();
}
```

- [ ] **Step 4: Wire the `server.js` entrypoint**

In `src/server.js`, the entrypoint block is currently:

```js
const ehEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (ehEntrypoint) {
  const { server, parar } = criarServidor();
  server.listen(config.PORT, () => console.log('barbearia ouvindo em', config.PORT));
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => parar().then(() => process.exit(0)));
  }
}
```

Change it to (top-level `await` is allowed in an ESM module):

```js
const ehEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (ehEntrypoint) {
  const { inicializar } = await import('./bootstrap.js');
  await inicializar({ semear: true });
  const { server, parar } = criarServidor();
  server.listen(config.PORT, () => console.log('barbearia ouvindo em', config.PORT));
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => parar().then(() => process.exit(0)));
  }
}
```

Do NOT put `inicializar()` inside `criarServidor()` — `test/realtime/fluxo.test.js` calls `criarServidor()` and must not pay migrate/seed per run.

- [ ] **Step 5: Run the test — expect PASS**

Run: `npm test -- test/boot/bootstrap.test.js`
(Task 1 runs before Task 2 exists, so `004_*.sql` is absent — adjust Step 1's first test to assert only `001_init.sql` for now, and add the `004` assertion in Task 2's step that touches this file. OR implement Task 2 first. Recommended: **do Task 2 before Task 1's final test run** — they're independent creates; run Task 1 Steps 1-4, then Task 2, then re-run both test files.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: 183 + 3 new = 186 pass, 0 fail.

- [ ] **Step 7: Commit**

```bash
git add src/bootstrap.js src/server.js test/boot/bootstrap.test.js
git commit -m "feat(p4): boot aplica migrações + seed idempotente (inicializar)"
```

---

## Task 2: Migration 004 — `UNIQUE NULLS NOT DISTINCT` on `disponibilidade_meses`

**Files:**
- Create: `src/db/migrations/004_meses_nulls_not_distinct.sql`
- Test: `test/db/migrate-004.test.js`

**Interfaces:**
- Consumes: `migrar()` (runs it), `withTransaction`/`query` from `src/db/pool.js`.
- Produces: constraint `disponibilidade_meses_ano_mes_barbeiro_uk` on `(ano, mes, barbeiro_id)` with `NULLS NOT DISTINCT` semantics. `001_init.sql`'s `UNIQUE (ano, mes, barbeiro_id)` (auto-named) is dropped.

- [ ] **Step 1: Confirm the existing constraint name**

Read `src/db/migrations/001_init.sql` around the `disponibilidade_meses` table (line ~71, `UNIQUE (ano, mes, barbeiro_id)`). A table-level `UNIQUE (a,b,c)` gets the auto name `<table>_<col>_<col>_<col>_key` → `disponibilidade_meses_ano_mes_barbeiro_id_key`. Use `DROP CONSTRAINT IF EXISTS` with that name; the `IF EXISTS` makes a wrong guess non-fatal, and the test will catch a missed drop.

- [ ] **Step 2: Write the failing test**

```js
// test/db/migrate-004.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inicializar } from '../../src/bootstrap.js';
import { query } from '../../src/db/pool.js';
import { prepararBanco } from '../helpers/db.js';

before(async () => { await prepararBanco(); await inicializar(); });
beforeEach(prepararBanco);

test('a constraint NULLS NOT DISTINCT existe', async () => {
  const { rows } = await query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = (quote_ident(current_schema()) || '.disponibilidade_meses')::regclass
      AND contype = 'u'`);
  const nomes = rows.map((r) => r.conname);
  assert.ok(nomes.includes('disponibilidade_meses_ano_mes_barbeiro_uk'), `constraints: ${nomes}`);
  assert.ok(!nomes.includes('disponibilidade_meses_ano_mes_barbeiro_id_key'), 'a constraint antiga não foi removida');
});

test('duas linhas "mês global" (barbeiro_id NULL) para o mesmo ano/mês colidem', async () => {
  await query(`INSERT INTO disponibilidade_meses (ano, mes, barbeiro_id, status) VALUES (2030, 6, NULL, 'aberto')`);
  await assert.rejects(
    () => query(`INSERT INTO disponibilidade_meses (ano, mes, barbeiro_id, status) VALUES (2030, 6, NULL, 'fechado')`),
    /duplicate key|unique/i,
  );
});
```

> Check `disponibilidade_meses` columns in `001_init.sql` — if `status` is an enum/CHECK, use a valid value; if there are other NOT NULL columns without defaults, include them in the INSERT.

- [ ] **Step 3: Run it — expect FAIL**

Run: `npm test -- test/db/migrate-004.test.js`
Expected: constraint name assertion fails (migration absent).

- [ ] **Step 4: Write the migration**

```sql
-- src/db/migrations/004_meses_nulls_not_distinct.sql
ALTER TABLE disponibilidade_meses
  DROP CONSTRAINT IF EXISTS disponibilidade_meses_ano_mes_barbeiro_id_key;

ALTER TABLE disponibilidade_meses
  ADD CONSTRAINT disponibilidade_meses_ano_mes_barbeiro_uk
  UNIQUE NULLS NOT DISTINCT (ano, mes, barbeiro_id);
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npm test -- test/db/migrate-004.test.js`

- [ ] **Step 6: Run the P3 meses repo test + full suite**

Run: `npm test -- test/repos/dados-repos.test.js`
Then: `npm test`
Expected: the `meses.doAno` / `definir` test still passes (the repo's NULL-safe CTE upsert is compatible with the new constraint); full suite 186 + 2 = 188.

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/004_meses_nulls_not_distinct.sql test/db/migrate-004.test.js
git commit -m "feat(p4): migração 004 — UNIQUE NULLS NOT DISTINCT em disponibilidade_meses"
```

---

## Task 3: `.env.example` / `.env.test.example` finalization + coverage test

**Files:**
- Modify: `.env.example`, `.env.test.example`
- Test: `test/config/env-example.test.js`

**Interfaces:**
- Consumes: `carregarConfig(env)` from `src/config.js` (throws on invalid); the zod `schema` shape is the source of truth for "every documented key".
- Produces: two regrouped, commented example files; a test that (a) every schema field name appears in at least one example file, and (b) a merged env built from the examples passes `carregarConfig`.

- [ ] **Step 1: Write the failing test**

```js
// test/config/env-example.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { carregarConfig } from '../../src/config.js';

const SCHEMA_KEYS = [
  'NODE_ENV', 'PORT', 'TZ', 'DATABASE_URL', 'TEST_SCHEMA', 'SESSION_SECRET',
  'APP_URL', 'ADMIN_EMAIL', 'ADMIN_SENHA', 'GOOGLE_MAPS_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TOKEN', 'WHATSAPP_VERIFY_TOKEN',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID',
  'ORIGENS_PERMITIDAS', 'COOKIE_SECURE', 'WHATSAPP_APP_SECRET', 'LOG_LEVEL',
];

function parseEnvFile(p) {
  const out = {};
  for (const linha of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = linha.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

test('todo campo do schema de config está documentado num dos exemplos', () => {
  const doc = { ...parseEnvFile('.env.example'), ...parseEnvFile('.env.test.example') };
  const faltando = SCHEMA_KEYS.filter((k) => !(k in doc));
  assert.deepEqual(faltando, [], `chaves não documentadas: ${faltando}`);
});

test('um env montado a partir dos exemplos passa em carregarConfig', () => {
  const env = { ...parseEnvFile('.env.example'), ...parseEnvFile('.env.test.example') };
  // placeholders → valores plausíveis mínimos
  env.DATABASE_URL = env.DATABASE_URL?.startsWith('postgres')
    ? 'postgres://u:p@localhost:5432/db' : env.DATABASE_URL || 'postgres://u:p@localhost:5432/db';
  env.SESSION_SECRET = 'x'.repeat(64);
  env.ADMIN_SENHA = 'trocar-1234';
  assert.doesNotThrow(() => carregarConfig(env));
});
```

> Keep `SCHEMA_KEYS` in sync with `src/config.js`'s zod object. If `config.js` gains/loses a key later, this list must follow — add a one-line comment saying so.

- [ ] **Step 2: Run it — expect FAIL or PASS**

Run: `npm test -- test/config/env-example.test.js`
The coverage test may already pass (current `.env.example` looks complete). Run it anyway; the deliverable is the regrouped files + the guard test.

- [ ] **Step 3: Rewrite `.env.example`**

```
# ==== Obrigatório ====
NODE_ENV=development
PORT=3000
TZ=America/Sao_Paulo
# Supabase Session Pooler (porta 5432). Senha com caractere especial: percent-encode na URL.
DATABASE_URL=postgresql://postgres.<project-ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
SESSION_SECRET=troque-por-64-hex-aleatorios
APP_URL=http://localhost:3000
ADMIN_EMAIL=dono@barbearia.com
ADMIN_SENHA=troque-no-primeiro-login

# ==== Produção (atrás de proxy TLS) ====
COOKIE_SECURE=            # =1 para cookie de sessão só-HTTPS
ORIGENS_PERMITIDAS=       # csv de origens; em produção deixe = APP_URL. Vazio libera localhost.

# ==== Mapa (cliente já tem a chave) ====
GOOGLE_MAPS_API_KEY=

# ==== WhatsApp Cloud API (opcional; vazio = modo simulado) ====
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_VERIFY_TOKEN=    # inventado; usado no handshake GET /webhooks/whatsapp
WHATSAPP_APP_SECRET=      # do app Meta; valida a assinatura do POST do webhook

# ==== SMS / OTP Twilio (opcional; vazio = modo simulado) ====
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=

# ==== Observabilidade ====
LOG_LEVEL=info

# ==== Só para `npm test` ====
TEST_SCHEMA=test
```

- [ ] **Step 4: Rewrite `.env.test.example`**

Read the current `.env.test.example` first. Keep every key it has; add grouping comments. It must contain at least `DATABASE_URL`, `TEST_SCHEMA=test`, `SESSION_SECRET`, `ADMIN_EMAIL=dono@teste.local`, `ADMIN_SENHA=teste123456`, `NODE_ENV=test`. Do not weaken any value the existing test suite depends on (the P3 `logarEquipe` helper reads `ADMIN_EMAIL`/`ADMIN_SENHA`).

- [ ] **Step 5: Run the test — expect PASS**

Run: `npm test -- test/config/env-example.test.js`

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: 188 + 2 = 190.

- [ ] **Step 7: Commit**

```bash
git add .env.example .env.test.example test/config/env-example.test.js
git commit -m "docs(p4): .env.example/.env.test.example reagrupados + teste de cobertura do schema"
```

---

## Task 4: `docs/whatsapp-templates.md` + templates-Meta test

**Files:**
- Create: `docs/whatsapp-templates.md`
- Test: `test/services/templates-meta.test.js`

**Interfaces:**
- Consumes: the `TEMPLATES` array in `src/db/seed.js` (`[chave, titulo, corpo]`), `renderizarTemplate` from `src/lib/template.js`.
- Produces: a doc mapping each template to Meta's submission format; a test asserting the seed templates only use `{nome_cliente, nome_servico, data, horario, endereco_barbearia, nome_barbearia}` and render with no leftover `{{`.

- [ ] **Step 1: Write the failing test**

```js
// test/services/templates-meta.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderizarTemplate } from '../../src/lib/template.js';

// espelha src/db/seed.js TEMPLATES — se o seed mudar, isto muda junto
const CORPOS = {
  confirmacao: `Olá, {{nome_cliente}}!\nSeu agendamento para {{nome_servico}} está confirmado!\n📅 Data: {{data}}\n⏰ Horário: {{horario}}\n📍 Local: {{endereco_barbearia}}\nPara confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.`,
  lembrete_24h: `Olá, {{nome_cliente}}!\nLembrete: seu corte está agendado para amanhã às {{horario}}.\nEstamos aguardando você! 💈`,
  pos_atendimento: `Olá, {{nome_cliente}}!\nObrigado por visitar nossa barbearia!\nEsperamos vê-lo em breve. 💈\nIndique para os amigos e ganhe desconto!`,
};

const CONHECIDAS = new Set(['nome_cliente', 'nome_servico', 'data', 'horario', 'endereco_barbearia', 'nome_barbearia']);
const VARS = { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X, 1', nome_barbearia: 'Barbearia' };

for (const [chave, corpo] of Object.entries(CORPOS)) {
  test(`${chave}: só usa variáveis conhecidas`, () => {
    const usadas = [...corpo.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    for (const u of usadas) assert.ok(CONHECIDAS.has(u), `variável desconhecida: ${u}`);
  });
  test(`${chave}: renderiza sem {{ sobrando`, () => {
    const out = renderizarTemplate(corpo, VARS);
    assert.doesNotMatch(out, /\{\{/);
  });
}
```

> Verify `renderizarTemplate`'s signature and behavior in `src/lib/template.js` (it may expect a different var-object shape or placeholder syntax). Adjust the test to the real function; the intent (known vars + clean render) is fixed.

- [ ] **Step 2: Run it — expect FAIL** (module path or assertion), then implement to green.

Run: `npm test -- test/services/templates-meta.test.js`

- [ ] **Step 3: Write `docs/whatsapp-templates.md`**

Content — one section per template. For each:

- **Nome:** `confirmacao` / `lembrete_24h` / `pos_atendimento` (same as seed `chave`).
- **Categoria:** `UTILITY`. **Idioma:** `pt_BR`.
- **Corpo (formato Meta, placeholders posicionais):** the exact seed text with `{{nome_cliente}}` → `{{1}}`, `{{nome_servico}}` → `{{2}}`, etc., in first-appearance order. Show all three bodies verbatim with the numbered placeholders.
- **Mapa de variáveis:** table `{{1}} = nome_cliente`, `{{2}} = nome_servico`, … for that template's actual variables in order.
- **Exemplo (para o formulário de submissão da Meta):** the body with sample values filled in.

Then a closing section **"Como ativar o envio real"**:
1. Conta Meta Business verificada + número dedicado registrado na WhatsApp Cloud API.
2. Preencher `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN` (token de sistema permanente), `WHATSAPP_VERIFY_TOKEN` (inventado), `WHATSAPP_APP_SECRET` no `.env`.
3. Cadastrar `https://<APP_URL>/webhooks/whatsapp` no painel da Meta com o `WHATSAPP_VERIFY_TOKEN` (o `GET` do webhook já responde `hub.challenge`).
4. Submeter os 3 modelos acima no Gerenciador de Modelos; aguardar aprovação (categoria Utility costuma ser rápida).
5. Estado atual: `src/services/whatsapp.js` envia `type: 'text'` livre (funciona dentro da janela de 24h de atendimento). Fora da janela, ou para o lembrete 24h, é preciso trocar para *template message* — anota isso como o próximo passo de integração.

- [ ] **Step 4: Run the test — expect PASS**, then full suite.

Run: `npm test -- test/services/templates-meta.test.js` then `npm test` (expect 190 + 6 = 196).

- [ ] **Step 5: Commit**

```bash
git add docs/whatsapp-templates.md test/services/templates-meta.test.js
git commit -m "docs(p4): 3 templates WhatsApp no formato Meta + teste de variáveis"
```

---

## Task 5: Cookie-`secure` lock test + pool review

**Files:**
- Create: `test/auth/cookie-secure.test.js`
- Modify: (only if clearly wrong) `src/db/pool.js` pool options — otherwise no code change
- Test: the new file

**Interfaces:**
- Consumes: `criarSessaoMiddleware()` from `src/auth/sessao.js`, `carregarConfig` from `src/config.js`; `pool` config from `src/db/pool.js`.
- Produces: a test pinning the `cookie.secure` behavior across `NODE_ENV` / `COOKIE_SECURE`; a documented (in the report) statement of the pool's `max`/idle settings.

- [ ] **Step 1: Read `src/auth/sessao.js` and `src/db/pool.js`**

`sessao.js` line ~26 is `secure: config.NODE_ENV === 'production' || config.COOKIE_SECURE === '1'`. Because `config` is a module singleton loaded from `process.env` at import time, this test must drive it through the middleware factory's observable output rather than re-importing `config`. `criarSessaoMiddleware()` returns the `express-session` middleware; its options are on `mw` — inspect how P2 exposes them. If the cookie options are not readable from the returned middleware, test via a tiny Express app: mount the middleware, hit a route that writes to the session, and assert the `Set-Cookie` header contains (or omits) `Secure`. Under `NODE_ENV=test` and no `COOKIE_SECURE`, `Secure` must be ABSENT.

- [ ] **Step 2: Write the test**

```js
// test/auth/cookie-secure.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { criarSessaoMiddleware } from '../../src/auth/sessao.js';

function appComSessao() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(criarSessaoMiddleware());
  app.get('/set', (req, res) => { req.session.x = 1; res.end('ok'); });
  return app;
}

test('em ambiente de teste (sem COOKIE_SECURE) o cookie de sessão NÃO é Secure', async () => {
  const res = await request(appComSessao()).get('/set');
  const cookie = String(res.headers['set-cookie'] ?? '');
  assert.ok(cookie.includes('barbearia.sid') || cookie.length > 0, 'sem Set-Cookie');
  assert.doesNotMatch(cookie, /;\s*Secure/i);
});
```

> If P2's `criarSessaoMiddleware` uses `NODE_ENV==='test'` to disable session-store pruning (it does), that does not affect `cookie.secure` — the assertion above stands. Confirm the cookie name (`barbearia.sid` per P2) and adjust.

- [ ] **Step 3: Run it — expect PASS** (documents current correct behavior).

Run: `npm test -- test/auth/cookie-secure.test.js`

- [ ] **Step 4: Pool sanity check**

Read `src/db/pool.js`. If it sets `max` (pool size) and an idle timeout: confirm `max` is modest (≤ 10) — the Render Starter plan and Supabase Session Pooler both prefer few connections. If `max` is unset (pg default 10) that's fine. If it's set to something large (> 20), that's the one case to reduce. Record the actual values (or "pg defaults") in your report. Make a code change ONLY if `max > 20` or SSL is misconfigured for prod.

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: 196 + 1 = 197.

- [ ] **Step 6: Commit**

```bash
git add test/auth/cookie-secure.test.js src/db/pool.js
git commit -m "test(p4): trava o comportamento Secure do cookie de sessão + revisão do pool"
```

(Drop `src/db/pool.js` from the `git add` if you made no change.)

---

## Task 6: Admin — "Novo agendamento" screen

**Files:**
- Modify: `src/views/admin/agendamentos.ejs`
- Modify: `src/public/js/admin/agendamentos.js`
- Test: `test/http/admin-novo-agendamento.test.js`

**Interfaces:**
- Consumes: `POST /api/admin/agendamentos` (`{ servico_id, data, horario, observacoes?, barbeiro_id? }` + `cliente_id` OR `cliente:{nome,celular}` → `201 { agendamento }` / `409 { erro }`); `GET /api/admin/clientes?busca=` (`{ itens, ... }`), `GET /api/admin/servicos` (`{ servicos }`), `GET /api/agenda/dias`, `GET /api/agenda/horarios`; `pedirJson`, `toast` from `../comum.js`.
- Produces: a "Novo agendamento" form in the agendamentos screen; new state + methods inside `painelAgendamentos()`. On `201` → `toast` + close + `this.buscar()`. On `409` → `toast` with the code.

- [ ] **Step 1: Write the failing test**

```js
// test/http/admin-novo-agendamento.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { logarEquipe } from '../helpers/sessao.js';
import { query } from '../../src/db/pool.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

async function contexto() {
  const s = await query(`SELECT id FROM servicos ORDER BY id LIMIT 1`);
  const cfg = await query(`SELECT barbeiro_padrao_id FROM configuracao WHERE id=1`);
  return { servicoId: s.rows[0].id, barbeiroId: cfg.rows[0].barbeiro_padrao_id };
}
function proximaSegunda() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

test('cria agendamento para cliente novo (nome+celular)', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  const data = proximaSegunda();
  const hz = await agente.get(`/api/agenda/horarios?data=${data}&servico_id=${servicoId}`);
  const horario = hz.body.horarios[0];
  const res = await agente.post('/api/admin/agendamentos').set('Origin', 'http://localhost:3000').send({
    cliente: { nome: 'Walk In', celular: '11988887777' }, servico_id: servicoId, data, horario,
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.agendamento.id);
});

test('cria para cliente existente por cliente_id', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  const c = await query(`INSERT INTO clientes (nome, celular) VALUES ('Fulano','11977776666') RETURNING id`);
  const data = proximaSegunda();
  const hz = await agente.get(`/api/agenda/horarios?data=${data}&servico_id=${servicoId}`);
  const res = await agente.post('/api/admin/agendamentos').set('Origin', 'http://localhost:3000').send({
    cliente_id: c.rows[0].id, servico_id: servicoId, data, horario: hz.body.horarios[0],
  });
  assert.equal(res.status, 201);
});

test('409 quando o horário já está ocupado', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  const data = proximaSegunda();
  const hz = await agente.get(`/api/agenda/horarios?data=${data}&servico_id=${servicoId}`);
  const horario = hz.body.horarios[0];
  const body = { cliente: { nome: 'A', celular: '11900000001' }, servico_id: servicoId, data, horario };
  const um = await agente.post('/api/admin/agendamentos').set('Origin', 'http://localhost:3000').send(body);
  assert.equal(um.status, 201);
  const dois = await agente.post('/api/admin/agendamentos').set('Origin', 'http://localhost:3000')
    .send({ ...body, cliente: { nome: 'B', celular: '11900000002' } });
  assert.equal(dois.status, 409);
  assert.match(dois.body.erro, /HORARIO_INDISPONIVEL|SLOT_OCUPADO/);
});

test('a tela de agendamentos carrega o formulário de criação', async () => {
  const agente = await logarEquipe();
  const res = await agente.get('/admin/agendamentos');
  assert.equal(res.status, 200);
  assert.match(res.text, /Novo agendamento/);
});
```

> `proximaSegunda()` assumes the seeded expediente has Monday open (it does — seed opens `dia_semana` 1–6). If the chosen day has no free slots (blocked), pick the next day with `horarios.length`. Confirm `POST /api/admin/agendamentos` needs the `Origin` header (`exigirOrigemConfiavel` is on the `/api/admin` tree) — the test sets it. The 409 code is whatever `confirmarAgendamento` returns for a taken slot; assert the set `/HORARIO_INDISPONIVEL|SLOT_OCUPADO/`.

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm test -- test/http/admin-novo-agendamento.test.js`
Expected: the API tests may already pass (endpoint exists); the `/Novo agendamento/` render test fails.

- [ ] **Step 3: Add the form to `src/views/admin/agendamentos.ejs`**

Insert at the top of the `x-data="painelAgendamentos()"` div, before the existing `<form class="filtros">`:

```html
  <details class="novo-agendamento">
    <summary>Novo agendamento</summary>
    <div class="form-grid">
      <label>Cliente
        <input type="text" x-model="novo.busca" @input.debounce.300ms="buscarCliente()" placeholder="nome ou celular">
      </label>
      <ul class="resultado-busca" x-show="novo.resultados.length">
        <template x-for="c in novo.resultados" :key="c.id">
          <li><button type="button" @click="selecionarCliente(c)" x-text="c.nome + ' — ' + c.celular"></button></li>
        </template>
      </ul>
      <p x-show="novo.cliente_id">Selecionado: <strong x-text="novo.clienteNome"></strong>
        <button type="button" @click="limparCliente()">trocar</button></p>
      <label x-show="!novo.cliente_id"><input type="checkbox" x-model="novo.cadastrar"> cadastrar cliente novo</label>
      <template x-if="novo.cadastrar && !novo.cliente_id">
        <div>
          <label>Nome <input type="text" x-model="novo.nome"></label>
          <label>Celular <input type="tel" x-model="novo.celular"></label>
        </div>
      </template>

      <label>Serviço
        <select x-model.number="novo.servico_id" @change="carregarDiasNovo()">
          <option value="">—</option>
          <template x-for="s in novo.servicos" :key="s.id">
            <option :value="s.id" x-text="s.nome"></option>
          </template>
        </select>
      </label>

      <div class="cal-nav" x-show="novo.servico_id">
        <button type="button" @click="novo.mes--; carregarDiasNovo()">←</button>
        <span x-text="novo.mes + '/' + novo.ano"></span>
        <button type="button" @click="novo.mes++; carregarDiasNovo()">→</button>
      </div>
      <ul class="grade-horarios" x-show="novo.dias.length">
        <template x-for="d in novo.dias" :key="d">
          <li><button type="button" :class="novo.data === d ? 'ativa' : ''" @click="escolherDiaNovo(d)" x-text="d"></button></li>
        </template>
      </ul>
      <ul class="grade-horarios" x-show="novo.data">
        <template x-for="h in novo.horarios" :key="h">
          <li><button type="button" :class="novo.horario === h ? 'ativa' : ''" @click="novo.horario = h" x-text="h"></button></li>
        </template>
      </ul>

      <label>Observações <textarea x-model="novo.observacoes"></textarea></label>
      <p class="erro-inline" x-show="novo.erro" x-text="novo.erro"></p>
      <button type="button" class="btn-primario" :disabled="!podeCriar()" @click="criarAgendamento()">Criar</button>
    </div>
  </details>
```

- [ ] **Step 4: Add the state + methods to `src/public/js/admin/agendamentos.js`**

Inside the object returned by `painelAgendamentos()`, add a `novo` sub-object to initial state and the methods. Keep the existing `itens`/`pagina`/`filtro`/`init`/`buscar`/`mudarStatus`/`cancelar`/`enviarWhatsapp` untouched.

```js
    novo: {
      busca: '', resultados: [], cliente_id: null, clienteNome: '',
      cadastrar: false, nome: '', celular: '',
      servicos: [], servico_id: '',
      ano: new Date().getFullYear(), mes: new Date().getMonth() + 1,
      dias: [], data: '', horarios: [], horario: '',
      observacoes: '', erro: '',
    },

    async initNovo() {
      const { ok, corpo } = await pedirJson('/api/admin/servicos');
      if (ok) this.novo.servicos = corpo.servicos || corpo;
    },
    async buscarCliente() {
      if (!this.novo.busca) { this.novo.resultados = []; return; }
      const { ok, corpo } = await pedirJson('/api/admin/clientes?busca=' + encodeURIComponent(this.novo.busca));
      if (ok) this.novo.resultados = (corpo.itens || corpo.clientes || corpo).slice(0, 8);
    },
    selecionarCliente(c) {
      this.novo.cliente_id = c.id; this.novo.clienteNome = c.nome;
      this.novo.resultados = []; this.novo.busca = ''; this.novo.cadastrar = false;
    },
    limparCliente() { this.novo.cliente_id = null; this.novo.clienteNome = ''; },
    async carregarDiasNovo() {
      this.novo.data = ''; this.novo.horario = ''; this.novo.horarios = [];
      if (!this.novo.servico_id) { this.novo.dias = []; return; }
      const q = `ano=${this.novo.ano}&mes=${this.novo.mes}&servico_id=${this.novo.servico_id}`;
      const { ok, corpo } = await pedirJson('/api/agenda/dias?' + q);
      this.novo.dias = ok ? (corpo.dias || []) : [];
    },
    async escolherDiaNovo(d) {
      this.novo.data = d; this.novo.horario = '';
      const q = `data=${d}&servico_id=${this.novo.servico_id}`;
      const { ok, corpo } = await pedirJson('/api/agenda/horarios?' + q);
      this.novo.horarios = ok ? (corpo.horarios || []) : [];
    },
    podeCriar() {
      const n = this.novo;
      const temCliente = n.cliente_id || (n.cadastrar && n.nome && n.celular);
      return Boolean(temCliente && n.servico_id && n.data && n.horario);
    },
    async criarAgendamento() {
      const n = this.novo;
      n.erro = '';
      const body = {
        servico_id: n.servico_id, data: n.data, horario: n.horario,
        ...(n.observacoes ? { observacoes: n.observacoes } : {}),
        ...(n.cliente_id ? { cliente_id: n.cliente_id } : { cliente: { nome: n.nome, celular: n.celular } }),
      };
      const { ok, corpo } = await pedirJson('/api/admin/agendamentos', { method: 'POST', body: JSON.stringify(body) });
      if (!ok) { n.erro = (corpo && corpo.erro) || 'Não foi possível criar.'; toast('Falha ao criar agendamento.', 'erro'); return; }
      toast('Agendamento criado.', 'info');
      Object.assign(this.novo, {
        busca: '', resultados: [], cliente_id: null, clienteNome: '', cadastrar: false,
        nome: '', celular: '', servico_id: '', dias: [], data: '', horarios: [], horario: '', observacoes: '', erro: '',
      });
      this.buscar();
    },
```

And in the existing `async init()`, after `await this.buscar();`, add `await this.initNovo();`.

Keep the Ruling P1 footer (`if (typeof window !== 'undefined') { ... }`) exactly as it is.

- [ ] **Step 5: Run the test — expect PASS**

Run: `npm test -- test/http/admin-novo-agendamento.test.js`

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: 197 + 4 = 201.

- [ ] **Step 7: Commit**

```bash
git add src/views/admin/agendamentos.ejs src/public/js/admin/agendamentos.js test/http/admin-novo-agendamento.test.js
git commit -m "feat(p4): admin — formulário de novo agendamento manual"
```

---

## Task 7: CI — GitHub Actions with a Postgres service

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: none automated — YAML validity check + report note

**Interfaces:**
- Produces: a workflow that, on push to `main` and on every PR, runs `npm ci` + `npm test` against a `postgres:17` service container. No remote is configured yet, so the real gate is the first push.

- [ ] **Step 1: Verify `--env-file` on empty files**

Run: `node --env-file=/dev/null -e "console.log('ok')"` (Git Bash) or create an empty `x.env` and `node --env-file=x.env -e "..."`. Node 20+ accepts a missing/empty `--env-file` since v20.12 only if it exists; older behavior throws on missing. The workflow creates empty `.env` and `.env.test` before `npm test` precisely to satisfy `--env-file`. Confirm empty-but-present works; if Node here errors on an empty file, put a single harmless comment line (`# ci`) in each.

- [ ] **Step 2: Write `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: barbearia_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/barbearia_test
      TEST_SCHEMA: test
      NODE_ENV: test
      SESSION_SECRET: ci-secret-0000000000000000000000000000000000
      ADMIN_EMAIL: dono@teste.local
      ADMIN_SENHA: teste123456
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: |
          : > .env
          : > .env.test
      - run: npm test
```

- [ ] **Step 3: Validate the YAML**

Run one of: `node -e "const y=require('js-yaml')" ` (likely absent → skip), OR `python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"` if python is available, OR a minimal hand-parse. At minimum: `git show HEAD:.github/workflows/ci.yml | head` after commit to confirm it's stored intact, and eyeball indentation. Note in the report which validation you ran.

- [ ] **Step 4: Sanity — does `npm ci` need the vendored files?**

`package.json` has `"postinstall": "node scripts/sync-vendor.js"`. On CI, `npm ci` runs `postinstall`, which copies the socket.io client from `node_modules` and asserts `src/public/vendor/alpine.min.js` exists (it's committed). Confirm `alpine.min.js` is tracked (`git ls-files src/public/vendor/`) so `postinstall` won't `process.exit(1)` on CI.

- [ ] **Step 5: Full suite locally (unchanged) + commit**

Run: `npm test` (still 201; this task adds no tests).

```bash
git add .github/workflows/ci.yml
git commit -m "ci(p4): GitHub Actions — npm test contra postgres:17 isolado"
```

---

## Task 8: `docs/API.md`

**Files:**
- Create: `docs/API.md`
- Test: none automated — content review

**Interfaces:** none. Reference doc generated by reading `src/routes/*.js` and `src/http/erros.js`.

- [ ] **Step 1: Enumerate the routes**

Read `src/routes/paginas.js`, `adminPaginas.js`, `publicas.js`, `clienteApi.js`, `adminApi.js`, `auth.js`, `saude.js`, `webhooks.js`. For each `.get/.post/.patch/.put/.delete`, record method + path + a one-line purpose + request body/query shape (from the `validarCorpo`/`validarQuery` zod) + success shape.

- [ ] **Step 2: Write `docs/API.md`**

Sections, each a table `| Método | Rota | Auth | Corpo/Query | Resposta |`:
1. **Páginas (HTML)** — `GET /`, `/agendar`, `/minha-conta`, `/privacidade`, `/healthz`, `/admin/login`, `/admin`, `/admin/{agendamentos,meses,bloqueios,servicos,clientes,comissoes,configuracao,templates,mensagens}`.
2. **Auth** — `POST /api/auth/admin/login`, `POST /api/auth/cliente/login`, `POST /api/auth/logout`.
3. **Agenda pública** — `GET /api/agenda/{servicos,dias,horarios}`, `POST /api/agenda/{lock,lock/renovar,lock/liberar,cadastro,confirmar}`.
4. **Cliente** — `GET /api/cliente/{me,agendamentos}`, `POST /api/cliente/agendamentos/:id/{cancelar,remarcar}`.
5. **Admin** — `GET /api/admin/dashboard`; `GET/POST /api/admin/agendamentos`, `PATCH /api/admin/agendamentos/:id/status`; `GET/POST /api/admin/disponibilidade`; `GET/POST/DELETE /api/admin/bloqueios`; `GET/POST/PATCH/DELETE /api/admin/servicos`; `GET /api/admin/clientes`, `GET /api/admin/clientes/:id`, `POST /api/admin/clientes/:id/anonimizar`; `GET /api/admin/comissoes`; `GET/PUT /api/admin/configuracao`; `GET /api/admin/templates`, `PUT /api/admin/templates/:chave`; `GET /api/admin/mensagens`, `POST /api/admin/mensagens/enviar`.
6. **Webhooks** — `GET /webhooks/whatsapp` (handshake `hub.challenge`), `POST /webhooks/whatsapp` (HMAC `x-hub-signature-256`; SIM/NÃO replies).
7. **Contrato de erro** — `{ erro: 'CODIGO' }` (+`campos: [{caminho, mensagem}]` para `VALIDACAO`); the full `CODIGO → HTTP` table copied from `src/http/erros.js` `mapaErroHttp`.
8. **Eventos Socket.io** — table `| Evento | Sala | Quando | Payload |` for `horario_reservado`, `horario_liberado`, `agenda_atualizada`, `novo_agendamento`, `agendamento_atualizado`, `dashboard_tick` (from `src/realtime/eventos.js` + `emitir.js`). Note the client `emit('entrar_agenda', { data })`.

Header note: "Manter em sincronia com `src/routes/*.js` ao adicionar rotas."

- [ ] **Step 3: Commit**

```bash
git add docs/API.md
git commit -m "docs(p4): referência de API (rotas + contrato de erro + eventos socket)"
```

---

## Task 9: `docs/DEPLOY.md`

**Files:**
- Create: `docs/DEPLOY.md`
- Test: none automated — content review

**Interfaces:** none.

- [ ] **Step 1: Write `docs/DEPLOY.md`** — exactly the structure in spec §7:

- **§ Pré-requisitos:** Node ≥ 20 (repo fixa 24 no `.nvmrc`), PostgreSQL **≥ 15** (necessário para `UNIQUE NULLS NOT DISTINCT` da migração 004).
- **§ Render (principal):** the 7 numbered steps from spec §7.1 verbatim in prose — banco (Render PG ou Supabase Session Pooler), Web Service (`npm ci` / `npm start` / health `GET /healthz`), env vars (list every one from `.env.example` with the prod values: `NODE_ENV=production`, `APP_URL`, `COOKIE_SECURE=1`, `ORIGENS_PERMITIDAS=<APP_URL>`, `SESSION_SECRET` via the `crypto.randomBytes(32)` one-liner), Node version note, cron note (node-cron interno, sem Cron Job pago), custom domain, WhatsApp webhook registration. **State that `npm start` now auto-applies migrations + seed** (Task 1) — no manual `db:migrate` step on deploy.
- **§ Custo:** the ~US$14/mês table; free tier caveat (dorme, WebSocket cai).
- **§ VPS (alternativa):** Ubuntu 22.04+, Node 20 LTS, PostgreSQL ≥ 15, criar banco/usuário, clonar, `npm ci`, `.env` (`NODE_ENV=production`, `COOKIE_SECURE=1`, `ORIGENS_PERMITIDAS`), PM2 (`pm2 start "npm run start" --name barbearia && pm2 save && pm2 startup`), nginx reverse proxy block with `Upgrade`/`Connection`/`X-Forwarded-Proto` headers for `:3000`, Certbot, `ufw` 22/80/443, `pg_dump` cron. Cost ~€4–5/mês.
- **§ Backup e rollback:** `pg_dump` schedule; Render keeps the previous version if start fails; migrations are forward-only + transactional; rollback = restore dump.
- **§ Pós-deploy (banco já existente):** if the DB was seeded during P1/P2 dev, `ON CONFLICT DO NOTHING` won't backfill `configuracao` — fill `telefone_whatsapp` / `endereco` / `latitude` / `longitude` at `/admin/configuracao`. The seeded values are placeholders (`5511999990000`, `Rua Exemplo, 123`) that would otherwise ship as real content.
- **§ Ativar WhatsApp:** pointer to `docs/whatsapp-templates.md`.

- [ ] **Step 2: Commit**

```bash
git add docs/DEPLOY.md
git commit -m "docs(p4): guia de deploy (Render principal + VPS alternativa)"
```

---

## Task 10: README rewrite

**Files:**
- Modify: `README.md`
- Test: none automated — content review

**Interfaces:** none.

- [ ] **Step 1: Rewrite `README.md`**

Replace the "P1: Fundação" framing with the full system. Sections:
- **Title + one-paragraph what-it-is:** full-stack barbershop — public online booking with real-time availability, admin panel, WhatsApp integration (stub until credentials).
- **Stack:** Node 24 (ESM), Express 4 + Socket.io, EJS + Alpine, PostgreSQL (Supabase in dev), `node:test`.
- **As 4 fases** — bullet list, each linking its spec + plan under `docs/superpowers/`:
  - P1 — Fundação + Motor de Agenda (`specs/2026-09-05-…`, `plans/2026-09-05-p1-…`)
  - P2 — API + Tempo Real + Auth (`specs/2026-09-06-…`, `plans/2026-09-06-p2-…`)
  - P3 — Frontend (`specs/2026-09-07-p3-…`, `plans/2026-09-07-p3-…`)
  - P4 — Deploy + Docs + CI (`specs/2026-09-07-p4-…`, `plans/2026-09-07-p4-…`)
- **Setup local:** `cp .env.example .env` + `cp .env.test.example .env.test` (fill `DATABASE_URL`, `SESSION_SECRET`), `npm ci`, `npm run db:reset`, `npm run dev` → `http://localhost:3000` (`/admin` login = `ADMIN_EMAIL`/`ADMIN_SENHA`).
- **Comandos:** table — `npm test`, `npm run dev`, `npm start` (migra+semeia+sobe), `npm run db:migrate`, `npm run db:seed`, `npm run db:reset`.
- **Testes / isolamento:** dev no schema `public`, testes no schema `test` (mesmo banco). Nota: em dev os testes compartilham um único schema `test` remoto — não rodar `npm test` concorrente; o CI (`.github/workflows/ci.yml`) usa um Postgres efêmero por run e não tem esse limite.
- **Deploy:** pointer to `docs/DEPLOY.md`. **API:** pointer to `docs/API.md`. **WhatsApp:** pointer to `docs/whatsapp-templates.md`.
- **Arquitetura (curto):** processo único Express+Socket.io, EJS server-rendered + ilhas Alpine, cache em memória, `node-cron` interno (locks + fila de mensagens), sem Redis.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(p4): README reescrito para o sistema completo (P1–P4)"
```

---

## Self-Review

**1. Spec coverage:**

| Spec § | Requirement | Task |
|---|---|---|
| §1.1 / §3 | boot auto-migrate + seed | 1 |
| §1.2 / §4 | migration 004 `NULLS NOT DISTINCT` | 2 |
| §1.3 / §5 | admin "novo agendamento" screen | 6 |
| §1.4 / §6 | `.env.example` + `.env.test.example` final + coverage test | 3 |
| §1.5 / §7 | `docs/DEPLOY.md` (Render + VPS) | 9 |
| §1.6 / §8 | `docs/API.md` | 8 |
| §1.7 / §9 | `docs/whatsapp-templates.md` + templates test | 4 |
| §1.8 / §10 | `.github/workflows/ci.yml` (postgres service) | 7 |
| §1.9 / §11 | README rewrite | 10 |
| §1.10 / §12 | prod hardening: cookie-secure lock test + pool review + doc | 5 (+ documented in 9) |
| §13 | test strategy — new tests per task | 1–7 |
| §14 | P1–P3 impact: only `server.js` entrypoint + admin agendamentos + docs | 1, 6, others |

No gaps. Non-goals (live WhatsApp/Twilio wiring, OTP feature, reminder cron, Dockerfile, provisioning the GitHub remote) are explicitly out of scope in spec §1 and not tasked.

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling". Code steps carry full code. Doc tasks (8, 9, 10) specify the complete section list + required content + exact values/commands to include — that is the deliverable's spec, not a placeholder; each is independently review-gated. Tasks 2, 4, 5, 7 carry "verify X against the real file" steps — these check already-built code (`renderizarTemplate`, `sessao.js`, the `001_init.sql` constraint name, Node `--env-file` semantics), not deferred work.

**3. Type consistency:**
- `inicializar({ semear })` — Task 1 defines, Task 2's tests consume, Task 7's CI relies on it via `npm start` semantics (documented in Task 9).
- Migration filename `004_meses_nulls_not_distinct.sql` and constraint name `disponibilidade_meses_ano_mes_barbeiro_uk` — Task 2 defines, Task 1's test references, Task 2's test asserts.
- `POST /api/admin/agendamentos` body `{ cliente_id | cliente:{nome,celular}, servico_id, data, horario, observacoes? }` — Task 6 view, JS, and test all use the same shape; matches `src/routes/adminApi.js` as read.
- `SCHEMA_KEYS` in Task 3's test == the 20 keys of `src/config.js`'s zod object (listed in spec §6).
- `painelAgendamentos()` — Task 6 extends the P3 object without renaming `itens`/`buscar`/`init`; new state under `novo.*`.
- Test counts are cumulative and advisory (183 → ~201 across Tasks 1–6); a task that finds its API test already green (Task 6) still ships the render test.

If a later task's assumption about an earlier file is wrong (e.g. `test/helpers/db.js` TRUNCATEs `schema_migrations`), the affected step names the fallback assertion. Fix inline and continue.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-07-p4-deploy-docs-ci.md`. Two execution options:

**1. Subagent-Driven (recommended)** — one fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — execute in this session with `superpowers:executing-plans`, batched with checkpoints.

Which approach?
