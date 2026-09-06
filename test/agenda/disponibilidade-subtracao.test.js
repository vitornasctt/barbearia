// test/agenda/disponibilidade-subtracao.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { horariosDisponiveis, verificarSlot } from '../../src/agenda/disponibilidade.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

const DATA = '2026-09-10';
const CEDO = new Date('2026-09-01T08:00:00');

async function ctx() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, duracao_minutos FROM servicos WHERE nome='Corte'`)).rows[0];
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, NULL, 'aberto')`);
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('C','1') RETURNING id`)).rows[0].id;
  return { b, servicoId: s.id, duracao: s.duracao_minutos, cli };
}
async function agendar(b, cli, servicoId, ini, fim, status = 'confirmado') {
  await query(
    `INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento,
       horario_inicio, horario_fim, status, valor_total)
     VALUES ($1,$2,$3,$4,$5,$6,$7, 10)`, [cli, servicoId, b, DATA, ini, fim, status]);
}

test('agendamento ativo remove o slot exato e os sobrepostos', async () => {
  const { b, servicoId, cli } = await ctx();
  await agendar(b, cli, servicoId, '10:10', '10:45');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(!r.disponivel.includes('10:10'));
  assert.ok(r.disponivel.includes('09:35')); // 09:35–10:10 encosta, não sobrepõe → continua
});

test('agendamento cancelado NÃO remove o slot', async () => {
  const { b, servicoId, cli } = await ctx();
  await agendar(b, cli, servicoId, '10:10', '10:45', 'cancelado');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(r.disponivel.includes('10:10'));
});

test('serviço de 50 min é barrado por agendamento no passo seguinte', async () => {
  const { b, cli } = await ctx();
  const s50 = (await query(
    `INSERT INTO servicos (nome, duracao_minutos, preco) VALUES ('Longo', 50, 80) RETURNING id`)).rows[0].id;
  const corte = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  await agendar(b, cli, corte, '10:10', '10:45');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId: s50, agora: CEDO });
  assert.ok(!r.disponivel.includes('09:35')); // 09:35+50=10:25 invade 10:10–10:45
});

test('bloqueio de dia inteiro zera a lista', async () => {
  const { b, servicoId } = await ctx();
  await query(`INSERT INTO bloqueios_agenda (data, motivo) VALUES ($1, 'feriado')`, [DATA]);
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.deepEqual(r.disponivel, []);
});

test('bloqueio de faixa remove só a faixa', async () => {
  const { b, servicoId } = await ctx();
  await query(`INSERT INTO bloqueios_agenda (data, hora_inicio, hora_fim, motivo)
    VALUES ($1, '12:00', '13:00', 'almoço')`, [DATA]);
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.ok(!r.disponivel.includes('11:55')); // 11:55–12:30 invade
  assert.ok(r.disponivel.includes('13:05'));
});

test('limite_por_dia atingido => fechado: limite_atingido', async () => {
  const { b, servicoId, cli } = await ctx();
  await query(`UPDATE agenda_disponibilidade SET limite_por_dia = 1 WHERE ano=2026 AND mes=9`);
  await agendar(b, cli, servicoId, '09:00', '09:35');
  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.equal(r.fechado, 'limite_atingido');
});

test('fechado específico do barbeiro vence aberto global do mês', async () => {
  const { b, servicoId, duracao } = await ctx();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, $1, 'fechado')`, [b]);

  const r = await horariosDisponiveis({ barbeiroId: b, data: DATA, servicoId, agora: CEDO });
  assert.equal(r.fechado, 'mes_fechado');
  assert.deepEqual(r.disponivel, []);

  const v = await verificarSlot(query, {
    barbeiroId: b, data: DATA, horario: '14:00', duracaoMinutos: duracao, agora: CEDO,
  });
  assert.equal(v.erro, 'MES_FECHADO');
});

test('verificarSlot: DIA_FECHADO em domingo e LIMITE_ATINGIDO com limite cheio', async () => {
  const { b, servicoId, duracao, cli } = await ctx();

  // 2026-09-13 é domingo => horario_funcionamento.aberto = false
  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: '2026-09-13', horario: '10:00',
      duracaoMinutos: duracao, agora: CEDO })).erro,
    'DIA_FECHADO');

  await query(`UPDATE agenda_disponibilidade SET limite_por_dia = 1 WHERE ano=2026 AND mes=9`);
  await agendar(b, cli, servicoId, '09:00', '09:35');
  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '14:00',
      duracaoMinutos: duracao, agora: CEDO })).erro,
    'LIMITE_ATINGIDO');
});

test('verificarSlot: ok para slot livre, erros específicos para os casos', async () => {
  const { b, servicoId, duracao, cli } = await ctx();
  assert.deepEqual(
    await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '14:00', duracaoMinutos: duracao, agora: CEDO }),
    { ok: true });

  await agendar(b, cli, servicoId, '14:00', '14:35');
  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '14:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'HORARIO_INDISPONIVEL');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '20:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'FORA_DO_EXPEDIENTE');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: '2026-10-10', horario: '10:00', duracaoMinutos: duracao, agora: CEDO })).erro,
    'MES_FECHADO');

  assert.equal(
    (await verificarSlot(query, { barbeiroId: b, data: DATA, horario: '09:00', duracaoMinutos: duracao,
      agora: new Date('2026-09-10T08:30:00') })).erro,
    'ANTECEDENCIA');
});
