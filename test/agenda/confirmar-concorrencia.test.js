// test/agenda/confirmar-concorrencia.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { confirmarAgendamento } from '../../src/agenda/agendar.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('8 confirmações paralelas no mesmo slot => exatamente 1 sucesso', async () => {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const ids = [];
  for (let i = 0; i < 8; i++) {
    ids.push((await query(`INSERT INTO clientes (nome, celular) VALUES ($1,$2) RETURNING id`,
      [`C${i}`, `11${i}`])).rows[0].id);
  }

  const agora = new Date('2026-09-01T08:00:00');
  const resultados = await Promise.all(ids.map((cli) =>
    confirmarAgendamento({ clienteId: cli, servicoId: s, barbeiroId: b,
      data: '2026-09-10', horario: '16:00', sessionId: `s${cli}`, agora })));

  const ok = resultados.filter((r) => r.ok);
  const falha = resultados.filter((r) => !r.ok);
  assert.equal(ok.length, 1);
  assert.equal(falha.length, 7);
  assert.ok(falha.every((r) => r.erro === 'HORARIO_INDISPONIVEL'));

  const n = await query(
    `SELECT count(*)::int AS n FROM agendamentos
     WHERE data_agendamento='2026-09-10' AND horario_inicio='16:00' AND status IN ('pendente','confirmado')`);
  assert.equal(n.rows[0].n, 1);
});

test('faixas sobrepostas com inícios diferentes => só uma confirma', async () => {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const cb = (await query(`SELECT id FROM servicos WHERE nome='Corte + Barba'`)).rows[0].id; // 70 min
  const corte = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;      // 35 min
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status) VALUES (2026,9,NULL,'aberto')`);
  const c1 = (await query(`INSERT INTO clientes (nome, celular) VALUES ('A','21') RETURNING id`)).rows[0].id;
  const c2 = (await query(`INSERT INTO clientes (nome, celular) VALUES ('B','22') RETURNING id`)).rows[0].id;

  const agora = new Date('2026-09-01T08:00:00');
  const resultados = await Promise.all([
    confirmarAgendamento({ clienteId: c1, servicoId: cb, barbeiroId: b,
      data: '2026-09-10', horario: '09:00', sessionId: 's1', agora }),   // 09:00–10:10
    confirmarAgendamento({ clienteId: c2, servicoId: corte, barbeiroId: b,
      data: '2026-09-10', horario: '09:35', sessionId: 's2', agora }),   // 09:35–10:10 (sobrepõe)
  ]);

  const ok = resultados.filter((r) => r.ok);
  const falha = resultados.filter((r) => !r.ok);
  assert.equal(ok.length, 1);
  assert.equal(falha.length, 1);
  assert.equal(falha[0].erro, 'HORARIO_INDISPONIVEL');

  const n = await query(
    `SELECT count(*)::int AS n FROM agendamentos
     WHERE data_agendamento='2026-09-10' AND status IN ('pendente','confirmado')`);
  assert.equal(n.rows[0].n, 1);
});
