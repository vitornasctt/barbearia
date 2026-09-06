// test/services/mensageiro.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { processarPendentes } from '../../src/services/mensageiro.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

async function pend(n) {
  for (let i = 0; i < n; i++) {
    await query(
      `INSERT INTO mensagens_whatsapp (telefone_destino, mensagem_final, status_envio)
       VALUES ($1,$2,'pendente')`, [`552899999000${i}`, `msg ${i}`]);
  }
}

test('processarPendentes marca simulado e enviado_em', async () => {
  await pend(3);
  const r = await processarPendentes();
  assert.equal(r.processadas, 3);
  const rows = await query(`SELECT status_envio, enviado_em FROM mensagens_whatsapp`);
  assert.ok(rows.rows.every((x) => x.status_envio === 'simulado' && x.enviado_em));
});

test('dois processarPendentes paralelos não processam a mesma linha (SKIP LOCKED)', async () => {
  await pend(6);
  const [a, b] = await Promise.all([processarPendentes({ limite: 6 }), processarPendentes({ limite: 6 })]);
  assert.equal(a.processadas + b.processadas, 6);
  const restantes = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp WHERE status_envio='pendente'`);
  assert.equal(restantes.rows[0].n, 0);
});

test('linha presa em "enviando" de um run que quebrou é reprocessada', async () => {
  await query(
    `INSERT INTO mensagens_whatsapp (telefone_destino, mensagem_final, status_envio)
     VALUES ('5528999990000','msg presa','pendente')`);
  await query(
    `UPDATE mensagens_whatsapp
     SET status_envio='enviando', created_at = now() - interval '10 minutes', enviado_em = NULL`);
  const r = await processarPendentes();
  assert.equal(r.processadas, 1);
  const row = await query(`SELECT status_envio FROM mensagens_whatsapp`);
  assert.equal(row.rows[0].status_envio, 'simulado');
});
