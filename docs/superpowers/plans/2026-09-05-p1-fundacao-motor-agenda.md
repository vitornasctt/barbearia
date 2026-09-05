# P1 — Fundação + Motor de Agenda — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação do backend (projeto, banco, migrations, seed) e todo o motor de agenda (`src/agenda/`) com locks e transações anti-race-condition, coberto por testes contra um PostgreSQL real (instância Supabase, schema `test`).

**Architecture:** Um pacote Node ESM. A camada de banco expõe `query()` e `withTransaction()` sobre um pool `pg`. O motor de agenda é um conjunto de módulos puros de lógica temporal (`lib/`) mais funções assíncronas que recebem um executor SQL (`query` do pool ou o client de uma transação) e devolvem dados — nenhuma dependência de Express ou Socket.io. Exclusão mútua de horários é garantida no banco por um índice único parcial em `agendamentos` e por `UNIQUE` + `ON CONFLICT` condicional em `horarios_lock`.

**Tech Stack:** Node 20+ (máquina de dev tem Node 24), ESM, PostgreSQL 17 (Supabase gerenciado), `pg`, `bcrypt`, `zod`, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` (seções 2, 3, 4, 11).

## Global Constraints

- **Runtime:** Node 20 ou superior. `package.json` tem `"type": "module"` e `"engines": { "node": ">=20" }`. Sempre `import`/`export`, nunca `require`.
- **Banco:** PostgreSQL 17, instância **Supabase** (não há Docker nem Postgres local nesta máquina). Conexão via Session Pooler, **exige SSL** (`ssl: { rejectUnauthorized: false }` no `pg.Pool`). Dinheiro em `NUMERIC(10,2)`; tempo em `TIMESTAMPTZ`; horas do dia em `TIME`.
- **Isolamento de teste por schema (não por banco):** o Supabase free tem um único banco (`postgres`) e não permite `CREATE DATABASE`. Portanto: quando `NODE_ENV=test`, o pool conecta com `search_path` apontando para o schema definido em `config.TEST_SCHEMA` (default `test`); migrations, seed e harness operam nesse schema; `db:reset` e o desenvolvimento usam o schema `public`. Os dois nunca se tocam. Não existe `DATABASE_URL_TEST`.
- **Variáveis de ambiente:** `.env` (dev, com `DATABASE_URL` e o segredo) e `.env.test` (só `NODE_ENV=test` e credenciais de admin de teste) **já existem na máquina, criados fora deste plano e git-ignorados**. As tarefas criam apenas os `*.example` correspondentes (sem segredos). `npm test` = `node --env-file=.env --env-file=.env.test --test` (o segundo `--env-file` sobrepõe o primeiro).
- **SQL parametrizado sempre.** Nunca interpolar valor vindo de usuário/parâmetro numa string SQL. Constantes internas controladas pelo código (duração do lock; nome do schema já validado por regex no `config`) podem ser interpoladas.
- **Timezone único:** a aplicação assume o fuso da barbearia. Variável `TZ` (ex.: `America/Sao_Paulo`) definida no ambiente. Cálculo de dia-da-semana usa `Date.UTC(...)` para ser determinístico; comparações de "agora vs horário do slot" usam a hora local do processo.
- **Passo de slot e antecedência vêm de `configuracao`** (`intervalo_minutos`, `antecedencia_min_horas`). Nunca hardcode `35`.
- **Isolamento:** nada em `src/agenda/`, `src/lib/`, `src/services/` importa `express` ou `socket.io`.
- **Testes:** `node:test`, com **`--test-concurrency=1`** no script `test` (arquivos rodam em série). Isso é obrigatório: todos os arquivos de teste compartilham o mesmo schema `test` no Supabase e vários dão `TRUNCATE` no `beforeEach` — em paralelo isso gera flakiness. Nenhum teste depende de outro; cada arquivo limpa o schema no `beforeEach` via o harness.
- **Idioma:** identificadores, comentários e mensagens em pt-BR, seguindo os nomes do schema.
- **Commits frequentes**, um por tarefa no mínimo, mensagem em pt-BR terminando com:
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`

---

## Estrutura de arquivos criada neste plano

| Arquivo | Responsabilidade |
|---|---|
| `package.json`, `.nvmrc`, `.env.example`, `.env.test.example` | Scaffold, dependências, contrato de ambiente (Supabase; sem Docker) |
| `src/config.js` | Lê e valida `process.env` com `zod`; exporta objeto `config` |
| `src/lib/tempo.js` | Funções puras de tempo: `paraMinutos`, `paraHHMM`, `adicionarMinutos`, `sobrepoe` |
| `src/lib/template.js` | `renderizarTemplate(corpo, vars)` — substitui `{{chave}}` |
| `src/db/pool.js` | Pool `pg`; `query()`, `withTransaction()`, `fecharPool()` |
| `src/db/migrations/001_init.sql` | Schema completo da spec (seção 3) |
| `src/db/migrate.js` | Runner idempotente de migrations (`schema_migrations`) |
| `src/db/seed.js` | Dados iniciais: `configuracao`, `horario_funcionamento`, admin, serviços, templates |
| `scripts/migrate.js`, `scripts/seed.js`, `scripts/reset.js` | CLIs finas para os scripts npm |
| `src/services/comissao.js` | `calcularComissao(preco, percentual)` |
| `src/agenda/cache.js` | Cache em memória com TTL + `invalidarData` |
| `src/agenda/slots.js` | `gerarSlots({abre, fecha, intervaloMinutos, duracaoServico})` |
| `src/agenda/disponibilidade.js` | `horariosDisponiveis(...)` e `verificarSlot(exec, ...)` |
| `src/agenda/locks.js` | `criarLock`, `renovarLock`, `liberarLock`, `limparExpirados` |
| `src/agenda/agendar.js` | `confirmarAgendamento`, `cancelarAgendamento`, `remarcarAgendamento` |
| `test/helpers/db.js` | Harness: `prepararBanco`, `limparBanco`, `semearBase`, `fecharBanco` |
| `test/**/*.test.js` | Testes por módulo |

**Fora do escopo do P1** (vão para P2): `src/server.js`, Express, Socket.io, rotas, sessões, agendamento do cron que chama `limparExpirados`, envio real das mensagens (o P1 só enfileira com `status='pendente'`).

---

### Task 1: Scaffold do projeto e contrato de ambiente (Supabase, sem Docker)

**Files:**
- Create: `package.json`, `.nvmrc`, `.env.example`, `.env.test.example`
- Create: `src/.gitkeep`, `test/.gitkeep`

**Contexto dado pelo controlador (não repetir descoberta):**
- `.env` e `.env.test` **já existem** na raiz, git-ignorados, com o `DATABASE_URL` real do Supabase e o `SESSION_SECRET`. **Não crie, não sobrescreva, não leia esses dois.** Você cria só os `*.example`.
- `.gitignore` **já contém** `.env`, `.env.test` e `.superpowers/` — **não mexa no `.gitignore`**.
- Não há Docker nem Postgres local; o banco é remoto (Supabase). Nenhum passo sobe container.

**Interfaces:**
- Consumes: nada.
- Produces: scripts npm `test`, `db:migrate`, `db:seed`, `db:reset`; Postgres acessível via `DATABASE_URL` (schema `public` em dev; schema de `TEST_SCHEMA` quando `NODE_ENV=test`).

- [ ] **Step 1: Criar `package.json`**

```json
{
  "name": "barbearia",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "node --env-file=.env --env-file=.env.test --test --test-concurrency=1",
    "db:migrate": "node --env-file=.env scripts/migrate.js",
    "db:seed": "node --env-file=.env scripts/seed.js",
    "db:reset": "node --env-file=.env scripts/reset.js"
  },
  "dependencies": {
    "bcrypt": "^5.1.1",
    "pg": "^8.12.0",
    "zod": "^3.23.8"
  }
}
```

- [ ] **Step 2: Criar `.nvmrc`**

```
20
```

- [ ] **Step 3: Criar `.env.example`**

```
NODE_ENV=development
PORT=3000
TZ=America/Sao_Paulo
# Supabase — Session Pooler (porta 5432). Se a senha tiver caractere especial,
# ela precisa estar percent-encoded nesta URL.
DATABASE_URL=postgresql://postgres.<project-ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres
TEST_SCHEMA=test
SESSION_SECRET=troque-isto-por-64-hex-aleatorios
APP_URL=http://localhost:3000
ADMIN_EMAIL=dono@barbearia.com
ADMIN_SENHA=troque-no-primeiro-login
GOOGLE_MAPS_API_KEY=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_TOKEN=
WHATSAPP_VERIFY_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
```

- [ ] **Step 4: Criar `.env.test.example`**

```
# Sobrepõe .env no modo teste. DATABASE_URL, TZ etc. vêm do .env.
NODE_ENV=test
ADMIN_EMAIL=dono@teste.local
ADMIN_SENHA=teste123456
```

- [ ] **Step 5: `npm install` e verificar a suíte vazia**

Run:
```bash
npm install
npm test
```
Expected: `npm install` conclui sem erro; `npm test` executa, encontra 0 testes e sai com código 0 (mensagem "tests 0"). (Os `--env-file=.env`/`.env.test` já existem na máquina.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold do projeto e contrato de ambiente (Supabase, sem Docker)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `src/lib/tempo.js` — utilidades puras de tempo

**Files:**
- Create: `src/lib/tempo.js`
- Test: `test/lib/tempo.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `paraMinutos(hhmm: string) => number` — `'09:35' → 575`
  - `paraHHMM(min: number) => string` — `575 → '09:35'`
  - `adicionarMinutos(hhmm: string, delta: number) => string` — `('09:00', 35) → '09:35'`
  - `sobrepoe(iniA: string, fimA: string, iniB: string, fimB: string) => boolean` — intervalos meio-abertos `[ini, fim)`

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/lib/tempo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { paraMinutos, paraHHMM, adicionarMinutos, sobrepoe } from '../../src/lib/tempo.js';

test('paraMinutos converte HH:MM em minutos desde meia-noite', () => {
  assert.equal(paraMinutos('00:00'), 0);
  assert.equal(paraMinutos('09:35'), 575);
  assert.equal(paraMinutos('19:30'), 1170);
});

test('paraHHMM converte minutos em HH:MM com zero à esquerda', () => {
  assert.equal(paraHHMM(0), '00:00');
  assert.equal(paraHHMM(575), '09:35');
  assert.equal(paraHHMM(1170), '19:30');
});

test('adicionarMinutos soma e reformata', () => {
  assert.equal(adicionarMinutos('09:00', 35), '09:35');
  assert.equal(adicionarMinutos('18:55', 50), '19:45');
});

test('sobrepoe é verdadeiro só quando os intervalos meio-abertos se cruzam', () => {
  assert.equal(sobrepoe('09:00', '09:35', '09:35', '10:10'), false); // encostam, não cruzam
  assert.equal(sobrepoe('09:00', '09:35', '09:20', '09:50'), true);
  assert.equal(sobrepoe('09:00', '09:50', '09:35', '10:10'), true);
  assert.equal(sobrepoe('10:00', '10:35', '09:00', '09:35'), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/lib/tempo.test.js`
Expected: FAIL — `Cannot find module '../../src/lib/tempo.js'`.

- [ ] **Step 3: Implementar**

```js
// src/lib/tempo.js
export function paraMinutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function paraHHMM(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function adicionarMinutos(hhmm, delta) {
  return paraHHMM(paraMinutos(hhmm) + delta);
}

export function sobrepoe(iniA, fimA, iniB, fimB) {
  const a1 = paraMinutos(iniA), a2 = paraMinutos(fimA);
  const b1 = paraMinutos(iniB), b2 = paraMinutos(fimB);
  return a1 < b2 && b1 < a2;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/lib/tempo.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tempo.js test/lib/tempo.test.js
git commit -m "feat: utilidades puras de tempo (paraMinutos, paraHHMM, adicionarMinutos, sobrepoe)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `src/lib/template.js` — renderização de templates de mensagem

**Files:**
- Create: `src/lib/template.js`
- Test: `test/lib/template.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `renderizarTemplate(corpo: string, vars: Record<string,string|number>) => string` — troca cada `{{chave}}` pelo valor; chave ausente vira string vazia; `{{ chave }}` com espaços também é aceito.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/lib/template.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderizarTemplate } from '../../src/lib/template.js';

test('substitui variáveis presentes', () => {
  const out = renderizarTemplate('Olá, {{nome}}! Dia {{data}}.', { nome: 'Ana', data: '10/09' });
  assert.equal(out, 'Olá, Ana! Dia 10/09.');
});

test('aceita espaços dentro das chaves', () => {
  assert.equal(renderizarTemplate('{{ x }}', { x: 1 }), '1');
});

test('chave ausente vira string vazia', () => {
  assert.equal(renderizarTemplate('a{{b}}c', {}), 'ac');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/lib/template.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/lib/template.js
export function renderizarTemplate(corpo, vars = {}) {
  return corpo.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v === undefined || v === null ? '' : String(v);
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/lib/template.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/template.js test/lib/template.test.js
git commit -m "feat: renderizarTemplate para mensagens com {{variaveis}}

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `src/config.js` — carga e validação de ambiente

**Files:**
- Create: `src/config.js`
- Test: `test/config.test.js`

**Interfaces:**
- Consumes: `zod`.
- Produces:
  - `carregarConfig(env = process.env) => Config` — lança `Error` com mensagem legível se inválido.
  - `config: Config` — resultado de `carregarConfig(process.env)` no import.
  - `Config` tem: `NODE_ENV` (`'development'|'test'|'production'`), `PORT` (number), `TZ`, `DATABASE_URL`, `TEST_SCHEMA` (string, default `'test'`, validada como identificador SQL seguro), `SESSION_SECRET`, `APP_URL`, `ADMIN_EMAIL`, `ADMIN_SENHA`, e as chaves de integração como string (default `''`). **Não existe `DATABASE_URL_TEST`.**

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/config.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: '0123456789abcdef0123',
  ADMIN_EMAIL: 'a@b.com',
  ADMIN_SENHA: 'segredo123',
};

test('aplica defaults quando opcionais faltam', () => {
  const c = carregarConfig(base);
  assert.equal(c.NODE_ENV, 'development');
  assert.equal(c.PORT, 3000);
  assert.equal(c.GOOGLE_MAPS_API_KEY, '');
});

test('coage PORT para número', () => {
  const c = carregarConfig({ ...base, PORT: '8080' });
  assert.equal(c.PORT, 8080);
});

test('lança erro citando o campo quando DATABASE_URL falta', () => {
  assert.throws(() => carregarConfig({ ...base, DATABASE_URL: undefined }), /DATABASE_URL/);
});

test('TEST_SCHEMA default é "test" e rejeita identificador inválido', () => {
  assert.equal(carregarConfig(base).TEST_SCHEMA, 'test');
  assert.throws(() => carregarConfig({ ...base, TEST_SCHEMA: 'no-hyphens' }), /TEST_SCHEMA/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/config.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/config.js
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TZ: z.string().default('America/Sao_Paulo'),
  DATABASE_URL: z.string().min(1),
  TEST_SCHEMA: z.string().regex(/^[a-z_][a-z0-9_]*$/, 'deve ser um identificador SQL válido (minúsculas, _, dígitos)').default('test'),
  SESSION_SECRET: z.string().min(16).default('dev-secret-troque-isto-000000'),
  APP_URL: z.string().default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email().default('admin@local.test'),
  ADMIN_SENHA: z.string().min(6).default('admin123'),
  GOOGLE_MAPS_API_KEY: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_TOKEN: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_VERIFY_SERVICE_SID: z.string().default(''),
});

export function carregarConfig(env = process.env) {
  const r = schema.safeParse(env);
  if (!r.success) {
    const detalhe = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração de ambiente inválida — ${detalhe}`);
  }
  return r.data;
}

export const config = carregarConfig();
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/config.test.js`
Expected: PASS (4 testes). (`.env` já define `DATABASE_URL`, então o import de `config` não quebra.)

- [ ] **Step 5: Commit**

```bash
git add src/config.js test/config.test.js
git commit -m "feat: carregarConfig com validação zod e defaults

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `src/db/pool.js` — pool pg, query e transação

**Files:**
- Create: `src/db/pool.js`
- Test: `test/db/pool.test.js`

**Interfaces:**
- Consumes: `config` de `src/config.js`.
- Produces:
  - `pool: pg.Pool`
  - `schema: string` — `config.TEST_SCHEMA` quando `NODE_ENV==='test'`, senão `'public'`. Exportado para o migrate/harness.
  - `query(text: string, params?: any[]) => Promise<pg.QueryResult>`
  - `withTransaction(fn: (client) => Promise<T>) => Promise<T>` — `BEGIN`; `COMMIT` no sucesso; `ROLLBACK` e re-`throw` no erro; sempre libera o client.
  - `fecharPool() => Promise<void>`
- **Sempre** conecta com `ssl: { rejectUnauthorized: false }` (Supabase exige; inofensivo em local).
- **Search path:** o `pg.Pool` recebe `options: '-c search_path=<schema>'`, então toda conexão já entra no schema certo — SQL não-qualificado (`CREATE TABLE usuarios`, `SELECT ... FROM agendamentos`) resolve para `test` em teste e `public` em dev, sem qualquer outra mudança nas queries.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/db/pool.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { query, withTransaction, fecharPool, schema } from '../../src/db/pool.js';

// o pool entra com search_path=<schema de teste>; garante que ele exista
test.before(() => query(`CREATE SCHEMA IF NOT EXISTS ${schema}`));
test.after(() => fecharPool());

test('schema exportado é o de teste', () => {
  assert.equal(schema, 'test');
});

test('query executa SELECT simples', async () => {
  const r = await query('SELECT 1 AS n');
  assert.equal(r.rows[0].n, 1);
});

test('withTransaction faz commit do trabalho', async () => {
  await query('DROP TABLE IF EXISTS _t_commit');
  await withTransaction(async (c) => {
    await c.query('CREATE TABLE _t_commit (x int)');
    await c.query('INSERT INTO _t_commit VALUES (42)');
  });
  const r = await query('SELECT x FROM _t_commit');
  assert.equal(r.rows[0].x, 42);
  await query('DROP TABLE _t_commit');
});

test('withTransaction faz rollback e propaga o erro', async () => {
  await query('DROP TABLE IF EXISTS _t_rollback');
  await query('CREATE TABLE _t_rollback (x int)');
  await assert.rejects(
    withTransaction(async (c) => {
      await c.query('INSERT INTO _t_rollback VALUES (1)');
      throw new Error('falha proposital');
    }),
    /falha proposital/,
  );
  const r = await query('SELECT count(*)::int AS n FROM _t_rollback');
  assert.equal(r.rows[0].n, 0);
  await query('DROP TABLE _t_rollback');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/db/pool.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/db/pool.js
import pg from 'pg';
import { config } from '../config.js';

export const schema = config.NODE_ENV === 'test' ? config.TEST_SCHEMA : 'public';

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  options: `-c search_path=${schema}`,
  max: 10,
});

export function query(text, params) {
  return pool.query(text, params);
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const resultado = await fn(client);
    await client.query('COMMIT');
    return resultado;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function fecharPool() {
  return pool.end();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/db/pool.test.js`
Expected: PASS (4 testes). Pré-requisito: `.env`/`.env.test` presentes (Supabase acessível).

- [ ] **Step 5: Commit**

```bash
git add src/db/pool.js test/db/pool.test.js
git commit -m "feat: pool pg com query() e withTransaction()

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Schema `001_init.sql` e runner de migrations

**Files:**
- Create: `src/db/migrations/001_init.sql`
- Create: `src/db/migrate.js`
- Create: `scripts/migrate.js`
- Test: `test/db/migrate.test.js`

**Interfaces:**
- Consumes: `pool` **e `schema`** de `src/db/pool.js`.
- Produces:
  - `migrar({ silent = false } = {}) => Promise<void>` — primeiro `CREATE SCHEMA IF NOT EXISTS ${schema}` (o `schema` vem do pool, já validado por regex no config); depois cria `schema_migrations (nome text pk, aplicada_em timestamptz)`, aplica em ordem alfabética os `.sql` de `src/db/migrations/` ainda não registrados, cada um numa transação, e registra o nome. Idempotente. Como o pool conecta com `search_path=${schema}`, tudo é criado nesse schema (`public` em dev, `test` em teste) e o `schema_migrations` é por-schema.
- Após rodar, existem todas as tabelas da spec seção 3 no schema corrente.

**Contexto do controlador:** o texto da tarefa manda "copiar verbatim da spec seção 3". O implementador deve **ler `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` seção 3** e transcrever aquele bloco SQL inteiro para `001_init.sql` (sem `CREATE SCHEMA`, sem `schema_migrations`, sem a tabela `session`).

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/db/migrate.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { migrar } from '../../src/db/migrate.js';
import { query, fecharPool, schema } from '../../src/db/pool.js';

test.after(() => fecharPool());

test('migrar cria as tabelas do schema e é idempotente', async () => {
  await migrar({ silent: true });
  await migrar({ silent: true }); // segunda vez: no-op, não pode lançar

  const nomes = ['usuarios','clientes','servicos','configuracao','horario_funcionamento',
    'agenda_disponibilidade','bloqueios_agenda','agendamentos','horarios_lock',
    'templates_mensagem','mensagens_whatsapp','otp_codigos','logs_acesso','schema_migrations'];
  const r = await query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema=$2 AND table_name = ANY($1)`, [nomes, schema]);
  assert.equal(r.rows.length, nomes.length);
});

test('o índice único parcial de slot ativo existe', async () => {
  await migrar({ silent: true });
  const r = await query(`SELECT indexdef FROM pg_indexes WHERE indexname='uniq_slot_ativo'`);
  assert.match(r.rows[0].indexdef, /pendente.*confirmado/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/db/migrate.test.js`
Expected: FAIL — `src/db/migrate.js` não encontrado.

- [ ] **Step 3: Criar `src/db/migrations/001_init.sql`**

Conteúdo idêntico ao bloco SQL da spec seção 3 (todas as tabelas, na ordem: `usuarios`, `clientes`, `servicos`, `configuracao`, `horario_funcionamento`, `agenda_disponibilidade`, `bloqueios_agenda`, `agendamentos`, os três `CREATE INDEX`/`CREATE UNIQUE INDEX` de `agendamentos`, `horarios_lock` e seus índices, `templates_mensagem`, `mensagens_whatsapp`, `otp_codigos`, `logs_acesso`). **Não** incluir `CREATE SCHEMA` (o runner cria), `schema_migrations` (o runner cria) nem a tabela `session` (fica no P2). Tabelas e índices **sem qualificar com schema** — o `search_path` do pool resolve. Ler a spec em `docs/superpowers/specs/2026-09-05-barbearia-nucleo-design.md` seção 3 e transcrever verbatim — é a fonte da verdade.

- [ ] **Step 4: Implementar `src/db/migrate.js`**

```js
// src/db/migrate.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, schema } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrar({ silent = false } = {}) {
  // `schema` vem do config, validado por regex (identificador SQL seguro)
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nome TEXT PRIMARY KEY,
    aplicada_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const { rows } = await pool.query('SELECT nome FROM schema_migrations');
  const aplicadas = new Set(rows.map((r) => r.nome));
  const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(dir, arquivo), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (nome) VALUES ($1)', [arquivo]);
      await client.query('COMMIT');
      if (!silent) console.log(`migração aplicada: ${arquivo}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`falha na migração ${arquivo}: ${err.message}`);
    } finally {
      client.release();
    }
  }
}
```

- [ ] **Step 5: Criar `scripts/migrate.js`**

```js
// scripts/migrate.js
import { migrar } from '../src/db/migrate.js';
import { fecharPool } from '../src/db/pool.js';

migrar()
  .then(() => fecharPool())
  .then(() => console.log('migrations em dia'))
  .catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test -- test/db/migrate.test.js`
Expected: PASS (2 testes) — cria tudo no schema `test`.

- [ ] **Step 7: Verificar o CLI**

Run: `npm run db:migrate`
Expected: imprime "migrations em dia" e sai 0 (roda com `--env-file=.env` → `NODE_ENV=development` → schema `public`).

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations/001_init.sql src/db/migrate.js scripts/migrate.js test/db/migrate.test.js
git commit -m "feat: schema inicial (001_init.sql) e runner idempotente de migrations

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Harness de teste de banco

**Files:**
- Create: `test/helpers/db.js`
- Create: `scripts/reset.js`
- Test: `test/helpers/db.test.js`

**Interfaces:**
- Consumes: `pool`, `migrar`. **Não importa `seed.js` estaticamente** — `semearBase` faz `await import('../../src/db/seed.js')` sob demanda, então o harness não depende de a Task 8 já existir.
- Produces:
  - `prepararBanco() => Promise<void>` — roda `migrar` uma vez por processo e depois `limparBanco()`.
  - `limparBanco() => Promise<void>` — `TRUNCATE ... RESTART IDENTITY CASCADE` em todas as tabelas de dados (nomes não-qualificados; o `search_path` do pool resolve para o schema de teste).
  - `semearBase() => Promise<void>` — importa e chama `semear()` (Task 8) dinamicamente.
  - `fecharBanco() => Promise<void>` — `pool.end()`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/helpers/db.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, limparBanco, fecharBanco } from './db.js';
import { query } from '../../src/db/pool.js';

test.after(() => fecharBanco());
test.beforeEach(() => prepararBanco());

test('limparBanco zera as tabelas e reinicia a identidade', async () => {
  await query(`INSERT INTO servicos (nome, preco) VALUES ('X', 10)`);
  await limparBanco();
  const r = await query('SELECT count(*)::int AS n FROM servicos');
  assert.equal(r.rows[0].n, 0);
  const ins = await query(`INSERT INTO servicos (nome, preco) VALUES ('Y', 10) RETURNING id`);
  assert.equal(ins.rows[0].id, 1);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/helpers/db.test.js`
Expected: FAIL — `./db.js` não encontrado.

- [ ] **Step 3: Implementar `test/helpers/db.js`**

```js
// test/helpers/db.js
import { pool } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';

const TABELAS = [
  'usuarios', 'clientes', 'servicos', 'configuracao', 'horario_funcionamento',
  'agenda_disponibilidade', 'bloqueios_agenda', 'agendamentos', 'horarios_lock',
  'templates_mensagem', 'mensagens_whatsapp', 'otp_codigos', 'logs_acesso',
];

let migrado = false;

export async function prepararBanco() {
  if (!migrado) {
    await migrar({ silent: true });
    migrado = true;
  }
  await limparBanco();
}

export async function limparBanco() {
  await pool.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function semearBase() {
  const { semear } = await import('../../src/db/seed.js'); // dinâmico: não exige a Task 8 no load
  await semear();
}

export async function fecharBanco() {
  await pool.end();
}
```

- [ ] **Step 4: Criar `scripts/reset.js`**

```js
// scripts/reset.js
import { migrar } from '../src/db/migrate.js';
import { pool } from '../src/db/pool.js';

const TABELAS = [
  'usuarios', 'clientes', 'servicos', 'configuracao', 'horario_funcionamento',
  'agenda_disponibilidade', 'bloqueios_agenda', 'agendamentos', 'horarios_lock',
  'templates_mensagem', 'mensagens_whatsapp', 'otp_codigos', 'logs_acesso',
];

await migrar({ silent: true });
await pool.query(`TRUNCATE ${TABELAS.join(', ')} RESTART IDENTITY CASCADE`);
const { semear } = await import('../src/db/seed.js'); // dinâmico: Task 8 preenche
await semear();
await pool.end();
console.log('banco recriado e semeado');
```

> `scripts/reset.js` só é executado manualmente (`npm run db:reset`) e não é coberto por teste nesta task; o `import` dinâmico de `seed.js` significa que ele só é resolvido em runtime, quando a Task 8 já existe.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/helpers/db.test.js`
Expected: PASS (1 teste).

- [ ] **Step 6: Commit**

```bash
git add test/helpers/db.js test/helpers/db.test.js scripts/reset.js
git commit -m "test: harness de banco (prepararBanco, limparBanco, fecharBanco)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `src/db/seed.js` — dados iniciais idempotentes

**Files:**
- Create: `src/db/seed.js`
- Create: `scripts/seed.js`
- Test: `test/db/seed.test.js`

(O harness da Task 7 já importa `seed.js` dinamicamente — nada a reativar.)

**Interfaces:**
- Consumes: `pool`, `config`, `bcrypt`, `renderizarTemplate` (não; textos são literais aqui).
- Produces:
  - `semear() => Promise<void>` — idempotente. Garante: `configuracao` id=1; 7 linhas em `horario_funcionamento` (domingo `aberto=false`, demais `true`, `09:00`–`19:30`); um `usuarios` role `admin` com email `config.ADMIN_EMAIL` e senha `bcrypt(config.ADMIN_SENHA, 12)`; `configuracao.barbeiro_padrao_id` apontando para esse admin; 3 serviços exemplo (se ainda não existirem por nome); os 3 templates (`confirmacao`, `lembrete_24h`, `pos_atendimento`) com os textos da spec seção 13.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/db/seed.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, fecharBanco } from '../helpers/db.js';
import { semear } from '../../src/db/seed.js';
import { query } from '../../src/db/pool.js';

test.after(() => fecharBanco());
test.beforeEach(() => prepararBanco());

test('semear é idempotente e cria a base', async () => {
  await semear();
  await semear();

  const cfg = await query('SELECT * FROM configuracao');
  assert.equal(cfg.rows.length, 1);
  assert.ok(cfg.rows[0].barbeiro_padrao_id);

  const func = await query('SELECT * FROM horario_funcionamento ORDER BY dia_semana');
  assert.equal(func.rows.length, 7);
  assert.equal(func.rows[0].aberto, false); // domingo

  const admin = await query(`SELECT * FROM usuarios WHERE role='admin'`);
  assert.equal(admin.rows.length, 1);
  assert.notEqual(admin.rows[0].senha_hash, '');

  const srv = await query('SELECT count(*)::int AS n FROM servicos');
  assert.equal(srv.rows[0].n, 3);

  const tpl = await query('SELECT chave FROM templates_mensagem ORDER BY chave');
  assert.deepEqual(tpl.rows.map((r) => r.chave), ['confirmacao', 'lembrete_24h', 'pos_atendimento']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/db/seed.test.js`
Expected: FAIL — `src/db/seed.js` não encontrado.

- [ ] **Step 3: Implementar `src/db/seed.js`**

```js
// src/db/seed.js
import bcrypt from 'bcrypt';
import { pool } from './pool.js';
import { config } from '../config.js';

const TEMPLATES = [
  ['confirmacao', 'Confirmação de agendamento',
`Olá, {{nome_cliente}}!
Seu agendamento para {{nome_servico}} está confirmado!
📅 Data: {{data}}
⏰ Horário: {{horario}}
📍 Local: {{endereco_barbearia}}
Para confirmar, responda SIM. Para cancelar ou remarcar, responda NÃO.`],
  ['lembrete_24h', 'Lembrete 24h',
`Olá, {{nome_cliente}}!
Lembrete: seu corte está agendado para amanhã às {{horario}}.
Estamos aguardando você! 💈`],
  ['pos_atendimento', 'Pós-atendimento',
`Olá, {{nome_cliente}}!
Obrigado por visitar nossa barbearia!
Esperamos vê-lo em breve. 💈
Indique para os amigos e ganhe desconto!`],
];

const SERVICOS = [
  ['Corte', 35, 45.0, 50.0],
  ['Barba', 35, 35.0, 50.0],
  ['Corte + Barba', 70, 70.0, 50.0],
];

export async function semear() {
  await pool.query(
    `INSERT INTO configuracao (id, nome_barbearia) VALUES (1, 'Minha Barbearia')
     ON CONFLICT (id) DO NOTHING`,
  );

  for (let dow = 0; dow <= 6; dow++) {
    await pool.query(
      `INSERT INTO horario_funcionamento (dia_semana, aberto, abre, fecha)
       VALUES ($1, $2, '09:00', '19:30') ON CONFLICT (dia_semana) DO NOTHING`,
      [dow, dow !== 0],
    );
  }

  const hash = await bcrypt.hash(config.ADMIN_SENHA, 12);
  const admin = await pool.query(
    `INSERT INTO usuarios (nome, email, senha_hash, role)
     VALUES ('Dono', $1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET nome = usuarios.nome
     RETURNING id`,
    [config.ADMIN_EMAIL, hash],
  );
  await pool.query(
    `UPDATE configuracao SET barbeiro_padrao_id = $1
     WHERE id = 1 AND barbeiro_padrao_id IS NULL`,
    [admin.rows[0].id],
  );

  for (const [nome, dur, preco, com] of SERVICOS) {
    await pool.query(
      `INSERT INTO servicos (nome, duracao_minutos, preco, comissao_percentual)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (SELECT 1 FROM servicos WHERE nome = $1)`,
      [nome, dur, preco, com],
    );
  }

  for (const [chave, titulo, corpo] of TEMPLATES) {
    await pool.query(
      `INSERT INTO templates_mensagem (chave, titulo, corpo)
       VALUES ($1, $2, $3) ON CONFLICT (chave) DO NOTHING`,
      [chave, titulo, corpo],
    );
  }
}
```

- [ ] **Step 4: Criar `scripts/seed.js`**

```js
// scripts/seed.js
import { semear } from '../src/db/seed.js';
import { fecharPool } from '../src/db/pool.js';

semear()
  .then(() => fecharPool())
  .then(() => console.log('seed aplicado'))
  .catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test -- test/db/seed.test.js test/helpers/db.test.js`
Expected: PASS (2 arquivos, 2 testes).

- [ ] **Step 6: Verificar `db:reset`**

Run: `npm run db:reset`
Expected: imprime "banco recriado e semeado", sai 0 (roda no schema `public`).

- [ ] **Step 7: Commit**

```bash
git add src/db/seed.js scripts/seed.js test/db/seed.test.js
git commit -m "feat: seed idempotente (configuração, expediente, admin, serviços, templates)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `src/services/comissao.js`

**Files:**
- Create: `src/services/comissao.js`
- Test: `test/services/comissao.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `calcularComissao(preco: number|string, percentual: number|string) => number` — arredondado a 2 casas.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/services/comissao.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularComissao } from '../../src/services/comissao.js';

test('calcula percentual simples', () => {
  assert.equal(calcularComissao(45.0, 50.0), 22.5);
  assert.equal(calcularComissao(70.0, 50.0), 35);
});

test('aceita strings vindas do NUMERIC do pg', () => {
  assert.equal(calcularComissao('33.33', '40.00'), 13.33);
});

test('arredonda a 2 casas', () => {
  assert.equal(calcularComissao(19.99, 33.0), 6.6);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/services/comissao.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/services/comissao.js
export function calcularComissao(preco, percentual) {
  const p = Number(preco);
  const pct = Number(percentual);
  return Math.round(p * pct) / 100;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/services/comissao.test.js`
Expected: PASS (3 testes). (`33.33*40 = 1333.2 → round 1333 → 13.33`; `19.99*33 = 659.67 → round 660 → 6.6`.)

- [ ] **Step 5: Commit**

```bash
git add src/services/comissao.js test/services/comissao.test.js
git commit -m "feat: calcularComissao com arredondamento a 2 casas

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: `src/agenda/cache.js` — cache em memória com TTL

**Files:**
- Create: `src/agenda/cache.js`
- Test: `test/agenda/cache.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `chaveDisponibilidade(barbeiroId, data, servicoId) => string` — `disp:<b>:<data>:<s>`
  - `get(chave) => any | undefined` — `undefined` se ausente ou expirado (e remove o expirado)
  - `set(chave, valor, ttlMs = 30000) => void`
  - `invalidarData(data) => void` — remove toda chave que contenha `:<data>:`
  - `limparTudo() => void`

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/cache.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as cache from '../../src/agenda/cache.js';

test.beforeEach(() => cache.limparTudo());

test('get devolve o valor setado', () => {
  const k = cache.chaveDisponibilidade(1, '2026-09-10', 2);
  cache.set(k, { a: 1 });
  assert.deepEqual(cache.get(k), { a: 1 });
});

test('get devolve undefined após o TTL', async () => {
  const k = cache.chaveDisponibilidade(1, '2026-09-10', 2);
  cache.set(k, 'x', 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(cache.get(k), undefined);
});

test('invalidarData remove só as chaves daquela data', () => {
  cache.set(cache.chaveDisponibilidade(1, '2026-09-10', 2), 'a');
  cache.set(cache.chaveDisponibilidade(1, '2026-09-11', 2), 'b');
  cache.invalidarData('2026-09-10');
  assert.equal(cache.get(cache.chaveDisponibilidade(1, '2026-09-10', 2)), undefined);
  assert.equal(cache.get(cache.chaveDisponibilidade(1, '2026-09-11', 2)), 'b');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/cache.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/agenda/cache.js
const store = new Map();

export function chaveDisponibilidade(barbeiroId, data, servicoId) {
  return `disp:${barbeiroId}:${data}:${servicoId}`;
}

export function get(chave) {
  const item = store.get(chave);
  if (!item) return undefined;
  if (item.expiraEm <= Date.now()) {
    store.delete(chave);
    return undefined;
  }
  return item.valor;
}

export function set(chave, valor, ttlMs = 30_000) {
  store.set(chave, { valor, expiraEm: Date.now() + ttlMs });
}

export function invalidarData(data) {
  for (const chave of store.keys()) {
    if (chave.includes(`:${data}:`)) store.delete(chave);
  }
}

export function limparTudo() {
  store.clear();
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/cache.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/cache.js test/agenda/cache.test.js
git commit -m "feat: cache em memória de disponibilidade com TTL e invalidarData

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: `src/agenda/slots.js` — geração de horários do dia

**Files:**
- Create: `src/agenda/slots.js`
- Test: `test/agenda/slots.test.js`

**Interfaces:**
- Consumes: `paraMinutos`, `paraHHMM` de `src/lib/tempo.js`.
- Produces: `gerarSlots({ abre, fecha, intervaloMinutos, duracaoServico }) => string[]` — do `abre` ao último horário `t` tal que `t + duracaoServico <= fecha`, passo `intervaloMinutos`. `[]` se `fecha <= abre` ou se nem o primeiro slot cabe.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/slots.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarSlots } from '../../src/agenda/slots.js';

test('09:00–19:30, passo 35, serviço 35: primeiro 09:00, último 18:55', () => {
  const s = gerarSlots({ abre: '09:00', fecha: '19:30', intervaloMinutos: 35, duracaoServico: 35 });
  assert.equal(s[0], '09:00');
  assert.equal(s[1], '09:35');
  assert.equal(s.at(-1), '18:55');
});

test('serviço de 50 min encurta a cauda (último 18:20)', () => {
  const s = gerarSlots({ abre: '09:00', fecha: '19:30', intervaloMinutos: 35, duracaoServico: 50 });
  assert.equal(s.at(-1), '18:20');
});

test('dia sem janela útil devolve vazio', () => {
  assert.deepEqual(gerarSlots({ abre: '19:00', fecha: '19:20', intervaloMinutos: 35, duracaoServico: 35 }), []);
  assert.deepEqual(gerarSlots({ abre: '19:30', fecha: '09:00', intervaloMinutos: 35, duracaoServico: 35 }), []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/slots.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/agenda/slots.js
import { paraMinutos, paraHHMM } from '../lib/tempo.js';

export function gerarSlots({ abre, fecha, intervaloMinutos, duracaoServico }) {
  const inicio = paraMinutos(abre);
  const fim = paraMinutos(fecha);
  const slots = [];
  for (let t = inicio; t + duracaoServico <= fim; t += intervaloMinutos) {
    slots.push(paraHHMM(t));
  }
  return slots;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/slots.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/slots.js test/agenda/slots.test.js
git commit -m "feat: gerarSlots a partir do expediente e da duração do serviço

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: `src/agenda/disponibilidade.js` — base (mês, dia, expediente, antecedência, locks)

**Files:**
- Create: `src/agenda/disponibilidade.js`
- Test: `test/agenda/disponibilidade-base.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`; `gerarSlots`; `paraMinutos` de `lib/tempo`; `* as cache`.
- Produces:
  - `horariosDisponiveis({ barbeiroId, data, servicoId, sessionId = null, agora = new Date() }) => Promise<{ disponivel: string[], fechado: string|null }>`
    - `fechado` ∈ `null | 'mes_fechado' | 'dia_fechado' | 'servico_invalido'` nesta task (mais valores na Task 13).
  - Interno (não exportado ainda): `calcularBase(exec, { barbeiroId, data, servicoId }) => Promise<{ slots?: string[], duracao?: number, antecedenciaHoras?: number, abre?: string, fecha?: string, fechado: string|null }>`
- Comportamento: `horariosDisponiveis` consulta o cache pela `chaveDisponibilidade`; em miss, chama `calcularBase(query, ...)` e cacheia. Depois do cache aplica, **sempre**: filtro de antecedência (usa `agora`) e remoção de locks de terceiros (usa `sessionId`).
- `exec` é uma função `(text, params) => Promise<pg.QueryResult>` — pode ser `query` do pool ou `(t,p) => client.query(t,p)`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/disponibilidade-base.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { horariosDisponiveis } from '../../src/agenda/disponibilidade.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function barbeiro() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0].id;
}
async function servicoCorte() {
  const r = await query(`SELECT id FROM servicos WHERE nome='Corte'`);
  return r.rows[0].id;
}
// 2026-09-10 é quinta-feira
const DATA = '2026-09-10';
async function abrirSetembro(bId) {
  await query(
    `INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
     VALUES (2026, 9, NULL, 'aberto')`,
  );
}

test('mês não liberado => fechado: mes_fechado', async () => {
  const bId = await barbeiro();
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') });
  assert.equal(r.fechado, 'mes_fechado');
  assert.deepEqual(r.disponivel, []);
});

test('mês liberado, dia útil => lista slots do expediente', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') });
  assert.equal(r.fechado, null);
  assert.equal(r.disponivel[0], '09:00');
  assert.equal(r.disponivel.at(-1), '18:55');
});

test('filtro de antecedência esconde os slots cedo demais', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  // agora = mesmo dia 09:00, antecedência padrão 2h => primeiro slot >= 11:00
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-10T09:00:00') });
  assert.ok(!r.disponivel.includes('09:00'));
  assert.ok(!r.disponivel.includes('10:45'));
  assert.ok(r.disponivel.includes('11:20'));
});

test('domingo (dia_semana 0) => fechado: dia_fechado', async () => {
  const bId = await barbeiro();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, NULL, 'aberto')`);
  const r = await horariosDisponiveis({ barbeiroId: bId, data: '2026-09-13', servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') }); // 2026-09-13 é domingo
  assert.equal(r.fechado, 'dia_fechado');
});

test('lock de outra sessão remove o slot; o da própria sessão não', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  await query(
    `INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
     VALUES ($1, $2, '14:00', 'sessao-A', now() + interval '5 minutes')`, [bId, DATA]);

  const outro = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    sessionId: 'sessao-B', agora: new Date('2026-09-01T08:00:00') });
  assert.ok(!outro.disponivel.includes('14:00'));

  cache.limparTudo();
  const dono = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    sessionId: 'sessao-A', agora: new Date('2026-09-01T08:00:00') });
  assert.ok(dono.disponivel.includes('14:00'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/disponibilidade-base.test.js`
Expected: FAIL — `src/agenda/disponibilidade.js` não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/agenda/disponibilidade.js
import { query } from '../db/pool.js';
import { gerarSlots } from './slots.js';
import { paraMinutos } from '../lib/tempo.js';
import * as cache from './cache.js';

function dowUTC(data) {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo
}

export async function calcularBase(exec, { barbeiroId, data, servicoId }) {
  const [ano, mes] = data.split('-').map(Number);

  const disp = await exec(
    `SELECT 1 FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto'
       AND (barbeiro_id IS NULL OR barbeiro_id=$3) LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  if (disp.rowCount === 0) return { fechado: 'mes_fechado' };

  const func = await exec(
    `SELECT aberto, to_char(abre,'HH24:MI') AS abre, to_char(fecha,'HH24:MI') AS fecha
     FROM horario_funcionamento WHERE dia_semana=$1`,
    [dowUTC(data)],
  );
  if (func.rowCount === 0 || !func.rows[0].aberto) return { fechado: 'dia_fechado' };
  const { abre, fecha } = func.rows[0];

  const cfg = await exec(
    `SELECT intervalo_minutos, antecedencia_min_horas FROM configuracao WHERE id=1`,
  );
  const { intervalo_minutos, antecedencia_min_horas } = cfg.rows[0];

  const srv = await exec(`SELECT duracao_minutos FROM servicos WHERE id=$1 AND ativo`, [servicoId]);
  if (srv.rowCount === 0) return { fechado: 'servico_invalido' };
  const duracao = srv.rows[0].duracao_minutos;

  const slots = gerarSlots({
    abre, fecha, intervaloMinutos: intervalo_minutos, duracaoServico: duracao,
  });

  return { slots, duracao, antecedenciaHoras: antecedencia_min_horas, abre, fecha, fechado: null };
}

export async function horariosDisponiveis({
  barbeiroId, data, servicoId, sessionId = null, agora = new Date(),
}) {
  const chave = cache.chaveDisponibilidade(barbeiroId, data, servicoId);
  let base = cache.get(chave);
  if (!base) {
    base = await calcularBase(query, { barbeiroId, data, servicoId });
    cache.set(chave, base);
  }
  if (base.fechado) return { disponivel: [], fechado: base.fechado };

  const limite = new Date(agora.getTime() + base.antecedenciaHoras * 3_600_000);
  let livres = base.slots.filter((s) => new Date(`${data}T${s}:00`) >= limite);

  const locks = await query(
    `SELECT to_char(horario,'HH24:MI') AS horario FROM horarios_lock
     WHERE barbeiro_id=$1 AND data=$2 AND expira_em > now()
       AND ($3::text IS NULL OR session_id <> $3)`,
    [barbeiroId, data, sessionId],
  );
  const travados = new Set(locks.rows.map((r) => r.horario));
  livres = livres.filter((s) => !travados.has(s));

  return { disponivel: livres, fechado: null };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/disponibilidade-base.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/disponibilidade.js test/agenda/disponibilidade-base.test.js
git commit -m "feat: disponibilidade base (mês liberado, expediente, antecedência, locks de terceiros)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: `disponibilidade.js` — subtração de agendamentos/bloqueios/limite e `verificarSlot`

**Files:**
- Modify: `src/agenda/disponibilidade.js`
- Test: `test/agenda/disponibilidade-subtracao.test.js`

**Interfaces:**
- Consumes: o mesmo da Task 12 + `sobrepoe` de `lib/tempo` (ou reuso do cálculo em minutos).
- Produces (novos/alterados):
  - `calcularBase` agora também remove de `slots`: qualquer slot cujo `[ini, ini+duracao)` se sobrepõe a um agendamento ativo (`status IN ('pendente','confirmado')`) do dia/barbeiro, ou a um bloqueio (`bloqueios_agenda` do dia, global ou do barbeiro; sem hora = expediente inteiro). E: se o mês liberado tem `limite_por_dia` e a contagem de ativos do dia ≥ limite, retorna `{ fechado: 'limite_atingido' }`.
  - `verificarSlot(exec, { barbeiroId, data, horario, duracaoMinutos, agora = new Date() }) => Promise<{ ok: true } | { ok: false, erro }>`
    - `erro` ∈ `'MES_FECHADO' | 'DIA_FECHADO' | 'FORA_DO_EXPEDIENTE' | 'ANTECEDENCIA' | 'HORARIO_INDISPONIVEL' | 'LIMITE_ATINGIDO' | 'SERVICO_INVALIDO'`
    - Reusa `calcularBase(exec, ...)` chamando com um `servicoId` fictício? Não: `verificarSlot` recebe `duracaoMinutos` diretamente. Implementar consultando as mesmas fontes que `calcularBase`, mas decidindo para **um** horário: mês aberto? dia aberto? `[horario, horario+duracao)` cabe em `[abre, fecha)`? respeita antecedência vs `agora`? não sobrepõe agendamento ativo? não sobrepõe bloqueio? limite não atingido? Primeira que falhar define `erro`.
    - `verificarSlot` **não** usa cache (é chamado dentro da transação de confirmação).
  - Exportar `verificarSlot`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/disponibilidade-subtracao.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { horariosDisponiveis, verificarSlot } from '../../src/agenda/disponibilidade.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

const DATA = '2026-09-10';
const CEDO = new Date('2026-09-01T08:00:00');

async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, duracao_minutos FROM servicos WHERE nome='Corte'`)).rows[0];
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, NULL, 'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('C','1') RETURNING id`)).rows[0].id;
  return { b, servicoId: s.id, duracao: s.duracao_minutos, cli };
}
async function agendar(b, cli, servicoId, ini, fim, status = 'confirmado') {
  await query(
    `INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento,
       horario_inicio, horario_fim, status, valor_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7, 10)`, [cli, servicoId, b, DATA, ini, fim, status]);
}

test('agendamento ativo remove o slot exato e os sobrepostos', async () => {
  const { b, servicoId, cli } = await ctx();
  await agendar(b, cli, servicoId, '10:10', '10:45');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(!r.disponivel.includes('10:10'));
  assert.ok(!r.disponivel.includes('09:35')); // 09:35–10:10 encosta, não sobrepõe → continua
  assert.ok(r.disponivel.includes('09:35'));
});

test('agendamento cancelado NÃO remove o slot', async () => {
  const { b, servicoId, cli } = await ctx();
  await agendar(b, cli, servicoId, '10:10', '10:45', 'cancelado');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(r.disponivel.includes('10:10'));
});

test('serviço de 50 min é barrado por agendamento no passo seguinte', async () => {
  const { b, cli } = await ctx();
  const s50 = (await query(
    `INSERT INTO servicos (nome, duracao_minutos, preco) VALUES ('Longo', 50, 80) RETURNING id`)).rows[0].id;
  const corte = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await agendar(b, cli, corte, '10:10', '10:45');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId: s50, agora: CEDO });
  assert.ok(!r.disponivel.includes('09:35')); // 09:35+50=10:25 invade 10:10–10:45
});

test('bloqueio de dia inteiro zera a lista', async () => {
  const { b, servicoId } = await ctx();
  await query(`INSERT INTO bloqueios_agenda (data, motivo) VALUES ($1, 'feriado')`, [DATA]);
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.deepEqual(r.disponivel, []);
});

test('bloqueio de faixa remove só a faixa', async () => {
  const { b, servicoId } = await ctx();
  await query(`INSERT INTO bloqueios_agenda (data, hora_inicio, hora_fim, motivo)
    VALUES ($1, '12:00', '13:00', 'almoço')`, [DATA]);
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(!r.disponivel.includes('11:55')); // 11:55–12:30 invade
  assert.ok(r.disponivel.includes('13:05'));
});

test('limite_por_dia atingido => fechado: limite_atingido', async () => {
  const { b, servicoId, cli } = await ctx();
  await query(`UPDATE agenda_disponibilidade SET limite_por_dia = 1 WHERE ano=2026 AND mes=9`);
  await agendar(b, cli, servicoId, '09:00', '09:35');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.equal(r.fechado, 'limite_atingido');
});

test('verificarSlot: ok para slot livre, erros específicos para os casos', async () => {
  const { b, servicoId, duracao, cli } = await ctx();
  assert.deepEqual(
    await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '14:00', duracaoMinutos: duracao, agora: CEDO }),
    { ok: true });

  await agendar(b, cli, servicoId, '14:00', '14:35');
  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '14:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'HORARIO_INDISPONIVEL');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '20:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'FORA_DO_EXPEDIENTE');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: '2026-10-10', horario: '10:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'MES_FECHADO');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '09:00', duracaoMinutos: duracao,
      agora: new Date('2026-09-10T08:30:00') })).erro,
    'ANTECEDENCIA');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/disponibilidade-subtracao.test.js`
Expected: FAIL — `verificarSlot` não exportado / subtração ausente.

- [ ] **Step 3: Implementar — estender `calcularBase` e adicionar `verificarSlot`**

Em `src/agenda/disponibilidade.js`, adicionar helper de consulta de ocupação e alterar `calcularBase` para aplicar a subtração antes do `return` de sucesso; adicionar e exportar `verificarSlot`.

```js
// --- adicionar ao topo dos imports ---
// (paraMinutos já importado)

// helper: ranges ocupados (agendamentos ativos + bloqueios) em minutos
async function rangesOcupados(exec, { barbeiroId, data, abre, fecha }) {
  const ativos = await exec(
    `SELECT to_char(horario_inicio,'HH24:MI') AS ini, to_char(horario_fim,'HH24:MI') AS fim
     FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND status IN ('pendente','confirmado')`,
    [barbeiroId, data],
  );
  const bloqueios = await exec(
    `SELECT to_char(hora_inicio,'HH24:MI') AS ini, to_char(hora_fim,'HH24:MI') AS fim
     FROM bloqueios_agenda
     WHERE data=$1 AND (barbeiro_id IS NULL OR barbeiro_id=$2)`,
    [data, barbeiroId],
  );
  const ranges = [];
  for (const r of ativos.rows) ranges.push([paraMinutos(r.ini), paraMinutos(r.fim)]);
  for (const r of bloqueios.rows) {
    ranges.push(r.ini ? [paraMinutos(r.ini), paraMinutos(r.fim)]
                      : [paraMinutos(abre), paraMinutos(fecha)]);
  }
  return ranges;
}

function invade(ini, fim, ranges) {
  return ranges.some(([oIni, oFim]) => ini < oFim && oIni < fim);
}

async function contarAtivos(exec, barbeiroId, data) {
  const r = await exec(
    `SELECT count(*)::int AS n FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND status IN ('pendente','confirmado')`,
    [barbeiroId, data],
  );
  return r.rows[0].n;
}

async function limitePorDia(exec, ano, mes, barbeiroId) {
  const r = await exec(
    `SELECT limite_por_dia FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto' AND (barbeiro_id IS NULL OR barbeiro_id=$3)
     ORDER BY barbeiro_id NULLS LAST LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  return r.rows[0]?.limite_por_dia ?? null;
}
```

Alterar o final de `calcularBase` (logo antes do `return { slots, ... }`):

```js
  const [anoN, mesN] = data.split('-').map(Number);
  const limite = await limitePorDia(exec, anoN, mesN, barbeiroId);
  if (limite != null && (await contarAtivos(exec, barbeiroId, data)) >= limite) {
    return { fechado: 'limite_atingido' };
  }

  const ranges = await rangesOcupados(exec, { barbeiroId, data, abre, fecha });
  const slotsLivres = slots.filter((s) => {
    const ini = paraMinutos(s);
    return !invade(ini, ini + duracao, ranges);
  });

  return { slots: slotsLivres, duracao, antecedenciaHoras: antecedencia_min_horas, abre, fecha, fechado: null };
```

Adicionar `verificarSlot`:

```js
export async function verificarSlot(exec, { barbeiroId, data, horario, duracaoMinutos, agora = new Date() }) {
  const [ano, mes] = data.split('-').map(Number);

  const disp = await exec(
    `SELECT 1 FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto' AND (barbeiro_id IS NULL OR barbeiro_id=$3) LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  if (disp.rowCount === 0) return { ok: false, erro: 'MES_FECHADO' };

  const func = await exec(
    `SELECT aberto, to_char(abre,'HH24:MI') AS abre, to_char(fecha,'HH24:MI') AS fecha
     FROM horario_funcionamento WHERE dia_semana=$1`, [dowUTC(data)],
  );
  if (func.rowCount === 0 || !func.rows[0].aberto) return { ok: false, erro: 'DIA_FECHADO' };
  const { abre, fecha } = func.rows[0];

  const ini = paraMinutos(horario);
  const fim = ini + duracaoMinutos;
  if (ini < paraMinutos(abre) || fim > paraMinutos(fecha)) return { ok: false, erro: 'FORA_DO_EXPEDIENTE' };

  const cfg = await exec(`SELECT antecedencia_min_horas FROM configuracao WHERE id=1`);
  const limite = new Date(agora.getTime() + cfg.rows[0].antecedencia_min_horas * 3_600_000);
  if (new Date(`${data}T${horario}:00`) < limite) return { ok: false, erro: 'ANTECEDENCIA' };

  const lim = await limitePorDia(exec, ano, mes, barbeiroId);
  if (lim != null && (await contarAtivos(exec, barbeiroId, data)) >= lim) {
    return { ok: false, erro: 'LIMITE_ATINGIDO' };
  }

  const ranges = await rangesOcupados(exec, { barbeiroId, data, abre, fecha });
  if (invade(ini, fim, ranges)) return { ok: false, erro: 'HORARIO_INDISPONIVEL' };

  return { ok: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/disponibilidade-subtracao.test.js test/agenda/disponibilidade-base.test.js`
Expected: PASS (ambos os arquivos).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/disponibilidade.js test/agenda/disponibilidade-subtracao.test.js
git commit -m "feat: subtração de agendamentos/bloqueios/limite e verificarSlot transacional

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: `src/agenda/locks.js` — reserva temporária

**Files:**
- Create: `src/agenda/locks.js`
- Test: `test/agenda/locks.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`.
- Produces:
  - `criarLock({ barbeiroId, data, horario, sessionId }) => Promise<{ ok: true } | { ok: false, erro: 'SLOT_OCUPADO' | 'SLOT_TRAVADO' }>` — `SLOT_OCUPADO` se já há agendamento ativo no slot; `SLOT_TRAVADO` se há lock vivo de outra sessão. Renova se a própria sessão pedir de novo, ou toma se o lock anterior expirou. Duração: 5 minutos.
  - `renovarLock({ barbeiroId, data, horario, sessionId }) => Promise<{ ok: boolean }>` — estende `expira_em` por mais 5 min; `ok:false` se não existe lock dessa sessão nesse slot.
  - `liberarLock({ barbeiroId, data, horario, sessionId }) => Promise<{ ok: true }>` — apaga só o lock da própria sessão.
  - `limparExpirados() => Promise<{ removidos: number }>` — `DELETE ... WHERE expira_em < now()`.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/locks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { criarLock, renovarLock, liberarLock, limparExpirados } from '../../src/agenda/locks.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

const DATA = '2026-09-10';
async function bId() {
  return (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
}

test('primeira sessão trava; segunda recebe SLOT_TRAVADO', async () => {
  const b = await bId();
  assert.deepEqual(await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' }), { ok: true });
  assert.deepEqual(await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'B' }),
    { ok: false, erro: 'SLOT_TRAVADO' });
});

test('a mesma sessão pode renovar via criarLock', async () => {
  const b = await bId();
  await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' });
  assert.deepEqual(await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' }), { ok: true });
});

test('lock expirado pode ser tomado por outra sessão', async () => {
  const b = await bId();
  await query(
    `INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
     VALUES ($1, $2, '10:10', 'A', now() - interval '1 minute')`, [b, DATA]);
  assert.deepEqual(await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'B' }), { ok: true });
});

test('SLOT_OCUPADO quando já existe agendamento ativo', async () => {
  const b = await bId();
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('C','1') RETURNING id`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(
    `INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento,
       horario_inicio, horario_fim, status, valor_total)
     VALUES ($1,$2,$3,$4,'10:10','10:45','confirmado',10)`, [cli, s, b, DATA]);
  assert.deepEqual(await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' }),
    { ok: false, erro: 'SLOT_OCUPADO' });
});

test('renovarLock só funciona para a sessão dona; liberarLock apaga só o próprio', async () => {
  const b = await bId();
  await criarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' });
  assert.equal((await renovarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'B' })).ok, false);
  assert.equal((await renovarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' })).ok, true);
  await liberarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'B' });
  assert.equal((await query('SELECT count(*)::int n FROM horarios_lock')).rows[0].n, 1);
  await liberarLock({ barbeiroId: b, data: DATA, horario: '10:10', sessionId: 'A' });
  assert.equal((await query('SELECT count(*)::int n FROM horarios_lock')).rows[0].n, 0);
});

test('limparExpirados remove os vencidos e conta', async () => {
  const b = await bId();
  await query(`INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
    VALUES ($1,$2,'09:00','X', now() - interval '1 minute'),
           ($1,$2,'09:35','Y', now() + interval '5 minutes')`, [b, DATA]);
  assert.deepEqual(await limparExpirados(), { removidos: 1 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/locks.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/agenda/locks.js
import { query } from '../db/pool.js';

const LOCK_MINUTOS = 5;

export async function criarLock({ barbeiroId, data, horario, sessionId }) {
  const ocupado = await query(
    `SELECT 1 FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND horario_inicio=$3
       AND status IN ('pendente','confirmado') LIMIT 1`,
    [barbeiroId, data, horario],
  );
  if (ocupado.rowCount > 0) return { ok: false, erro: 'SLOT_OCUPADO' };

  const res = await query(
    `INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
     VALUES ($1, $2, $3, $4, now() + interval '${LOCK_MINUTOS} minutes')
     ON CONFLICT (barbeiro_id, data, horario) DO UPDATE
       SET session_id = EXCLUDED.session_id,
           expira_em  = EXCLUDED.expira_em,
           criado_em  = now()
     WHERE horarios_lock.session_id = EXCLUDED.session_id
        OR horarios_lock.expira_em < now()
     RETURNING id`,
    [barbeiroId, data, horario, sessionId],
  );
  return res.rowCount === 0 ? { ok: false, erro: 'SLOT_TRAVADO' } : { ok: true };
}

export async function renovarLock({ barbeiroId, data, horario, sessionId }) {
  const res = await query(
    `UPDATE horarios_lock SET expira_em = now() + interval '${LOCK_MINUTOS} minutes'
     WHERE barbeiro_id=$1 AND data=$2 AND horario=$3 AND session_id=$4`,
    [barbeiroId, data, horario, sessionId],
  );
  return { ok: res.rowCount > 0 };
}

export async function liberarLock({ barbeiroId, data, horario, sessionId }) {
  await query(
    `DELETE FROM horarios_lock
     WHERE barbeiro_id=$1 AND data=$2 AND horario=$3 AND session_id=$4`,
    [barbeiroId, data, horario, sessionId],
  );
  return { ok: true };
}

export async function limparExpirados() {
  const res = await query(`DELETE FROM horarios_lock WHERE expira_em < now()`);
  return { removidos: res.rowCount };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/locks.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/locks.js test/agenda/locks.test.js
git commit -m "feat: locks temporários (criar/renovar/liberar/limparExpirados) com exclusão atômica

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: `src/agenda/agendar.js` — `confirmarAgendamento`

**Files:**
- Create: `src/agenda/agendar.js`
- Test: `test/agenda/confirmar.test.js`

**Interfaces:**
- Consumes: `withTransaction` de `src/db/pool.js`; `adicionarMinutos` de `lib/tempo`; `calcularComissao`; `verificarSlot` de `disponibilidade.js`; `renderizarTemplate` de `lib/template`.
- Produces:
  - `confirmarAgendamento({ clienteId, servicoId, barbeiroId, data, horario, sessionId, observacoes = null, agora = new Date() }) => Promise<{ ok: true, agendamento } | { ok: false, erro }>`
    - `erro` ∈ os de `verificarSlot` + `'SERVICO_INVALIDO'` + `'HORARIO_INDISPONIVEL'` (colisão no INSERT, código pg `23505`).
    - Passos na transação: (1) `SELECT` serviço ativo → duração/preço/percentual; (2) `verificarSlot(c.query.bind(c), ...)`; (3) `INSERT` em `agendamentos` (`status='pendente'`), capturando `23505` → `HORARIO_INDISPONIVEL`; (4) `DELETE` do lock do slot (qualquer sessão); (5) `UPDATE clientes.ultimo_agendamento`; (6) `INSERT` em `mensagens_whatsapp` com o template `confirmacao` renderizado, `status='pendente'`; (7) retorna a linha inserida.
- Nota: emitir eventos de tempo real e invalidar cache é responsabilidade da **rota** (P2), não desta função.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/confirmar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

const DATA = '2026-09-10';
const CEDO = new Date('2026-09-01T08:00:00');

async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','11999') RETURNING id`)).rows[0].id;
  return { b, s, cli };
}

test('cria agendamento pendente, grava comissão e mensagem, remove lock', async () => {
  const { b, s, cli } = await ctx();
  await query(`INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
    VALUES ($1,$2,'14:00','sess', now() + interval '5 minutes')`, [b, DATA]);

  const r = await confirmarAgendamento({
    clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '14:00',
    sessionId: 'sess', agora: CEDO,
  });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.status, 'pendente');
  assert.equal(Number(r.agendamento.valor_total), 45);
  assert.equal(Number(r.agendamento.comissao_valor), 22.5);
  assert.equal(r.agendamento.horario_fim, '14:35:00');

  assert.equal((await query('SELECT count(*)::int n FROM horarios_lock')).rows[0].n, 0);
  const msg = await query(`SELECT * FROM mensagens_whatsapp WHERE agendamento_id=$1`, [r.agendamento.id]);
  assert.equal(msg.rows.length, 1);
  assert.equal(msg.rows[0].status_envio, 'pendente');
  assert.match(msg.rows[0].mensagem_final, /Ana/);
  const c = await query(`SELECT ultimo_agendamento FROM clientes WHERE id=$1`, [cli]);
  assert.equal(c.rows[0].ultimo_agendamento.toISOString().slice(0, 10), DATA);
});

test('segundo agendamento no mesmo slot => HORARIO_INDISPONIVEL', async () => {
  const { b, s, cli } = await ctx();
  const ok = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '15:00', sessionId: 'x', agora: CEDO });
  assert.equal(ok.ok, true);
  const dup = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '15:00', sessionId: 'y', agora: CEDO });
  assert.deepEqual(dup, { ok: false, erro: 'HORARIO_INDISPONIVEL' });
});

test('revalida no servidor mesmo com payload adulterado (mês fechado)', async () => {
  const { b, s, cli } = await ctx();
  const r = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: '2026-12-24', horario: '10:00', sessionId: 'x', agora: CEDO });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'MES_FECHADO');
});

test('serviço inexistente => SERVICO_INVALIDO', async () => {
  const { b, cli } = await ctx();
  const r = await confirmarAgendamento({ clienteId: cli, servicoId: 9999, barbeiroId: b, data: DATA, horario: '10:00', sessionId: 'x', agora: CEDO });
  assert.deepEqual(r, { ok: false, erro: 'SERVICO_INVALIDO' });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/confirmar.test.js`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

```js
// src/agenda/agendar.js
import { withTransaction } from '../db/pool.js';
import { adicionarMinutos } from '../lib/tempo.js';
import { renderizarTemplate } from '../lib/template.js';
import { calcularComissao } from '../services/comissao.js';
import { verificarSlot } from './disponibilidade.js';

function execDe(client) {
  return (text, params) => client.query(text, params);
}

async function enfileirarConfirmacao(exec, agendamento) {
  const dados = await exec(
    `SELECT c.nome AS cliente_nome, c.celular, s.nome AS servico_nome,
            cf.nome_barbearia, cf.endereco
     FROM agendamentos a
     JOIN clientes c ON c.id = a.cliente_id
     JOIN servicos s ON s.id = a.servico_id
     CROSS JOIN configuracao cf
     WHERE a.id = $1 AND cf.id = 1`,
    [agendamento.id],
  );
  const d = dados.rows[0];
  const tpl = await exec(`SELECT corpo FROM templates_mensagem WHERE chave='confirmacao' AND ativo`);
  if (tpl.rowCount === 0) return;
  const texto = renderizarTemplate(tpl.rows[0].corpo, {
    nome_cliente: d.cliente_nome,
    nome_servico: d.servico_nome,
    data: agendamento.data_agendamento.toISOString().slice(0, 10),
    horario: String(agendamento.horario_inicio).slice(0, 5),
    endereco_barbearia: d.endereco ?? '',
    nome_barbearia: d.nome_barbearia,
  });
  await exec(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1, 'confirmacao', $2, $3, 'pendente')`,
    [agendamento.id, d.celular, texto],
  );
}

export async function confirmarAgendamento({
  clienteId, servicoId, barbeiroId, data, horario,
  sessionId, observacoes = null, agora = new Date(),
}) {
  return withTransaction(async (c) => {
    const exec = execDe(c);

    const srv = await exec(
      `SELECT duracao_minutos, preco, comissao_percentual FROM servicos WHERE id=$1 AND ativo`,
      [servicoId],
    );
    if (srv.rowCount === 0) return { ok: false, erro: 'SERVICO_INVALIDO' };
    const { duracao_minutos, preco, comissao_percentual } = srv.rows[0];
    const horarioFim = adicionarMinutos(horario, duracao_minutos);

    const val = await verificarSlot(exec, {
      barbeiroId, data, horario, duracaoMinutos: duracao_minutos, agora,
    });
    if (!val.ok) return val;

    let ins;
    try {
      ins = await exec(
        `INSERT INTO agendamentos
           (cliente_id, servico_id, barbeiro_id, data_agendamento,
            horario_inicio, horario_fim, status, valor_total, comissao_valor, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,$9)
         RETURNING *`,
        [clienteId, servicoId, barbeiroId, data, horario, horarioFim,
         preco, calcularComissao(preco, comissao_percentual), observacoes],
      );
    } catch (err) {
      if (err.code === '23505') return { ok: false, erro: 'HORARIO_INDISPONIVEL' };
      throw err;
    }

    await exec(
      `DELETE FROM horarios_lock WHERE barbeiro_id=$1 AND data=$2 AND horario=$3`,
      [barbeiroId, data, horario],
    );
    await exec(`UPDATE clientes SET ultimo_agendamento=$1 WHERE id=$2`, [data, clienteId]);
    await enfileirarConfirmacao(exec, ins.rows[0]);

    return { ok: true, agendamento: ins.rows[0] };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/confirmar.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/agendar.js test/agenda/confirmar.test.js
git commit -m "feat: confirmarAgendamento com revalidação transacional e enfileiramento da confirmação

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: Teste de concorrência de `confirmarAgendamento`

**Files:**
- Test: `test/agenda/confirmar-concorrencia.test.js`

**Interfaces:**
- Consumes: `confirmarAgendamento`.
- Produces: nenhum código novo — é a prova da regra crítica "dois clientes, mesmo horário → só o primeiro".

- [ ] **Step 1: Escrever o teste**

```js
// test/agenda/confirmar-concorrencia.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('8 confirmações paralelas no mesmo slot => exatamente 1 sucesso', async () => {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const ids = [];
  for (let i = 0; i < 8; i++) {
    ids.push((await query(`INSERT INTO clientes (nome, celular) VALUES ($1,$2) RETURNING id`,
      [`C${i}`, `11${i}`])).rows[0].id);
  }

  const agora = new Date('2026-09-01T08:00:00');
  const resultados = await Promise.all(ids.map((cli) =>
    confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
      data: '2026-09-10', horario: '16:00', sessionId: `s${cli}`, agora })));

  const ok = resultados.filter((r) => r.ok);
  const falha = resultados.filter((r) => !r.ok);
  assert.equal(ok.length, 1);
  assert.equal(falha.length, 7);
  assert.ok(falha.every((r) => r.erro === 'HORARIO_INDISPONIVEL'));

  const n = await query(
    `SELECT count(*)::int AS n FROM agendamentos
     WHERE data_agendamento='2026-09-10' AND horario_inicio='16:00' AND status IN ('pendente','confirmado')`);
  assert.equal(n.rows[0].n, 1);
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `npm test -- test/agenda/confirmar-concorrencia.test.js`
Expected: PASS (1 teste). Se falhar com mais de 1 sucesso, o índice `uniq_slot_ativo` não está na migration — revisar Task 6, Step 3.

- [ ] **Step 3: Commit**

```bash
git add test/agenda/confirmar-concorrencia.test.js
git commit -m "test: 8 confirmações paralelas no mesmo slot resultam em 1 sucesso

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 17: `cancelarAgendamento` e `remarcarAgendamento`

**Files:**
- Modify: `src/agenda/agendar.js`
- Test: `test/agenda/cancelar-remarcar.test.js`

**Interfaces:**
- Consumes: o mesmo da Task 15.
- Produces:
  - `cancelarAgendamento(id, { motivo = null, porQuem = null } = {}) => Promise<{ ok: true, agendamento } | { ok: false, erro: 'NAO_ENCONTRADO' | 'JA_CANCELADO' | 'JA_CONCLUIDO' }>` — `UPDATE ... SET status='cancelado', motivo_cancelamento=$motivo, updated_at=now()` só se estava em `pendente`/`confirmado`; devolve a linha.
  - `remarcarAgendamento(id, { novaData, novoHorario, agora = new Date() }) => Promise<{ ok: true, agendamento } | { ok: false, erro }>` — transação: carrega o agendamento (erro `NAO_ENCONTRADO`/`JA_CANCELADO`); `verificarSlot` para o novo horário (com a duração do serviço original); marca o antigo como `cancelado` (`motivo_cancelamento='remarcado'`); insere o novo (`status='pendente'`, mesmos cliente/serviço/barbeiro, `23505 → HORARIO_INDISPONIVEL`); enfileira nova confirmação; devolve o novo.

- [ ] **Step 1: Escrever o teste que falha**

```js
// test/agenda/cancelar-remarcar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento, cancelarAgendamento, remarcarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

const CEDO = new Date('2026-09-01T08:00:00');
async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','11') RETURNING id`)).rows[0].id;
  const ag = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '10:10', sessionId: 'x', agora: CEDO });
  return { b, s, cli, ag: ag.agendamento };
}

test('cancelar libera o slot e registra o motivo', async () => {
  const { b, s, cli, ag } = await ctx();
  const r = await cancelarAgendamento(ag.id, { motivo: 'cliente desistiu' });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.status, 'cancelado');
  assert.equal(r.agendamento.motivo_cancelamento, 'cliente desistiu');
  // slot volta a poder ser agendado
  const denovo = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '10:10', sessionId: 'y', agora: CEDO });
  assert.equal(denovo.ok, true);
});

test('cancelar duas vezes => JA_CANCELADO', async () => {
  const { ag } = await ctx();
  await cancelarAgendamento(ag.id, {});
  assert.deepEqual(await cancelarAgendamento(ag.id, {}), { ok: false, erro: 'JA_CANCELADO' });
});

test('cancelar id inexistente => NAO_ENCONTRADO', async () => {
  assert.deepEqual(await cancelarAgendamento(9999, {}), { ok: false, erro: 'NAO_ENCONTRADO' });
});

test('remarcar cancela o antigo e cria novo no horário novo', async () => {
  const { ag } = await ctx();
  const r = await remarcarAgendamento(ag.id, { novaData: '2026-09-10', novoHorario: '11:20', agora: CEDO });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.horario_inicio, '11:20:00');
  const antigo = await query(`SELECT status, motivo_cancelamento FROM agendamentos WHERE id=$1`, [ag.id]);
  assert.equal(antigo.rows[0].status, 'cancelado');
  assert.equal(antigo.rows[0].motivo_cancelamento, 'remarcado');
});

test('remarcar para slot ocupado => HORARIO_INDISPONIVEL e nada muda', async () => {
  const { b, s, cli, ag } = await ctx();
  await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '12:30', sessionId: 'z', agora: CEDO });
  const r = await remarcarAgendamento(ag.id, { novaData: '2026-09-10', novoHorario: '12:30', agora: CEDO });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'HORARIO_INDISPONIVEL');
  const antigo = await query(`SELECT status FROM agendamentos WHERE id=$1`, [ag.id]);
  assert.equal(antigo.rows[0].status, 'pendente'); // rollback preservou o antigo
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- test/agenda/cancelar-remarcar.test.js`
Expected: FAIL — `cancelarAgendamento` não exportado.

- [ ] **Step 3: Implementar — acrescentar a `src/agenda/agendar.js`**

```js
export async function cancelarAgendamento(id, { motivo = null } = {}) {
  return withTransaction(async (c) => {
    const atual = await c.query(`SELECT status FROM agendamentos WHERE id=$1 FOR UPDATE`, [id]);
    if (atual.rowCount === 0) return { ok: false, erro: 'NAO_ENCONTRADO' };
    if (atual.rows[0].status === 'cancelado') return { ok: false, erro: 'JA_CANCELADO' };
    if (atual.rows[0].status === 'concluido') return { ok: false, erro: 'JA_CONCLUIDO' };

    const r = await c.query(
      `UPDATE agendamentos
       SET status='cancelado', motivo_cancelamento=$2, updated_at=now()
       WHERE id=$1 RETURNING *`,
      [id, motivo],
    );
    return { ok: true, agendamento: r.rows[0] };
  });
}

export async function remarcarAgendamento(id, { novaData, novoHorario, agora = new Date() }) {
  return withTransaction(async (c) => {
    const exec = execDe(c);
    const a = await c.query(
      `SELECT a.*, s.duracao_minutos
       FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
       WHERE a.id=$1 FOR UPDATE OF a`,
      [id],
    );
    if (a.rowCount === 0) return { ok: false, erro: 'NAO_ENCONTRADO' };
    const orig = a.rows[0];
    if (orig.status === 'cancelado') return { ok: false, erro: 'JA_CANCELADO' };
    if (orig.status === 'concluido') return { ok: false, erro: 'JA_CONCLUIDO' };

    const val = await verificarSlot(exec, {
      barbeiroId: orig.barbeiro_id, data: novaData, horario: novoHorario,
      duracaoMinutos: orig.duracao_minutos, agora,
    });
    if (!val.ok) return val;

    await exec(
      `UPDATE agendamentos SET status='cancelado', motivo_cancelamento='remarcado', updated_at=now()
       WHERE id=$1`,
      [id],
    );

    let ins;
    try {
      ins = await exec(
        `INSERT INTO agendamentos
           (cliente_id, servico_id, barbeiro_id, data_agendamento,
            horario_inicio, horario_fim, status, valor_total, comissao_valor, observacoes)
         VALUES ($1,$2,$3,$4,$5,$6,'pendente',$7,$8,$9)
         RETURNING *`,
        [orig.cliente_id, orig.servico_id, orig.barbeiro_id, novaData, novoHorario,
         adicionarMinutos(novoHorario, orig.duracao_minutos),
         orig.valor_total, orig.comissao_valor, orig.observacoes],
      );
    } catch (err) {
      if (err.code === '23505') return { ok: false, erro: 'HORARIO_INDISPONIVEL' };
      throw err;
    }

    await exec(`UPDATE clientes SET ultimo_agendamento=$1 WHERE id=$2`, [novaData, orig.cliente_id]);
    await enfileirarConfirmacao(exec, ins.rows[0]);
    return { ok: true, agendamento: ins.rows[0] };
  });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- test/agenda/cancelar-remarcar.test.js`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/agenda/agendar.js test/agenda/cancelar-remarcar.test.js
git commit -m "feat: cancelarAgendamento e remarcarAgendamento (transacional, libera o slot antigo)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 18: Fiação final — README do P1 e suíte completa

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: tudo.
- Produces: `README.md` com pré-requisitos e comandos; confirmação de que `npm test` roda toda a suíte verde.

- [ ] **Step 1: Criar `README.md`**

````markdown
# Barbearia — Backend (P1: Fundação + Motor de Agenda)

## Pré-requisitos
- Node 20 ou superior
- Um projeto **Supabase** (PostgreSQL). Não usa Docker nem Postgres local.

## Setup
```bash
cp .env.example .env          # preencha DATABASE_URL (Session Pooler do Supabase) e SESSION_SECRET
cp .env.test.example .env.test
npm install
npm run db:reset              # cria schema public + tabelas + seed (desenvolvimento)
```

`DATABASE_URL` usa o **Session Pooler** do Supabase (porta 5432). Se a senha do
banco tiver caractere especial (`& + $ ? ...`), ela precisa estar
**percent-encoded** dentro da URL.

## Isolamento dev × teste
Mesmo banco, schemas diferentes: desenvolvimento no schema `public`, testes no
schema `test` (`TEST_SCHEMA`). `npm test` roda com `NODE_ENV=test` e nunca toca
os dados de `public`.

## Comandos
| Comando | O quê |
|---|---|
| `npm test` | Suíte completa (`node:test`), no schema `test` |
| `npm run db:migrate` | Aplica migrations pendentes (schema `public`) |
| `npm run db:seed` | Aplica o seed idempotente (schema `public`) |
| `npm run db:reset` | Migra + trunca + semeia (schema `public`) |

## O que existe no P1
- Camada de banco (`src/db/`): pool, migrations idempotentes, seed.
- Motor de agenda (`src/agenda/`): `slots`, `disponibilidade` (+ `verificarSlot`),
  `locks`, `agendar` (`confirmarAgendamento`, `cancelarAgendamento`,
  `remarcarAgendamento`), `cache`.
- Utilidades (`src/lib/`): `tempo`, `template`. Serviço `comissao`.

## Fora do P1 (vem no P2)
Servidor HTTP, Express, Socket.io, rotas da API, sessões/auth, cron que chama
`limparExpirados()`, envio real de WhatsApp/SMS.
````

- [ ] **Step 2: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS — todos os arquivos de `test/**`. Anotar o total de testes/arquivos na saída.

- [ ] **Step 3: Verificar o estado do banco de desenvolvimento**

Run: `npm run db:reset`
Expected: "banco recriado e semeado", sai 0.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README do P1 com setup e comandos; suíte completa verde

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Cobertura da spec (seções 2, 3, 4, 11):**

| Item da spec | Task |
|---|---|
| Estrutura de pastas `src/` (2.1) | 1, e cada task cria seu arquivo |
| Dependências (2.2) | 1 |
| Isolamento — `agenda/` sem express/socket.io (2.3) | Constraint global; nenhuma task importa express |
| Schema completo Postgres (3) | 6 (`001_init.sql` verbatim da spec) |
| Índice `uniq_slot_ativo` (3.1) | 6 + provado na 16 |
| `configuracao`, `horario_funcionamento`, `barbeiro_padrao_id` (3) | 6 (schema) + 8 (seed) |
| `slots.js` — passo da config, serviço de 50 min (4.1) | 11 |
| `disponibilidade.js` — pipeline 1–7 (4.2) | 12 (mês/dia/expediente/antecedência/locks) + 13 (agendamentos/bloqueios/limite) |
| Cache 30 s + `invalidarData` (4.2) | 10; usado na 12 |
| `locks.js` — criar/renovar/liberar/limparExpirados, `ON CONFLICT` condicional (4.3) | 14 |
| `agendar.js` — transação, revalidação, `23505`, apaga lock, `ultimo_agendamento`, enfileira msg (4.4) | 15 |
| Concorrência — 1 vencedor (4.3, 4.6) | 16 |
| Cancelamento libera o slot; remarcação transacional (4.5) | 17 |
| `comissao` — arredondamento 2 casas (4.4) | 9 |
| Templates iniciais (11 / spec 13) | 8 (seed) + 3 (`renderizarTemplate`) |
| `limparExpirados` chamado por cron | Fora do P1 — função pronta na 14, agendamento no P2 (documentado na 18) |

Sem lacunas para o escopo do P1.

**2. Placeholders:** nenhum "TBD/TODO" de implementação. A Task 7 evita depender da Task 8 usando `await import('seed.js')` dinâmico em `semearBase`/`reset.js` — sem comentário temporário. O teste da Task 17 já usa `denovo` (identificador válido).

**3. Consistência de tipos/nomes:**
- `query`/`withTransaction`/`fecharPool` (Task 5) usados igual em 6–17.
- `prepararBanco`/`limparBanco`/`semearBase`/`fecharBanco` (Task 7) idem.
- `calcularBase(exec, {...})` e `verificarSlot(exec, {...})` — assinatura `exec(text, params)` consistente entre 12, 13 e 15/17 (que passam `execDe(client)`).
- `gerarSlots({ abre, fecha, intervaloMinutos, duracaoServico })` — mesmas chaves em 11 e 12.
- `confirmarAgendamento`/`cancelarAgendamento`/`remarcarAgendamento` retornam sempre `{ ok, ... }` — consistente em 15, 16, 17 e nos testes.
- Erros: conjunto fechado (`MES_FECHADO`, `DIA_FECHADO`, `FORA_DO_EXPEDIENTE`, `ANTECEDENCIA`, `HORARIO_INDISPONIVEL`, `LIMITE_ATINGIDO`, `SERVICO_INVALIDO`, `SLOT_OCUPADO`, `SLOT_TRAVADO`, `NAO_ENCONTRADO`, `JA_CANCELADO`, `JA_CONCLUIDO`) — usados de forma idêntica em disponibilidade/locks/agendar e nos testes.
