// test/agenda/cancelar-remarcar.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento, cancelarAgendamento, remarcarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

const CEDO = new Date('2026-09-01T08:00:00');
async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','11') RETURNING id`)).rows[0].id;
  const ag = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '10:10', sessionId: 'x', agora: CEDO });
  return { b, s, cli, ag: ag.agendamento };
}

test('cancelar libera o slot e registra o motivo', async () => {
  const { b, s, cli, ag } = await ctx();
  const r = await cancelarAgendamento(ag.id, { motivo: 'cliente desistiu' });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.status, 'cancelado');
  assert.equal(r.agendamento.motivo_cancelamento, 'cliente desistiu');
  // slot volta a poder ser agendado
  const denovo = await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '10:10', sessionId: 'y', agora: CEDO });
  assert.equal(denovo.ok, true);
});

test('cancelar duas vezes => JA_CANCELADO', async () => {
  const { ag } = await ctx();
  await cancelarAgendamento(ag.id, {});
  assert.deepEqual(await cancelarAgendamento(ag.id, {}), { ok: false, erro: 'JA_CANCELADO' });
});

test('cancelar id inexistente => NAO_ENCONTRADO', async () => {
  assert.deepEqual(await cancelarAgendamento(9999, {}), { ok: false, erro: 'NAO_ENCONTRADO' });
});

test('remarcar cancela o antigo e cria novo no horário novo', async () => {
  const { ag } = await ctx();
  const r = await remarcarAgendamento(ag.id, { novaData: '2026-09-10', novoHorario: '11:20', agora: CEDO });
  assert.equal(r.ok, true);
  assert.equal(r.agendamento.horario_inicio, '11:20:00');
  const antigo = await query(`SELECT status, motivo_cancelamento FROM agendamentos WHERE id=$1`, [ag.id]);
  assert.equal(antigo.rows[0].status, 'cancelado');
  assert.equal(antigo.rows[0].motivo_cancelamento, 'remarcado');
});

test('remarcar para slot ocupado => HORARIO_INDISPONIVEL e nada muda', async () => {
  const { b, s, cli, ag } = await ctx();
  await confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
    data: '2026-09-10', horario: '12:30', sessionId: 'z', agora: CEDO });
  const r = await remarcarAgendamento(ag.id, { novaData: '2026-09-10', novoHorario: '12:30', agora: CEDO });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'HORARIO_INDISPONIVEL');
  const antigo = await query(`SELECT status FROM agendamentos WHERE id=$1`, [ag.id]);
  assert.equal(antigo.rows[0].status, 'pendente'); // rollback preservou o antigo
});
