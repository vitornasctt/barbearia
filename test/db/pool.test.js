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
