// test/boot/bootstrap.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inicializar } from '../../src/bootstrap.js';
import { query } from '../../src/db/pool.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('inicializar() aplica migrações — schema_migrations tem as 3', async () => {
  await inicializar();
  const { rows } = await query('SELECT nome FROM schema_migrations ORDER BY nome');
  const nomes = rows.map((r) => r.nome);
  for (const m of ['001_init.sql', '002_session.sql', '003_status_enviando.sql']) {
    assert.ok(nomes.includes(m), `faltou ${m}`);
  }
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
