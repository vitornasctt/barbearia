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
