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
