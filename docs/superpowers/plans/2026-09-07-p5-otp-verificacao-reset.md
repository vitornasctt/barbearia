# P5 — OTP de verificação + reset de senha — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verificação de celular por código de 6 dígitos ao criar conta com senha, e fluxo "esqueci minha senha" por código, ambos entregues pelo pipeline de mensagens já existente (modo `simulado`, sem SMS real).

**Architecture:** OTP próprio na tabela `otp_codigos` (código gerado no servidor, hash `bcrypt` gravado, verificado localmente, expira em 10 min, teto de 5 tentativas, consumo único). Um `src/services/otp.js` isolado (sem rede) emite/verifica; quem chama encaminha o código para `src/services/mensagens.js` (extraído de `src/agenda/agendar.js`), que insere em `mensagens_whatsapp` e o worker `mensageiro` existente entrega. Duas rotas novas em `/api/auth`; `POST /api/agenda/cadastro` ganha um campo `codigo` condicional.

**Tech Stack:** Node 24 (ESM, `.js` nos imports relativos), Express 4, `node:test` (`--test-concurrency=1`), PostgreSQL (Supabase remoto em dev/teste; `postgres:17` isolado no CI), `bcrypt`, `express-rate-limit` 7.5.1, EJS + Alpine.js, `node-cron`, `pino`.

**Spec:** `docs/superpowers/specs/2026-09-07-p5-otp-verificacao-reset-design.md`

## Global Constraints

- **Node ≥ 22**, ESM apenas (`"type":"module"`), extensão `.js` obrigatória em todo import relativo.
- **`npm test`** = `node --env-file-if-exists=.env --env-file-if-exists=.env.test --test --test-concurrency=1`. **Nunca** rodar dois `npm test` sobrepostos: todos os arquivos de teste compartilham um único schema `test` remoto e fazem `TRUNCATE ... RESTART IDENTITY CASCADE` no setup.
- **Migrações**: forward-only, transacionais, arquivo `src/db/migrations/NNN_*.sql`; aplicadas em ordem de nome por `src/db/migrate.js` (registro em `schema_migrations`).
- **Rotas `/api/*` não-seguras** (`POST`) passam por `exigirOrigemConfiavel` — todo teste de `POST` precisa de `.set('Origin', 'http://localhost:3000')`, senão recebe `403 SEM_PERMISSAO`.
- **Contrato de erro**: lançar `new ErroHttp('CODIGO')`; o `errorHandler` mapeia via `mapaErroHttp` para `{ status, corpo: { erro: 'CODIGO' } }`. `campos` opcional para detalhe de validação.
- **Trailer de commit, exatamente:**
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- **Nunca** commitar `.env` / `.env.test` (credenciais reais) nem `.superpowers/`.
- Idioma do código/comentários/mensagens: português, seguindo o estilo do repositório.

---

### Task 1: Migração `005_otp_proposito.sql`

**Files:**
- Create: `src/db/migrations/005_otp_proposito.sql`
- Create (test): `test/db/migracao-005.test.js`

**Interfaces:**
- Consumes: tabela `otp_codigos` de `001_init.sql` (`id, celular, codigo_hash, expira_em, tentativas, verificado, created_at`).
- Produces: coluna `otp_codigos.proposito VARCHAR(20) NOT NULL` com `CHECK (proposito IN ('cadastro','reset'))`, default `'cadastro'`; índice `idx_otp_celular_created` em `(celular, created_at DESC)`.

- [ ] **Step 1: Write the migration**

Create `src/db/migrations/005_otp_proposito.sql`:

```sql
-- P5: distinguir uso do código (verificação de cadastro vs. reset de senha)
ALTER TABLE otp_codigos
  ADD COLUMN proposito VARCHAR(20) NOT NULL DEFAULT 'cadastro'
  CHECK (proposito IN ('cadastro','reset'));

CREATE INDEX idx_otp_celular_created ON otp_codigos (celular, created_at DESC);
```

- [ ] **Step 2: Write the failing test**

Create `test/db/migracao-005.test.js`:

```js
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { pool, schema } from '../../src/db/pool.js';
import { migrar } from '../../src/db/migrate.js';

before(() => migrar({ silent: true }));

test('otp_codigos ganhou a coluna proposito com CHECK e default', async () => {
  const col = await pool.query(
    `SELECT data_type, column_default, is_nullable
     FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='otp_codigos' AND column_name='proposito'`,
    [schema],
  );
  assert.equal(col.rowCount, 1, 'coluna proposito ausente');
  assert.equal(col.rows[0].is_nullable, 'NO');
  assert.match(col.rows[0].column_default, /'cadastro'/);
});

test('índice idx_otp_celular_created existe', async () => {
  const idx = await pool.query(
    `SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='idx_otp_celular_created'`,
    [schema],
  );
  assert.equal(idx.rowCount, 1);
});

test('proposito rejeita valor fora do CHECK', async () => {
  await assert.rejects(
    pool.query(
      `INSERT INTO otp_codigos (celular, codigo_hash, expira_em, proposito)
       VALUES ('5511999999999', 'x', now() + interval '10 min', 'invalido')`,
    ),
    /check constraint|violates/i,
  );
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- test/db/migracao-005.test.js`
Expected: FAIL — a migração ainda não foi aplicada / coluna não existe. (Se `migrar` já rodou noutro teste antes nesta máquina, o schema pode ter a coluna; nesse caso o teste passa direto — aceitável, o objetivo é ter a asserção.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/db/migracao-005.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/db/migrations/005_otp_proposito.sql test/db/migracao-005.test.js
git commit -m "feat(p5): migração 005 — otp_codigos.proposito + índice

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Repo + serviço de OTP

**Files:**
- Create: `src/repos/otp.js`
- Create: `src/services/otp.js`
- Create (test): `test/services/otp.test.js`

**Interfaces:**
- Consumes:
  - `query` de `src/db/pool.js` — `query(text, params) => Promise<{ rows, rowCount }>`.
  - `hashSenha(texto) => Promise<string>` e `verificarSenha(texto, hash) => Promise<boolean>` de `src/auth/senha.js` (bcrypt custo 12).
- Produces:
  - `src/repos/otp.js`:
    - `inserir({ celular, proposito, codigoHash, expiraEm }) => Promise<{ id }>`
    - `abertoMaisRecente({ celular, proposito }) => Promise<row | undefined>` — row = `{ id, codigo_hash, expira_em, tentativas, verificado }`
    - `incrementarTentativa(id) => Promise<number>` (retorna `tentativas` já incrementado)
    - `marcarVerificado(id) => Promise<void>`
    - `invalidarAbertos({ celular, proposito }) => Promise<void>`
    - `limparAntigos({ dias = 1 } = {}) => Promise<number>` (retorna nº de linhas apagadas)
  - `src/services/otp.js`:
    - `gerarCodigo() => string` (6 dígitos, zero-padded)
    - `emitir({ celular, proposito }) => Promise<{ codigo: string }>`
    - `verificar({ celular, proposito, codigo }) => Promise<{ ok: true } | { ok: false, erro: 'OTP_INVALIDO', motivo: string }>`
    - constantes exportadas: `EXPIRA_MIN = 10`, `MAX_TENTATIVAS = 5`

- [ ] **Step 1: Write `src/repos/otp.js`**

```js
// src/repos/otp.js
import { query } from '../db/pool.js';

export function inserir({ celular, proposito, codigoHash, expiraEm }) {
  return query(
    `INSERT INTO otp_codigos (celular, proposito, codigo_hash, expira_em)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [celular, proposito, codigoHash, expiraEm],
  ).then((r) => r.rows[0]);
}

export function abertoMaisRecente({ celular, proposito }) {
  return query(
    `SELECT id, codigo_hash, expira_em, tentativas, verificado
     FROM otp_codigos
     WHERE celular=$1 AND proposito=$2 AND verificado=FALSE
     ORDER BY created_at DESC LIMIT 1`,
    [celular, proposito],
  ).then((r) => r.rows[0]);
}

export function incrementarTentativa(id) {
  return query(
    `UPDATE otp_codigos SET tentativas = tentativas + 1 WHERE id=$1 RETURNING tentativas`,
    [id],
  ).then((r) => r.rows[0].tentativas);
}

export function marcarVerificado(id) {
  return query(`UPDATE otp_codigos SET verificado=TRUE WHERE id=$1`, [id]).then(() => {});
}

export function invalidarAbertos({ celular, proposito }) {
  return query(
    `UPDATE otp_codigos SET verificado=TRUE
     WHERE celular=$1 AND proposito=$2 AND verificado=FALSE`,
    [celular, proposito],
  ).then(() => {});
}

export function limparAntigos({ dias = 1 } = {}) {
  return query(
    `DELETE FROM otp_codigos WHERE created_at < now() - ($1 || ' days')::interval`,
    [String(dias)],
  ).then((r) => r.rowCount);
}
```

- [ ] **Step 2: Write the failing test**

Create `test/services/otp.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { gerarCodigo, emitir, verificar, MAX_TENTATIVAS } from '../../src/services/otp.js';
import * as otpRepo from '../../src/repos/otp.js';

before(prepararBanco);
beforeEach(prepararBanco);

const CEL = '5511988887777';

test('gerarCodigo devolve 6 dígitos, com zero à esquerda', () => {
  for (let i = 0; i < 200; i++) {
    const c = gerarCodigo();
    assert.match(c, /^\d{6}$/);
  }
});

test('emitir grava linha aberta com expiração ~10min e hash que confere', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.ok(row);
  assert.equal(row.verificado, false);
  const dtMs = new Date(row.expira_em).getTime() - Date.now();
  assert.ok(dtMs > 8 * 60_000 && dtMs < 12 * 60_000, 'expira_em fora da janela');
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.deepEqual(r, { ok: true });
});

test('emitir de novo invalida o código anterior do mesmo par', async () => {
  const primeiro = await emitir({ celular: CEL, proposito: 'cadastro' });
  await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo: primeiro.codigo });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'OTP_INVALIDO');
});

test('código errado incrementa tentativas e falha', async () => {
  await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo: '000000' });
  assert.equal(r.ok, false);
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.equal(row.tentativas, 1);
});

test('estoura MAX_TENTATIVAS e nem o código certo passa', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const errado = codigo === '000000' ? '111111' : '000000';
  for (let i = 0; i < MAX_TENTATIVAS; i++) {
    await verificar({ celular: CEL, proposito: 'cadastro', codigo: errado });
  }
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'OTP_INVALIDO');
});

test('código expirado falha', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  await query(`UPDATE otp_codigos SET expira_em = now() - interval '1 min' WHERE celular=$1`, [CEL]);
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
});

test('código já verificado não serve de novo', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  const r = await verificar({ celular: CEL, proposito: 'cadastro', codigo });
  assert.equal(r.ok, false);
});

test('proposito não cruza: código de cadastro não verifica reset', async () => {
  const { codigo } = await emitir({ celular: CEL, proposito: 'cadastro' });
  const r = await verificar({ celular: CEL, proposito: 'reset', codigo });
  assert.equal(r.ok, false);
});

test('limparAntigos remove só linhas com mais de 1 dia', async () => {
  await emitir({ celular: CEL, proposito: 'cadastro' });
  await query(`UPDATE otp_codigos SET created_at = now() - interval '2 days' WHERE celular=$1`, [CEL]);
  const n = await otpRepo.limparAntigos({ dias: 1 });
  assert.ok(n >= 1);
  const row = await otpRepo.abertoMaisRecente({ celular: CEL, proposito: 'cadastro' });
  assert.equal(row, undefined);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- test/services/otp.test.js`
Expected: FAIL — `Cannot find module '../../src/services/otp.js'`.

- [ ] **Step 4: Write `src/services/otp.js`**

```js
// src/services/otp.js
import crypto from 'node:crypto';
import { hashSenha, verificarSenha } from '../auth/senha.js';
import * as otpRepo from '../repos/otp.js';

export const EXPIRA_MIN = 10;
export const MAX_TENTATIVAS = 5;

export function gerarCodigo() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function emitir({ celular, proposito }) {
  await otpRepo.invalidarAbertos({ celular, proposito });
  const codigo = gerarCodigo();
  const codigoHash = await hashSenha(codigo);
  const expiraEm = new Date(Date.now() + EXPIRA_MIN * 60_000);
  await otpRepo.inserir({ celular, proposito, codigoHash, expiraEm });
  return { codigo };
}

export async function verificar({ celular, proposito, codigo }) {
  const falha = (motivo) => ({ ok: false, erro: 'OTP_INVALIDO', motivo });
  const row = await otpRepo.abertoMaisRecente({ celular, proposito });
  if (!row) return falha('inexistente');
  if (new Date(row.expira_em).getTime() < Date.now()) return falha('expirado');
  if (row.tentativas >= MAX_TENTATIVAS) return falha('tentativas_esgotadas');
  await otpRepo.incrementarTentativa(row.id);
  if (!(await verificarSenha(String(codigo), row.codigo_hash))) return falha('codigo_errado');
  await otpRepo.marcarVerificado(row.id);
  return { ok: true };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/services/otp.test.js`
Expected: PASS (10 testes).

- [ ] **Step 6: Commit**

```bash
git add src/repos/otp.js src/services/otp.js test/services/otp.test.js
git commit -m "feat(p5): serviço de OTP (emitir/verificar) + repo otp_codigos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Extrair `src/services/mensagens.js` e reusar em `agendar.js`

**Files:**
- Create: `src/services/mensagens.js`
- Modify: `src/agenda/agendar.js` (função `enfileirarConfirmacao`, ~linhas 12-39)
- Test: `test/agenda/confirmar.test.js` (regressão — não editar, só rodar)
- Create (test): `test/services/mensagens.test.js`

**Interfaces:**
- Consumes:
  - `query` de `src/db/pool.js`; `renderizarTemplate(corpo, vars) => string` de `src/lib/template.js`.
  - `mensagens_whatsapp(agendamento_id NULLABLE, template_chave, telefone_destino, mensagem_final, status_envio)` — schema de `001_init.sql`.
  - `templates_mensagem(chave UNIQUE, corpo, ativo)`.
- Produces:
  - `enfileirarMensagem({ templateChave, telefone, vars, agendamentoId = null }, exec = query) => Promise<{ enfileirada: boolean }>` — `exec` é `query` global ou `client.query` de uma transação. Se o template não existe ou está inativo, **não** enfileira e retorna `{ enfileirada: false }` (mesma tolerância do código atual, que fazia `if (tpl.rowCount === 0) return;`).

- [ ] **Step 1: Write the failing test**

Create `test/services/mensagens.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { enfileirarMensagem } from '../../src/services/mensagens.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('enfileira mensagem com agendamento_id nulo usando um template existente', async () => {
  const r = await enfileirarMensagem({
    templateChave: 'confirmacao',
    telefone: '5511900000000',
    vars: { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X', nome_barbearia: 'B' },
  });
  assert.equal(r.enfileirada, true);
  const m = await query(`SELECT agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio FROM mensagens_whatsapp`);
  assert.equal(m.rowCount, 1);
  assert.equal(m.rows[0].agendamento_id, null);
  assert.equal(m.rows[0].template_chave, 'confirmacao');
  assert.equal(m.rows[0].status_envio, 'pendente');
  assert.match(m.rows[0].mensagem_final, /Ana/);
});

test('template inexistente não enfileira e retorna enfileirada:false', async () => {
  const r = await enfileirarMensagem({ templateChave: 'nao_existe', telefone: '5511900000000', vars: {} });
  assert.equal(r.enfileirada, false);
  const m = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`);
  assert.equal(m.rows[0].n, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/services/mensagens.test.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write `src/services/mensagens.js`**

```js
// src/services/mensagens.js
import { query } from '../db/pool.js';
import { renderizarTemplate } from '../lib/template.js';

export async function enfileirarMensagem(
  { templateChave, telefone, vars = {}, agendamentoId = null },
  exec = query,
) {
  const tpl = await exec(
    `SELECT corpo FROM templates_mensagem WHERE chave=$1 AND ativo`,
    [templateChave],
  );
  if (tpl.rowCount === 0) return { enfileirada: false };
  const texto = renderizarTemplate(tpl.rows[0].corpo, vars);
  await exec(
    `INSERT INTO mensagens_whatsapp (agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio)
     VALUES ($1, $2, $3, $4, 'pendente')`,
    [agendamentoId, templateChave, telefone, texto],
  );
  return { enfileirada: true };
}
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `npm test -- test/services/mensagens.test.js`
Expected: PASS (2 testes).

- [ ] **Step 5: Refactor `src/agenda/agendar.js` to use it**

Replace the whole `enfileirarConfirmacao` function (currently lines ~12-39) with a version that delegates to `enfileirarMensagem`. Add the import at the top (`import { enfileirarMensagem } from '../services/mensagens.js';`) and remove the now-unused `renderizarTemplate` import if nothing else uses it (grep first — it is only used by `enfileirarConfirmacao`).

New function:

```js
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
  await enfileirarMensagem({
    templateChave: 'confirmacao',
    telefone: d.celular,
    agendamentoId: agendamento.id,
    vars: {
      nome_cliente: d.cliente_nome,
      nome_servico: d.servico_nome,
      data: agendamento.data_agendamento.toISOString().slice(0, 10),
      horario: String(agendamento.horario_inicio).slice(0, 5),
      endereco_barbearia: d.endereco ?? '',
      nome_barbearia: d.nome_barbearia,
    },
  }, exec);
}
```

- [ ] **Step 6: Run the regression suite for the booking flow**

Run: `npm test -- test/agenda/confirmar.test.js test/agenda/cancelar-remarcar.test.js test/http/agenda-confirmar.test.js`
Expected: PASS — o comportamento de enfileiramento da confirmação é idêntico (mesmo template, mesmas vars, mesmo `agendamento_id`).

- [ ] **Step 7: Commit**

```bash
git add src/services/mensagens.js test/services/mensagens.test.js src/agenda/agendar.js
git commit -m "refactor(p5): extrai enfileirarMensagem; agendar.js passa a usá-lo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Template `codigo_verificacao`

**Files:**
- Modify: `src/db/seed.js` (array `TEMPLATES`, ~linhas 6-20)
- Modify: `test/services/templates-meta.test.js` (set `CONHECIDAS`, obj `VARS`)
- Modify: `docs/whatsapp-templates.md` (nova entrada)

**Interfaces:**
- Consumes: `renderizarTemplate` regex de variáveis `\{\{\s*(\w+)\s*\}\}`.
- Produces: linha `['codigo_verificacao', 'Código de verificação', <corpo>]` em `TEMPLATES`; template com as vars `{{codigo}}` e `{{nome_barbearia}}` disponível após `semear()`.

- [ ] **Step 1: Update `test/services/templates-meta.test.js` first (failing expectation)**

Add `'codigo'` to `CONHECIDAS` and a value to `VARS`:

```js
const CONHECIDAS = new Set(['nome_cliente', 'nome_servico', 'data', 'horario', 'endereco_barbearia', 'nome_barbearia', 'codigo']);
const VARS = { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X, 1', nome_barbearia: 'Barbearia', codigo: '123456' };
```

- [ ] **Step 2: Run the test to see the current 3-template loop still green, then confirm the new template will be covered**

Run: `npm test -- test/services/templates-meta.test.js`
Expected: PASS (6 testes — ainda 3 templates × 2). O `codigo` extra em `CONHECIDAS`/`VARS` não quebra nada.

- [ ] **Step 3: Add the template to `src/db/seed.js`**

Append to the `TEMPLATES` array (after `pos_atendimento`):

```js
  ['codigo_verificacao', 'Código de verificação',
`Seu código {{codigo}} para {{nome_barbearia}}.
Vale por 10 minutos. Não compartilhe com ninguém.`],
```

- [ ] **Step 4: Run the templates test — now 4 templates**

Run: `npm test -- test/services/templates-meta.test.js`
Expected: PASS (8 testes — 4 templates × 2). `codigo_verificacao` só usa `codigo` e `nome_barbearia`, ambos em `CONHECIDAS`; renderiza sem `{{` sobrando.

- [ ] **Step 5: Document it in `docs/whatsapp-templates.md`**

Add a section mirroring the existing template entries (categoria **AUTHENTICATION** no Gerenciador de Modelos da Meta):

```markdown
## codigo_verificacao (categoria: AUTHENTICATION)

**Corpo (formato Meta):**
```
Seu código {{1}} para {{2}}.
Vale por 10 minutos. Não compartilhe com ninguém.
```

| Placeholder | Variável do sistema |
| --- | --- |
| `{{1}}` | código de 6 dígitos |
| `{{2}}` | nome da barbearia |

Enfileirado por `POST /api/auth/otp/enviar` (verificação de cadastro e reset de senha). Sem credencial Meta/Twilio configurada, sai como `simulado`.
```

- [ ] **Step 6: Commit**

```bash
git add src/db/seed.js test/services/templates-meta.test.js docs/whatsapp-templates.md
git commit -m "feat(p5): template codigo_verificacao no seed + docs

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `OTP_INVALIDO`, redact de log e rate limiters

**Files:**
- Modify: `src/http/erros.js` (objeto `mapaErroHttp`)
- Modify: `src/app.js` (opção `redact` do `pinoHttp`, ~linha 42)
- Modify: `src/auth/rateLimit.js` (novo store + 2 limiters + `resetRateLimit`)
- Create (test): `test/auth/rate-limit-otp.test.js`

**Interfaces:**
- Consumes: `rateLimit`, `MemoryStore` de `express-rate-limit`; `ErroHttp` de `src/http/erros.js`; helper local `bloqueio` de `rateLimit.js`.
- Produces:
  - `mapaErroHttp.OTP_INVALIDO = 400`.
  - `pinoHttp` redige `req.body.codigo` e `req.body.nova_senha` além de `req.body.senha`.
  - `src/auth/rateLimit.js` exporta `storeOtp`, `limiteOtpCelular`, `limiteOtpIp`; `resetRateLimit()` também zera `storeOtp`.

- [ ] **Step 1: Add `OTP_INVALIDO` to `src/http/erros.js`**

In `mapaErroHttp`, add (near `VALIDACAO`):

```js
  OTP_INVALIDO: 400,
```

- [ ] **Step 2: Extend the pino redact list in `src/app.js`**

Change:

```js
    redact: ['req.body.senha', 'req.headers.cookie', 'req.headers.authorization'],
```

to:

```js
    redact: ['req.body.senha', 'req.body.nova_senha', 'req.body.codigo', 'req.headers.cookie', 'req.headers.authorization'],
```

- [ ] **Step 3: Add the OTP limiters to `src/auth/rateLimit.js`**

After `storeMensagens`:

```js
export const storeOtp = new MemoryStore();
```

In `resetRateLimit()`, add:

```js
  storeOtp.resetAll?.();
```

After `limiteMensagens`:

```js
// OTP: por (IP + celular) — trava pedir código repetidamente para o mesmo número
export const limiteOtpCelular = rateLimit({
  windowMs: 10 * 60_000,
  limit: 3,
  store: storeOtp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.celular ?? ''}`,
  handler: bloqueio,
});

// OTP: só por IP — trava varredura de números
export const limiteOtpIp = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  store: storeOtp,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: bloqueio,
});
```

- [ ] **Step 4: Write the test**

Create `test/auth/rate-limit-otp.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';

test('4ª chamada de otp/enviar para o mesmo celular em 10 min → 429', async () => {
  const app = buildApp();
  const enviar = () => request(app).post('/api/auth/otp/enviar')
    .set('Origin', ORIGIN)
    .send({ celular: '5511977776666', proposito: 'cadastro' });
  assert.equal((await enviar()).status, 200);
  assert.equal((await enviar()).status, 200);
  assert.equal((await enviar()).status, 200);
  const quarta = await enviar();
  assert.equal(quarta.status, 429);
  assert.equal(quarta.body.erro, 'MUITAS_TENTATIVAS');
});

test('resetRateLimit zera o storeOtp entre casos', async () => {
  const app = buildApp();
  const r = await request(app).post('/api/auth/otp/enviar')
    .set('Origin', ORIGIN)
    .send({ celular: '5511977776666', proposito: 'cadastro' });
  assert.equal(r.status, 200); // se não zerasse, herdaria o 429 do teste anterior
});
```

- [ ] **Step 5: Run the test**

Run: `npm test -- test/auth/rate-limit-otp.test.js`
Expected: FAIL no primeiro run se a rota `/api/auth/otp/enviar` ainda não existe (404 em vez de 200/429). **Esta task depende da Task 7 para o teste passar** — deixe o teste escrito e furando; ele fecha quando a rota entra. Rode `npm test -- test/http/csp.test.js` para provar que `erros.js`/`app.js` seguem íntegros.

Alternativa (recomendada p/ manter o ciclo TDD verde): reordene — implemente a Task 7 logo após os steps 1-3 desta task e volte para rodar o step 5. O `subagent-driven-development` cuida disso ao encadear as tasks; se estiver executando inline, faça Task 5 (steps 1-3) → Task 7 → Task 5 (steps 4-6).

- [ ] **Step 6: Commit**

```bash
git add src/http/erros.js src/app.js src/auth/rateLimit.js test/auth/rate-limit-otp.test.js
git commit -m "feat(p5): OTP_INVALIDO, redact de codigo/nova_senha, limiters de OTP

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Helpers de `clientes` (verificação e senha)

**Files:**
- Modify: `src/repos/clientes.js`
- Create (test): `test/repos/clientes-p5.test.js`

**Interfaces:**
- Consumes: `query` de `src/db/pool.js`; tabela `clientes(senha_hash, celular_verificado)`.
- Produces:
  - `criar({ nome, celular, email = null, senha_hash = null, celular_verificado = false }) => Promise<{ id, nome }>` — **parâmetro novo** `celular_verificado`.
  - `definirSenha(id, senha_hash) => Promise<void>`
  - `marcarCelularVerificado(id) => Promise<void>`
  - `porId(id) => Promise<{ id, nome, celular, email, senha_hash, celular_verificado } | null>` (usado nos testes/rotas para checar estado)

- [ ] **Step 1: Write the failing test**

Create `test/repos/clientes-p5.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import * as clientes from '../../src/repos/clientes.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('criar aceita celular_verificado e persiste', async () => {
  const c = await clientes.criar({ nome: 'Zé', celular: '5511911112222', senha_hash: 'h', celular_verificado: true });
  const full = await clientes.porId(c.id);
  assert.equal(full.celular_verificado, true);
  assert.equal(full.senha_hash, 'h');
});

test('criar sem celular_verificado mantém default false', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911113333' });
  const full = await clientes.porId(c.id);
  assert.equal(full.celular_verificado, false);
});

test('definirSenha troca o hash', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911114444', senha_hash: 'antigo' });
  await clientes.definirSenha(c.id, 'novo');
  assert.equal((await clientes.porId(c.id)).senha_hash, 'novo');
});

test('marcarCelularVerificado liga a flag', async () => {
  const c = await clientes.criar({ nome: 'Ana', celular: '5511911115555' });
  await clientes.marcarCelularVerificado(c.id);
  assert.equal((await clientes.porId(c.id)).celular_verificado, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/repos/clientes-p5.test.js`
Expected: FAIL — `clientes.porId is not a function` / `celular_verificado` ignorado.

- [ ] **Step 3: Update `src/repos/clientes.js`**

```js
// src/repos/clientes.js
import { query } from '../db/pool.js';

export async function porCelular(celular) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE celular=$1`, [celular]);
  return r.rows[0] ?? null;
}

export async function porId(id) {
  const r = await query(
    `SELECT id, nome, celular, email, senha_hash, celular_verificado
     FROM clientes WHERE id=$1`, [id]);
  return r.rows[0] ?? null;
}

export async function criar({ nome, celular, email = null, senha_hash = null, celular_verificado = false }) {
  const r = await query(
    `INSERT INTO clientes (nome, celular, email, senha_hash, celular_verificado)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, nome`,
    [nome, celular, email, senha_hash, celular_verificado]);
  return r.rows[0];
}

export function definirSenha(id, senha_hash) {
  return query(`UPDATE clientes SET senha_hash=$2 WHERE id=$1`, [id, senha_hash]).then(() => {});
}

export function marcarCelularVerificado(id) {
  return query(`UPDATE clientes SET celular_verificado=TRUE WHERE id=$1`, [id]).then(() => {});
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/repos/clientes-p5.test.js`
Expected: PASS (4 testes).

- [ ] **Step 5: Run the existing clientes/cadastro regression**

Run: `npm test -- test/http/cliente.test.js test/repos/dados-repos.test.js`
Expected: PASS — `criar` continua compatível (novo parâmetro tem default).

- [ ] **Step 6: Commit**

```bash
git add src/repos/clientes.js test/repos/clientes-p5.test.js
git commit -m "feat(p5): clientes.porId/definirSenha/marcarCelularVerificado + criar(celular_verificado)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Rota `POST /api/auth/otp/enviar`

**Files:**
- Modify: `src/routes/auth.js`
- Create (test): `test/http/otp-enviar.test.js`

**Interfaces:**
- Consumes:
  - `emitir` de `src/services/otp.js`; `enfileirarMensagem` de `src/services/mensagens.js`.
  - `limiteOtpCelular`, `limiteOtpIp` de `src/auth/rateLimit.js`.
  - `normalizarCelular` de `src/lib/celular.js` (lança em formato inválido — já usado em `auth.js`).
  - `clientes.porCelular` de `src/repos/clientes.js`.
  - `processarPendentes` de `src/services/mensageiro.js` (empurrão do worker, como em `publicas.js`).
  - `query` de `src/db/pool.js` para ler `configuracao.nome_barbearia`.
  - `rota` de `src/http/async.js`; `validarCorpo` de `src/http/validar.js`; `z` de `zod`.
- Produces: `POST /api/auth/otp/enviar` `{ celular: string, proposito: 'cadastro'|'reset' }` → **sempre** `200 { enviado: true }` (exceto `429 MUITAS_TENTATIVAS`).

- [ ] **Step 1: Write the failing test**

Create `test/http/otp-enviar.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { query } from '../../src/db/pool.js';
import * as clientes from '../../src/repos/clientes.js';
import { hashSenha } from '../../src/auth/senha.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';
const enviar = (body) => request(buildApp()).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send(body);

test('cadastro: enfileira mensagem codigo_verificacao e responde 200', async () => {
  const r = await enviar({ celular: '5511955554444', proposito: 'cadastro' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { enviado: true });
  const m = await query(`SELECT template_chave, telefone_destino, mensagem_final FROM mensagens_whatsapp`);
  assert.equal(m.rowCount, 1);
  assert.equal(m.rows[0].template_chave, 'codigo_verificacao');
  assert.equal(m.rows[0].telefone_destino, '5511955554444');
  assert.match(m.rows[0].mensagem_final, /\b\d{6}\b/);
  assert.match(m.rows[0].mensagem_final, /Minha Barbearia/);
});

test('reset: número sem cadastro responde 200 e NÃO enfileira', async () => {
  const r = await enviar({ celular: '5511900001111', proposito: 'reset' });
  assert.equal(r.status, 200);
  const m = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`);
  assert.equal(m.rows[0].n, 0);
});

test('reset: conta com senha mas celular não verificado → 200 sem enfileirar', async () => {
  await clientes.criar({ nome: 'Ana', celular: '5511900002222', senha_hash: await hashSenha('segredo123'), celular_verificado: false });
  const r = await enviar({ celular: '5511900002222', proposito: 'reset' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 0);
});

test('reset: conta com senha e celular verificado → enfileira', async () => {
  await clientes.criar({ nome: 'Ana', celular: '5511900003333', senha_hash: await hashSenha('segredo123'), celular_verificado: true });
  const r = await enviar({ celular: '5511900003333', proposito: 'reset' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 1);
});

test('celular mal formado responde 200 sem vazar (e sem enfileirar)', async () => {
  const r = await enviar({ celular: 'abc', proposito: 'cadastro' });
  assert.equal(r.status, 200);
  assert.equal((await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`)).rows[0].n, 0);
});

test('proposito inválido → 400 VALIDACAO', async () => {
  const r = await enviar({ celular: '5511955554444', proposito: 'outro' });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/http/otp-enviar.test.js`
Expected: FAIL — rota inexistente (`404`).

- [ ] **Step 3: Implement the route in `src/routes/auth.js`**

Add imports at the top:

```js
import { limiteOtpCelular, limiteOtpIp } from '../auth/rateLimit.js';
import { emitir as emitirOtp } from '../services/otp.js';
import { enfileirarMensagem } from '../services/mensagens.js';
import { processarPendentes } from '../services/mensageiro.js';
import { query } from '../db/pool.js';
```

Add the route (after `auth.post('/cliente/login', ...)`):

```js
async function nomeBarbearia() {
  const r = await query(`SELECT nome_barbearia FROM configuracao WHERE id=1`);
  return r.rows[0]?.nome_barbearia ?? 'a barbearia';
}

auth.post('/otp/enviar', limiteOtpIp, limiteOtpCelular,
  validarCorpo(z.object({
    celular: z.string().min(1),
    proposito: z.enum(['cadastro', 'reset']),
  })),
  rota(async (req, res) => {
    const { proposito } = req.body;
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { return res.json({ enviado: true }); }   // não vaza formato

    if (proposito === 'reset') {
      const c = await clientes.porCelular(celular);
      if (!c || !c.senha_hash || !c.celular_verificado) return res.json({ enviado: true });
    }

    const { codigo } = await emitirOtp({ celular, proposito });
    await enfileirarMensagem({
      templateChave: 'codigo_verificacao',
      telefone: celular,
      vars: { codigo, nome_barbearia: await nomeBarbearia() },
    });
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker otp'));
    res.json({ enviado: true });
  }));
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/http/otp-enviar.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Run the rate-limit test from Task 5 (now unblocked)**

Run: `npm test -- test/auth/rate-limit-otp.test.js`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add src/routes/auth.js test/http/otp-enviar.test.js
git commit -m "feat(p5): POST /api/auth/otp/enviar (verificação e reset, sem vazar cadastro)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /api/agenda/cadastro` passa a exigir `codigo` quando há `senha`

**Files:**
- Modify: `src/routes/publicas.js` (rota `/cadastro`, ~linhas 126-151)
- Create (test): `test/http/otp-cadastro.test.js`

**Interfaces:**
- Consumes:
  - `verificar` de `src/services/otp.js` (`{ proposito: 'cadastro' }`).
  - `clientes.porCelular`, `clientes.criar` (com `celular_verificado`), `clientes.definirSenha`, `clientes.marcarCelularVerificado`.
  - `hashSenha` de `src/auth/senha.js`; `normalizarCelular`; `ErroHttp`.
- Produces: `/cadastro` aceita `codigo?: string` (regex `^\d{6}$`). Regra: `senha` presente ⇒ `codigo` obrigatório e verificado; conta criada/atualizada com `celular_verificado=true`. Fluxo sem `senha` inalterado.

- [ ] **Step 1: Write the failing test**

Create `test/http/otp-cadastro.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { query } from '../../src/db/pool.js';
import * as clientes from '../../src/repos/clientes.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';

async function pedirCodigo(app, celular, proposito = 'cadastro') {
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito });
  const m = await query(
    `SELECT mensagem_final FROM mensagens_whatsapp WHERE telefone_destino=$1 ORDER BY id DESC LIMIT 1`,
    [celular],
  );
  return m.rows[0].mensagem_final.match(/\b(\d{6})\b/)[1];
}

test('cadastro com senha + código correto cria conta verificada', async () => {
  const app = buildApp();
  const celular = '5511944443333';
  const codigo = await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular(celular);
  assert.equal(c.celular_verificado, true);
  assert.ok(c.senha_hash);
});

test('cadastro com senha sem código → 400 VALIDACAO e nada criado', async () => {
  const r = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '5511944442222', consentimento: true, email: 'a@a.com', senha: 'segredo123' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'VALIDACAO');
  assert.equal(await clientes.porCelular('5511944442222'), null);
});

test('cadastro com senha + código errado → 400 OTP_INVALIDO, nada criado', async () => {
  const app = buildApp();
  const celular = '5511944441111';
  await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo: '000000' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
  assert.equal(await clientes.porCelular(celular), null);
});

test('cadastro SEM senha continua sem exigir código (fluxo anônimo)', async () => {
  const r = await request(buildApp()).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular: '5511944440000', consentimento: true });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular('5511944440000');
  assert.equal(c.celular_verificado, false);
});

test('mesmo código não serve para um segundo cadastro', async () => {
  const app = buildApp();
  const celular = '5511944449999';
  const codigo = await pedirCodigo(app, celular);
  await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  // segundo cadastro com outro celular mas reaproveitando o código do primeiro
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Bia', celular: '5511944448888', consentimento: true, email: 'b@b.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
});

test('conta anônima existente (sem senha) vira conta com senha após código', async () => {
  const app = buildApp();
  const celular = '5511944447777';
  await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true });        // cria sem senha
  const codigo = await pedirCodigo(app, celular);
  const r = await request(app).post('/api/agenda/cadastro').set('Origin', ORIGIN)
    .send({ nome: 'Ana', celular, consentimento: true, email: 'a@a.com', senha: 'segredo123', codigo });
  assert.equal(r.status, 201);
  const c = await clientes.porCelular(celular);
  assert.ok(c.senha_hash);
  assert.equal(c.celular_verificado, true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/http/otp-cadastro.test.js`
Expected: FAIL — hoje `/cadastro` ignora `codigo`; cria conta com senha sem verificar.

- [ ] **Step 3: Update the `/cadastro` route in `src/routes/publicas.js`**

Add imports:

```js
import { verificar as verificarOtp } from '../agenda/../services/otp.js';
```

(use `../services/otp.js`.)

Replace the route body. Zod schema gains `codigo`:

```js
publicas.post('/cadastro',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100),
    celular: z.string().min(1),
    email: z.string().email().optional(),
    senha: z.string().min(6).optional(),
    codigo: z.string().regex(/^\d{6}$/).optional(),
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

    if (req.body.senha) {
      if (!req.body.codigo) {
        const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'codigo', mensagem: 'obrigatório para criar senha' }]; return next(e);
      }
      const r = await verificarOtp({ celular, proposito: 'cadastro', codigo: req.body.codigo });
      if (!r.ok) return next(new ErroHttp('OTP_INVALIDO'));
    }

    let cliente;
    if (existente) {
      cliente = existente;
      if (req.body.senha) {
        await clientes.definirSenha(cliente.id, await hashSenha(req.body.senha));
        await clientes.marcarCelularVerificado(cliente.id);
      }
    } else {
      cliente = await clientes.criar({
        nome: req.body.nome, celular,
        email: req.body.email ?? null,
        senha_hash: req.body.senha ? await hashSenha(req.body.senha) : null,
        celular_verificado: Boolean(req.body.senha),
      });
    }

    req.session.clienteId = cliente.id;
    delete req.session.usuarioId;
    res.status(201).json({ cliente: { id: cliente.id, nome: cliente.nome } });
  }));
```

Note: `hashSenha` is already imported in `publicas.js` (`import { hashSenha } from '../auth/senha.js';`). Keep the existing `clientes` import.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/http/otp-cadastro.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Run the booking-flow + client regression**

Run: `npm test -- test/http/cliente.test.js test/http/agenda-confirmar.test.js test/http/paginas.test.js`
Expected: PASS — `/cadastro` sem `senha` e o `confirmar` seguinte não mudaram.

- [ ] **Step 6: Commit**

```bash
git add src/routes/publicas.js test/http/otp-cadastro.test.js
git commit -m "feat(p5): /cadastro exige código verificado quando cria senha

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Rota `POST /api/auth/senha/redefinir`

**Files:**
- Modify: `src/routes/auth.js`
- Create (test): `test/http/reset-senha.test.js`

**Interfaces:**
- Consumes: `verificar` de `src/services/otp.js` (`{ proposito: 'reset' }`); `clientes.porCelular`, `clientes.definirSenha`; `hashSenha`; `logs.registrar`; `limiteOtpIp`, `limiteOtpCelular`; `normalizarCelular`; `ErroHttp`.
- Produces: `POST /api/auth/senha/redefinir` `{ celular, codigo: /^\d{6}$/, nova_senha: string(min 6) }` → `200 { cliente: { id, nome } }` + `req.session.clienteId` setado · `400 OTP_INVALIDO`.

- [ ] **Step 1: Write the failing test**

Create `test/http/reset-senha.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { query } from '../../src/db/pool.js';
import * as clientes from '../../src/repos/clientes.js';
import { hashSenha } from '../../src/auth/senha.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

const ORIGIN = 'http://localhost:3000';

async function contaVerificada(celular, senha) {
  await clientes.criar({ nome: 'Ana', celular, email: 'a@a.com', senha_hash: await hashSenha(senha), celular_verificado: true });
}
async function codigoReset(app, celular) {
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito: 'reset' });
  const m = await query(`SELECT mensagem_final FROM mensagens_whatsapp WHERE telefone_destino=$1 ORDER BY id DESC LIMIT 1`, [celular]);
  return m.rows[0].mensagem_final.match(/\b(\d{6})\b/)[1];
}

test('reset feliz: nova senha passa a valer, antiga não', async () => {
  const app = buildApp();
  const celular = '5511933332222';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);

  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'novasenha1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.cliente.nome, 'Ana');

  const nova = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN)
    .send({ celular, senha: 'novasenha1' });
  assert.equal(nova.status, 200);
  const velha = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN)
    .send({ celular, senha: 'antiga123' });
  assert.equal(velha.status, 401);
});

test('reset registra em logs_acesso', async () => {
  const app = buildApp();
  const celular = '5511933331111';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN).send({ celular, codigo, nova_senha: 'novasenha1' });
  const l = await query(`SELECT acao FROM logs_acesso WHERE acao='senha_redefinida'`);
  assert.equal(l.rowCount, 1);
});

test('código errado → 400 OTP_INVALIDO, senha intacta', async () => {
  const app = buildApp();
  const celular = '5511933330000';
  await contaVerificada(celular, 'antiga123');
  await codigoReset(app, celular);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo: '000000', nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
  const ok = await request(buildApp()).post('/api/auth/cliente/login').set('Origin', ORIGIN).send({ celular, senha: 'antiga123' });
  assert.equal(ok.status, 200);
});

test('celular sem conta verificada: otp/enviar não emite, redefinir falha OTP_INVALIDO', async () => {
  const app = buildApp();
  const celular = '5511933339999';
  await request(app).post('/api/auth/otp/enviar').set('Origin', ORIGIN).send({ celular, proposito: 'reset' });
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo: '123456', nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
  assert.equal(r.body.erro, 'OTP_INVALIDO');
});

test('código expirado → 400', async () => {
  const app = buildApp();
  const celular = '5511933338888';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  await query(`UPDATE otp_codigos SET expira_em = now() - interval '1 min' WHERE celular=$1`, [celular]);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'novasenha1' });
  assert.equal(r.status, 400);
});

test('nova_senha curta → 400 VALIDACAO', async () => {
  const app = buildApp();
  const celular = '5511933337777';
  await contaVerificada(celular, 'antiga123');
  const codigo = await codigoReset(app, celular);
  const r = await request(app).post('/api/auth/senha/redefinir').set('Origin', ORIGIN)
    .send({ celular, codigo, nova_senha: 'curta' });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/http/reset-senha.test.js`
Expected: FAIL — rota `404`.

- [ ] **Step 3: Implement the route in `src/routes/auth.js`**

Add import:

```js
import { verificar as verificarOtp } from '../services/otp.js';
```

Add the route (after `/otp/enviar`):

```js
auth.post('/senha/redefinir', limiteOtpIp, limiteOtpCelular,
  validarCorpo(z.object({
    celular: z.string().min(1),
    codigo: z.string().regex(/^\d{6}$/),
    nova_senha: z.string().min(6),
  })),
  rota(async (req, res, next) => {
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { return next(new ErroHttp('OTP_INVALIDO')); }

    const r = await verificarOtp({ celular, proposito: 'reset', codigo: req.body.codigo });
    if (!r.ok) return next(new ErroHttp('OTP_INVALIDO'));

    const c = await clientes.porCelular(celular);
    if (!c || !c.senha_hash || !c.celular_verificado) return next(new ErroHttp('OTP_INVALIDO'));

    await clientes.definirSenha(c.id, await hashSenha(req.body.nova_senha));
    await logs.registrar({ quem_tipo: 'cliente', quem_id: c.id, acao: 'senha_redefinida', ip: req.ip });

    req.session.clienteId = c.id;
    delete req.session.usuarioId;
    delete req.session.role;
    delete req.session.equipeExpiraEm;
    res.json({ cliente: { id: c.id, nome: c.nome } });
  }));
```

`hashSenha` is already imported in `auth.js` via `verificarSenha`? No — `auth.js` imports `{ verificarSenha }` only. Add `hashSenha` to that import: `import { verificarSenha, hashSenha } from '../auth/senha.js';`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- test/http/reset-senha.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add src/routes/auth.js test/http/reset-senha.test.js
git commit -m "feat(p5): POST /api/auth/senha/redefinir por código

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Limpeza de `otp_codigos` no cron

**Files:**
- Modify: `src/server.js` (job `jobMsgs`, ~linhas 30-32)

**Interfaces:**
- Consumes: `limparAntigos` de `src/repos/otp.js`.
- Produces: a cada minuto, além de `processarPendentes()`, roda `otpRepo.limparAntigos({ dias: 1 })`.

- [ ] **Step 1: Edit `src/server.js`**

Add import near the others:

```js
import * as otpRepo from './repos/otp.js';
```

Change `jobMsgs`:

```js
  const jobMsgs = cron.schedule('* * * * *', async () => {
    try { await processarPendentes(); } catch (e) { console.error('cron mensageiro', e); }
    try { await otpRepo.limparAntigos({ dias: 1 }); } catch (e) { console.error('cron limpeza otp', e); }
  });
```

- [ ] **Step 2: Sanity check — server still boots**

Run: `node -e "import('./src/server.js').then(() => { console.log('ok'); process.exit(0); })"`
Expected: sem erro de import/sintaxe (o bloco `ehEntrypoint` não dispara nesse `-e`). Se `migrar` tentar rodar, é aceitável; o objetivo é só validar o módulo.

- [ ] **Step 3: Run the full boot-adjacent test**

Run: `npm test -- test/http/saude.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/server.js
git commit -m "chore(p5): cron apaga otp_codigos com mais de 1 dia

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: UI `/agendar` — campo de código no passo "Seus dados"

**Files:**
- Modify: `src/views/agendar.ejs` (bloco `<template x-if="form.comSenha">`, ~linhas 67-73)
- Modify: `src/public/js/agendar.js` (objeto retornado por `fluxoAgendamento()`; função `enviarCadastro`)
- Create (test): `test/public/agendar-codigo.test.js`

**Interfaces:**
- Consumes: `pedirJson` de `./comum.js` (já importado); endpoint `POST /api/auth/otp/enviar`; `POST /api/agenda/cadastro` com campo `codigo`.
- Produces: no passo 4, quando `form.comSenha` está marcado, aparece botão "Enviar código" + input `form.codigo`; `enviarCadastro()` inclui `codigo` no corpo e trata `OTP_INVALIDO`.

- [ ] **Step 1: Write the failing test (rendered HTML has the hooks)**

Create `test/public/agendar-codigo.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET /agendar traz o input de código e o botão de enviar código', async () => {
  const res = await request(buildApp()).get('/agendar');
  assert.equal(res.status, 200);
  assert.match(res.text, /x-model="form\.codigo"/);
  assert.match(res.text, /@click="enviarCodigo\(\)"/);
});
```

Also add, in the same file, a unit check of the Alpine factory (imported directly — it is exported for `window`):

```js
test('fluxoAgendamento expõe estado de código', async () => {
  const mod = await import('../../src/public/js/agendar.js');
  // a factory é atribuída a window no browser; no teste, re-declara e chama
  // (o módulo só faz window.* se typeof window !== 'undefined')
  assert.equal(typeof mod.montarCalendario, 'function');
});
```

> Nota: `fluxoAgendamento` hoje **não** é exportado (só `montarCalendario` é). Para testar o estado sem browser, **exporte** `fluxoAgendamento` em `src/public/js/agendar.js` (`export function fluxoAgendamento()`), mantendo o bloco `window.fluxoAgendamento = fluxoAgendamento`. Então:

```js
test('estado inicial do código', async () => {
  const { fluxoAgendamento } = await import('../../src/public/js/agendar.js');
  const st = fluxoAgendamento();
  assert.equal(st.codigoEnviado, false);
  assert.equal(st.reenvioEm, 0);
  assert.equal(st.form.codigo, '');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/public/agendar-codigo.test.js`
Expected: FAIL — HTML sem os hooks; `fluxoAgendamento` não exportado.

- [ ] **Step 3: Edit `src/views/agendar.ejs`**

Replace the `<template x-if="form.comSenha">` block (currently just email + senha) with:

```html
    <template x-if="form.comSenha">
      <div>
        <label>E-mail <input type="email" x-model="form.email"></label>
        <label>Senha <input type="password" x-model="form.senha"></label>
        <div class="otp-linha">
          <button type="button" @click="enviarCodigo()" :disabled="reenvioEm > 0"
            x-text="reenvioEm > 0 ? ('Reenviar em ' + reenvioEm + 's') : 'Enviar código'"></button>
        </div>
        <label x-show="codigoEnviado">Código recebido
          <input x-model="form.codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
        </label>
      </div>
    </template>
```

- [ ] **Step 4: Edit `src/public/js/agendar.js`**

- Change `export function fluxoAgendamento()` (add `export`).
- In the returned object, extend `form` and add state + methods:

```js
    form: { nome: '', celular: '', comSenha: false, email: '', senha: '', codigo: '', consentimento: false },
    codigoEnviado: false,
    reenvioEm: 0,
    _reenvioTimer: null,
```

```js
    async enviarCodigo() {
      this.erro = '';
      if (!this.form.celular) { this.erro = 'Informe o celular primeiro.'; return; }
      const { ok } = await pedirJson('/api/auth/otp/enviar', {
        method: 'POST',
        body: JSON.stringify({ celular: this.form.celular, proposito: 'cadastro' }),
      });
      if (!ok) { this.erro = 'Não foi possível enviar o código. Tente em instantes.'; return; }
      this.codigoEnviado = true;
      this.reenvioEm = 60;
      clearInterval(this._reenvioTimer);
      this._reenvioTimer = setInterval(() => {
        this.reenvioEm -= 1;
        if (this.reenvioEm <= 0) clearInterval(this._reenvioTimer);
      }, 1000);
    },
```

- In `enviarCadastro()`, include `codigo` when `comSenha` and surface `OTP_INVALIDO`:

```js
    async enviarCadastro() {
      this.erro = '';
      if (!this.form.consentimento) { this.erro = 'É preciso aceitar a política de privacidade.'; return; }
      const body = {
        nome: this.form.nome, celular: this.form.celular, consentimento: true,
        ...(this.form.comSenha
          ? { email: this.form.email, senha: this.form.senha, codigo: this.form.codigo }
          : {}),
      };
      const { ok, corpo } = await pedirJson('/api/agenda/cadastro', { method: 'POST', body: JSON.stringify(body) });
      if (!ok) {
        this.erro = corpo?.erro === 'OTP_INVALIDO'
          ? 'Código inválido ou expirado.'
          : (corpo?.campos?.[0]?.mensagem || 'Verifique os dados.');
        return;
      }
      this.passo = 5;
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/public/agendar-codigo.test.js`
Expected: PASS.

- [ ] **Step 6: Run the page + asset regression**

Run: `npm test -- test/http/paginas.test.js test/http/csp.test.js test/public/agendar-calendario.test.js`
Expected: PASS — `agendar.ejs` ainda tem `id="dados-pagina"`, `src="/js/agendar.js"`, `class="servico-card"`; nada inline novo que viole CSP.

- [ ] **Step 7: Commit**

```bash
git add src/views/agendar.ejs src/public/js/agendar.js test/public/agendar-codigo.test.js
git commit -m "feat(p5): /agendar pede código ao criar senha

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: UI `/minha-conta` — "Esqueci minha senha"

**Files:**
- Modify: `src/views/minha-conta.ejs` (bloco `!logado`, ~linhas 14-27)
- Modify: `src/public/js/minha-conta.js` (objeto de `areaCliente()`)
- Create (test): `test/public/minha-conta-reset.test.js`

**Interfaces:**
- Consumes: `pedirJson` de `./comum.js`; endpoints `POST /api/auth/otp/enviar` (`proposito:'reset'`), `POST /api/auth/senha/redefinir`.
- Produces: link "Esqueci minha senha" abre bloco de 3 passos; ao concluir, `logado=true` e listas carregadas.

- [ ] **Step 1: Write the failing test**

Create `test/public/minha-conta-reset.test.js`:

```js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('GET /minha-conta tem o gatilho de "esqueci minha senha"', async () => {
  const res = await request(buildApp()).get('/minha-conta');
  assert.equal(res.status, 200);
  assert.match(res.text, /modoReset\s*=\s*true|@click="modoReset/);
  assert.match(res.text, /redefinirSenha\(\)/);
});

test('areaCliente expõe estado do reset', async () => {
  const { areaCliente } = await import('../../src/public/js/minha-conta.js');
  const st = areaCliente();
  assert.equal(st.modoReset, false);
  assert.equal(st.passoReset, 1);
  assert.deepEqual(st.reset, { celular: '', codigo: '', senha: '', senha2: '' });
});
```

> Nota: como em `agendar.js`, `areaCliente` hoje não é exportada. Adicione `export` mantendo o bloco `window.areaCliente = areaCliente`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/public/minha-conta-reset.test.js`
Expected: FAIL.

- [ ] **Step 3: Edit `src/views/minha-conta.ejs`**

Inside the `<div x-show="!carregando && !logado">`, after the `<details>Entrar sem senha</details>`, add:

```html
    <p><button type="button" class="link" @click="modoReset = true" x-show="!modoReset">Esqueci minha senha</button></p>

    <div x-show="modoReset" class="reset-box">
      <p class="erro-inline" x-show="erroReset" x-text="erroReset"></p>

      <div x-show="passoReset === 1">
        <label>Celular <input type="tel" x-model="reset.celular"></label>
        <button type="button" class="btn-primario" @click="enviarCodigoReset()">Enviar código</button>
      </div>

      <div x-show="passoReset === 2">
        <label>Código recebido
          <input x-model="reset.codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
        </label>
        <button type="button" class="btn-primario" @click="passoReset = 3">Continuar</button>
        <button type="button" class="voltar" @click="passoReset = 1">← voltar</button>
      </div>

      <div x-show="passoReset === 3">
        <label>Nova senha <input type="password" x-model="reset.senha"></label>
        <label>Repita a senha <input type="password" x-model="reset.senha2"></label>
        <button type="button" class="btn-primario" @click="redefinirSenha()">Redefinir</button>
        <button type="button" class="voltar" @click="passoReset = 2">← voltar</button>
      </div>
    </div>
```

- [ ] **Step 4: Edit `src/public/js/minha-conta.js`**

- `export function areaCliente()`.
- Add state:

```js
    modoReset: false,
    passoReset: 1,
    reset: { celular: '', codigo: '', senha: '', senha2: '' },
    erroReset: '',
```

- Add methods:

```js
    async enviarCodigoReset() {
      this.erroReset = '';
      if (!this.reset.celular) { this.erroReset = 'Informe o celular.'; return; }
      await pedirJson('/api/auth/otp/enviar', {
        method: 'POST',
        body: JSON.stringify({ celular: this.reset.celular, proposito: 'reset' }),
      });
      // resposta é sempre 200 (não vaza) — avança para o passo do código
      this.passoReset = 2;
    },

    async redefinirSenha() {
      this.erroReset = '';
      if (this.reset.senha.length < 6) { this.erroReset = 'A senha precisa de ao menos 6 caracteres.'; return; }
      if (this.reset.senha !== this.reset.senha2) { this.erroReset = 'As senhas não conferem.'; return; }
      const { ok, corpo } = await pedirJson('/api/auth/senha/redefinir', {
        method: 'POST',
        body: JSON.stringify({ celular: this.reset.celular, codigo: this.reset.codigo, nova_senha: this.reset.senha }),
      });
      if (!ok) {
        this.erroReset = corpo?.erro === 'MUITAS_TENTATIVAS'
          ? 'Muitas tentativas, aguarde alguns minutos.'
          : 'Código inválido ou expirado.';
        this.passoReset = 2;
        return;
      }
      this.modoReset = false;
      this.passoReset = 1;
      this.reset = { celular: '', codigo: '', senha: '', senha2: '' };
      this.logado = true;
      this.aba = 'proximos';
      this.carregarListas();
      toast('Senha redefinida. Você está logado.', 'info');
    },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- test/public/minha-conta-reset.test.js`
Expected: PASS.

- [ ] **Step 6: Run the page regression**

Run: `npm test -- test/http/paginas.test.js test/http/csp.test.js`
Expected: PASS — `minha-conta.ejs` mantém `id="app-conta"`, `x-data="areaCliente()"`, `src="/js/minha-conta.js"`.

- [ ] **Step 7: Commit**

```bash
git add src/views/minha-conta.ejs src/public/js/minha-conta.js test/public/minha-conta-reset.test.js
git commit -m "feat(p5): fluxo 'esqueci minha senha' em /minha-conta

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: Documentar as rotas em `docs/API.md`

**Files:**
- Modify: `docs/API.md` (tabela de `/api/auth`, tabela de `/api/agenda`, seção "Contrato de erro")

**Interfaces:**
- Consumes: nada (documentação).
- Produces: `docs/API.md` lista `POST /api/auth/otp/enviar`, `POST /api/auth/senha/redefinir`, o campo `codigo` em `POST /api/agenda/cadastro`, e `OTP_INVALIDO` na lista de erros.

- [ ] **Step 1: Add the auth routes**

Na seção de `/api/auth`, acrescente as linhas:

```markdown
| POST | `/api/auth/otp/enviar` | público (rate-limit) | `{ celular:string, proposito:'cadastro'\|'reset' }` | `200 { enviado:true }` sempre (não vaza cadastro) · `429 MUITAS_TENTATIVAS` |
| POST | `/api/auth/senha/redefinir` | público (rate-limit) | `{ celular:string, codigo:/^\d{6}$/, nova_senha:string(≥6) }` | `200 { cliente:{id,nome} }` + sessão de cliente · `400 OTP_INVALIDO` |
```

- [ ] **Step 2: Update the `/cadastro` row**

Localize a linha de `POST /api/agenda/cadastro` e ajuste o corpo para incluir:

```
{ nome, celular, consentimento:true, email?, senha?(≥6), codigo?:/^\d{6}$/ }
```

Adicione a nota: "Quando `senha` é enviada, `codigo` passa a ser obrigatório e é verificado (`proposito='cadastro'`); a conta nasce/vira `celular_verificado=true`. Sem `senha`, `codigo` é ignorado."

- [ ] **Step 3: Add `OTP_INVALIDO` to the error contract section**

Na tabela de códigos de erro, adicione:

```markdown
| `OTP_INVALIDO` | 400 | código de verificação ausente inválido, expirado ou já usado |
```

- [ ] **Step 4: Commit**

```bash
git add docs/API.md
git commit -m "docs(p5): rotas de OTP e reset na referência de API

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Final Verification

- [ ] **Full suite, single run (no overlap):**

Run: `npm test`
Expected: PASS, 0 fail, exit 0. Preste atenção a `test/services/templates-meta.test.js` (agora 4 templates), `test/http/paginas.test.js`, `test/http/cliente.test.js`, `test/agenda/confirmar.test.js`.

- [ ] **Manual smoke (opcional, com o server local):**
  1. `npm run dev`; abrir `/agendar`, ir até "Seus dados", marcar "Quero criar uma senha", "Enviar código".
  2. Ler o código em **Admin → Mensagens** (`status: simulado`, corpo com o código).
  3. Completar o cadastro; confirmar que `clientes.celular_verificado` ficou `true` (via Admin → Clientes ou psql).
  4. `/minha-conta` → "Esqueci minha senha" → repetir com `proposito:'reset'`.

- [ ] **Push:**

```bash
git push origin <branch>
```

CI (`postgres:17` isolado) roda a suíte completa; Render faz deploy do demo.

---

## Self-Review (preenchido pelo autor do plano)

**Cobertura da spec:**
- §3 migração 005 → Task 1 ✅
- §4 `repos/otp.js` → Task 2 ✅
- §5 `services/otp.js` → Task 2 ✅
- §6 `services/mensagens.js` + refactor `agendar.js` → Task 3 ✅
- §7 rotas `/otp/enviar` e `/senha/redefinir` → Tasks 7 e 9 ✅
- §8 `/cadastro` com `codigo` → Task 8 ✅
- §9 rate limiting → Task 5 ✅
- §10 template `codigo_verificacao` → Task 4 ✅
- §11 limpeza no cron → Task 10 ✅
- §12 UI `/agendar` → Task 11 ✅
- §13 UI `/minha-conta` → Task 12 ✅
- §14 `OTP_INVALIDO` → Task 5 ✅; redact de log → Task 5 ✅ (adição do plano, não estava na spec — cabe no escopo)
- §15 testes → distribuídos por task + Final Verification ✅
- §16 impacto P1–P4 (`templates-meta.test.js`, `confirmar.test.js`, `resetRateLimit`) → Tasks 3, 4, 5 ✅
- `docs/API.md` (listado nos "Arquivos" da spec) → Task 13 ✅

**Placeholders:** nenhum "TBD"/"handle errors"; todo código está escrito.

**Consistência de tipos:**
- `emitir({celular,proposito}) => {codigo}` — usado igual nas Tasks 2, 7.
- `verificar({celular,proposito,codigo}) => {ok}` — Tasks 2, 8, 9.
- `enfileirarMensagem({templateChave,telefone,vars,agendamentoId}, exec)` — Tasks 3, 7.
- `clientes.criar({..., celular_verificado})`, `clientes.definirSenha(id,hash)`, `clientes.marcarCelularVerificado(id)`, `clientes.porId(id)` — definidos na Task 6, usados nas Tasks 7, 8, 9.
- `otpRepo.limparAntigos({dias})` — Task 2 define, Task 10 usa.
- Erro único `OTP_INVALIDO` em toda a superfície pública; `MUITAS_TENTATIVAS` só do rate-limit; `VALIDACAO` (400 neste projeto, não 422) para `codigo` ausente com `senha`.

**Dependência circular de teste (Task 5 ↔ Task 7):** anotada explicitamente na Task 5 Step 5 — em execução por subagente, encadeada normalmente; inline, fazer 5(1-3) → 7 → 5(4-6).
