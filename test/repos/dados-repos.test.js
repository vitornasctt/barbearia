// test/repos/dados-repos.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as servicos from '../../src/repos/servicos.js';
import * as configuracao from '../../src/repos/configuracao.js';
import * as meses from '../../src/repos/disponibilidadeMeses.js';
import * as bloqueios from '../../src/repos/bloqueios.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

test('servicos: ativos, criar, atualizar, remover soft x hard', async () => {
  assert.equal((await servicos.ativos()).length, 3);
  const novo = await servicos.criar({ nome: 'Sobrancelha', duracao_minutos: 20, preco: 15, comissao_percentual: 40 });
  assert.ok(novo.id);
  const upd = await servicos.atualizar(novo.id, { preco: 18, ativo: false });
  assert.equal(Number(upd.preco), 18);
  assert.equal(await servicos.remover(novo.id), 'hard'); // nunca usado

  const corte = (await servicos.todos()).find((s) => s.nome === 'Corte');
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('C','1') RETURNING id`)).rows[0].id;
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
    VALUES ($1,$2,$3,'2026-09-10','09:00','09:35','concluido',10)`, [cli, corte.id, b]);
  assert.equal(await servicos.remover(corte.id), 'soft');
});

test('configuracao.obter/atualizar mexe na linha 1 e no expediente', async () => {
  const c0 = await configuracao.obter();
  assert.equal(c0.expediente.length, 7);
  const c1 = await configuracao.atualizar({ nome_barbearia: 'Nova', intervalo_minutos: 40 },
    c0.expediente.map((e) => e.dia_semana === 1 ? { ...e, abre: '10:00' } : e));
  assert.equal(c1.nome_barbearia, 'Nova');
  assert.equal(c1.intervalo_minutos, 40);
  assert.equal(c1.expediente.find((e) => e.dia_semana === 1).abre, '10:00:00');
});

test('meses.doAno tem 12 linhas; definir faz upsert', async () => {
  const l = await meses.doAno(2026);
  assert.equal(l.length, 12);
  assert.ok(l.every((m) => m.status === 'fechado'));
  await meses.definir({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 8 });
  await meses.definir({ ano: 2026, mes: 9, status: 'aberto', limite_por_dia: 10 }); // upsert
  const l2 = await meses.doAno(2026);
  assert.equal(l2.find((m) => m.mes === 9).limite_por_dia, 10);
});

test('bloqueios: criar, listar entre, remover', async () => {
  const b = await bloqueios.criar({ data: '2026-09-10', motivo: 'feriado' });
  assert.ok(b.id);
  assert.equal((await bloqueios.entre('2026-09-01', '2026-09-30')).length, 1);
  assert.equal(await bloqueios.remover(b.id), true);
  assert.equal((await bloqueios.entre('2026-09-01', '2026-09-30')).length, 0);
});
