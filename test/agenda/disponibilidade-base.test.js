// test/agenda/disponibilidade-base.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { horariosDisponiveis } from '../../src/agenda/disponibilidade.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

async function barbeiro() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0].id;
}
async function servicoCorte() {
  const r = await query(`SELECT id FROM servicos WHERE nome='Corte'`);
  return r.rows[0].id;
}
// 2026-09-10 é quinta-feira
const DATA = '2026-09-10';
async function abrirSetembro(bId) {
  await query(
    `INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
     VALUES (2026, 9, NULL, 'aberto')`,
  );
}

test('mês não liberado => fechado: mes_fechado', async () => {
  const bId = await barbeiro();
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') });
  assert.equal(r.fechado, 'mes_fechado');
  assert.deepEqual(r.disponivel, []);
});

test('mês liberado, dia útil => lista slots do expediente', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') });
  assert.equal(r.fechado, null);
  assert.equal(r.disponivel[0], '09:00');
  assert.equal(r.disponivel.at(-1), '18:55');
});

test('filtro de antecedência esconde os slots cedo demais', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  // agora = mesmo dia 09:00, antecedência padrão 2h => primeiro slot >= 11:00
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    agora: new Date('2026-09-10T09:00:00') });
  assert.ok(!r.disponivel.includes('09:00'));
  assert.ok(!r.disponivel.includes('10:45'));
  assert.ok(r.disponivel.includes('11:20'));
});

test('domingo (dia_semana 0) => fechado: dia_fechado', async () => {
  const bId = await barbeiro();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, NULL, 'aberto')`);
  const r = await horariosDisponiveis({ barbeiroId: bId, data: '2026-09-13', servicoId: await servicoCorte(),
    agora: new Date('2026-09-01T08:00:00') }); // 2026-09-13 é domingo
  assert.equal(r.fechado, 'dia_fechado');
});

// 14:15 = 09:00 + 35*9, ou seja um slot real da grade (intervalo_minutos=35).
test('lock de outra sessão remove o slot; o da própria sessão não', async () => {
  const bId = await barbeiro();
  await abrirSetembro(bId);
  await query(
    `INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
     VALUES ($1, $2, '14:15', 'sessao-A', now() + interval '5 minutes')`, [bId, DATA]);

  const outro = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    sessionId: 'sessao-B', agora: new Date('2026-09-01T08:00:00') });
  assert.ok(!outro.disponivel.includes('14:15'));

  cache.limparTudo();
  const dono = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId: await servicoCorte(),
    sessionId: 'sessao-A', agora: new Date('2026-09-01T08:00:00') });
  assert.ok(dono.disponivel.includes('14:15'));
});
