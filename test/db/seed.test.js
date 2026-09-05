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
