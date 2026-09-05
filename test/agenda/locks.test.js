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
