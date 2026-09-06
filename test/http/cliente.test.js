// test/http/cliente.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as cache from '../../src/agenda/cache.js';
import { hoje } from '../../src/lib/datas.js';

const ORIGIN = (await import('../../src/config.js')).config.APP_URL;
test.after(() => fecharBanco());
test.beforeEach(async () => {
  await prepararBanco(); await semearBase(); cache.limparTudo();
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026,9,NULL,'aberto'), (extract(year from now())::int, extract(month from now())::int, NULL, 'aberto')`);
});

async function logar() {
  const s = (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
  const a = request.agent(buildApp());
  await a.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'Ana', celular: '28999990000', consentimento: true });
  return { a, s };
}

test('GET /me e /agendamentos', async () => {
  const { a } = await logar();
  const me = await a.get('/api/cliente/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.cliente.nome, 'Ana');
  const lst = await a.get('/api/cliente/agendamentos').query({ quando: 'futuros' });
  assert.deepEqual(lst.body.agendamentos, []);
});

test('cancelar dentro do prazo funciona; agendamento de outro => 404', async () => {
  const { a, s } = await logar();
  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: '2026-09-10', horario: '16:00' });
  const id = conf.body.agendamento.id;
  const canc = await a.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'imprevisto' });
  assert.equal(canc.status, 200);
  assert.equal(canc.body.agendamento.status, 'cancelado');

  const outro = request.agent(buildApp());
  await outro.post('/api/agenda/cadastro').set('Origin', ORIGIN).send({ nome: 'B', celular: '28900001111', consentimento: true });
  const naoDele = await outro.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'x' });
  assert.equal(naoDele.status, 404);
});

test('cancelar fora do prazo => 403 FORA_DO_PRAZO', async () => {
  const { a, s } = await logar();
  // agendamento daqui a 1h (antecedência padrão 2h)
  const daqui1h = new Date(Date.now() + 3600_000);
  const hh = String(daqui1h.getHours()).padStart(2, '0') + ':00';
  await query(`UPDATE horario_funcionamento SET aberto=true, abre='00:00', fecha='23:59'`);
  const conf = await a.post('/api/agenda/confirmar').set('Origin', ORIGIN)
    .send({ servico_id: s, data: hoje(), horario: hh });
  // se o confirmar recusar por antecedência, este teste é inconclusivo — então
  // inserimos direto:
  let id = conf.body?.agendamento?.id;
  if (!id) {
    const cli = (await query(`SELECT id FROM clientes WHERE nome='Ana'`)).rows[0].id;
    const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
    id = (await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento, horario_inicio, horario_fim, status, valor_total)
      VALUES ($1,$2,$3,$4,$5,$5,'confirmado',10) RETURNING id`, [cli, s, b, hoje(), hh])).rows[0].id;
  }
  const canc = await a.post(`/api/cliente/agendamentos/${id}/cancelar`).set('Origin', ORIGIN).send({ motivo: 'x' });
  assert.equal(canc.status, 403);
  assert.equal(canc.body.erro, 'FORA_DO_PRAZO');
});
