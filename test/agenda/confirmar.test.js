// test/agenda/confirmar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

const DATA = '2026-09-10';
const CEDO = new Date('2026-09-01T08:00:00');

async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','11999') RETURNING id`)).rows[0].id;
  return { b, s, cli };
}

test('cria agendamento pendente, grava comissão e mensagem, remove lock', async () => {
  const { b, s, cli } = await ctx();
  await query(`INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
    VALUES ($1,$2,'14:00','sess', now() + interval '5 minutes')`, [b, DATA]);

  const r = await confirmarAgendamento({
    clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '14:00',
    sessionId: 'sess', agora: CEDO,
  });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.status, 'pendente');
  assert.equal(Number(r.agendamento.valor_total), 45);
  assert.equal(Number(r.agendamento.comissao_valor), 22.5);
  assert.equal(r.agendamento.horario_fim, '14:35:00');

  assert.equal((await query('SELECT count(*)::int n FROM horarios_lock')).rows[0].n, 0);
  const msg = await query(`SELECT * FROM mensagens_whatsapp WHERE agendamento_id=$1`, [r.agendamento.id]);
  assert.equal(msg.rows.length, 1);
  assert.equal(msg.rows[0].status_envio, 'pendente');
  assert.match(msg.rows[0].mensagem_final, /Ana/);
  const c = await query(`SELECT ultimo_agendamento FROM clientes WHERE id=$1`, [cli]);
  assert.equal(c.rows[0].ultimo_agendamento.toISOString().slice(0, 10), DATA);
});

test('segundo agendamento no mesmo slot => HORARIO_INDISPONIVEL', async () => {
  const { b, s, cli } = await ctx();
  const ok = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '15:00', sessionId: 'x', agora: CEDO });
  assert.equal(ok.ok, true);
  const dup = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: DATA, horario: '15:00', sessionId: 'y', agora: CEDO });
  assert.deepEqual(dup, { ok: false, erro: 'HORARIO_INDISPONIVEL' });
});

test('revalida no servidor mesmo com payload adulterado (mês fechado)', async () => {
  const { b, s, cli } = await ctx();
  const r = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b, data: '2026-12-24', horario: '10:00', sessionId: 'x', agora: CEDO });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'MES_FECHADO');
});

test('serviço inexistente => SERVICO_INVALIDO', async () => {
  const { b, cli } = await ctx();
  const r = await confirmarAgendamento({ clienteId: cli, servicoId: 9999, barbeiroId: b, data: DATA, horario: '10:00', sessionId: 'x', agora: CEDO });
  assert.deepEqual(r, { ok: false, erro: 'SERVICO_INVALIDO' });
});
