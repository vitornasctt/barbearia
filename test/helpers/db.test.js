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
