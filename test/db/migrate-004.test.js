import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { inicializar } from '../../src/bootstrap.js';
import { query } from '../../src/db/pool.js';
import { prepararBanco } from '../helpers/db.js';

before(async () => { await prepararBanco(); await inicializar(); });
beforeEach(prepararBanco);

test('a constraint NULLS NOT DISTINCT existe e a antiga foi removida', async () => {
  const { rows } = await query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid = (quote_ident(current_schema()) || '.agenda_disponibilidade')::regclass
      AND contype = 'u'`);
  const nomes = rows.map((r) => r.conname);
  assert.ok(nomes.includes('agenda_disponibilidade_ano_mes_barbeiro_uk'), `constraints: ${nomes}`);
  assert.ok(!nomes.includes('agenda_disponibilidade_ano_mes_barbeiro_id_key'), 'a antiga não foi removida');
});

test('duas linhas "mês global" (barbeiro_id NULL) para o mesmo ano/mês colidem', async () => {
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2030, 6, NULL, 'aberto')`);
  await assert.rejects(
    () => query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2030, 6, NULL, 'fechado')`),
    /duplicate key|unique/i,
  );
});
