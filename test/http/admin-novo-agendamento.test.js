// test/http/admin-novo-agendamento.test.js
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { resetRateLimit } from '../../src/auth/rateLimit.js';
import { logarEquipe } from '../helpers/sessao.js';
import { query } from '../../src/db/pool.js';
import { config } from '../../src/config.js';

before(prepararBanco);
beforeEach(async () => { await prepararBanco(); resetRateLimit(); });

async function contexto() {
  const s = await query(`SELECT id FROM servicos ORDER BY id LIMIT 1`);
  const cfg = await query(`SELECT barbeiro_padrao_id FROM configuracao WHERE id=1`);
  return { servicoId: s.rows[0].id, barbeiroId: cfg.rows[0].barbeiro_padrao_id };
}
function proximaSegunda() {
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}
async function abrirMeses() {
  const base = new Date(proximaSegunda() + 'T00:00:00Z');
  for (let i = 0; i < 3; i += 1) {
    const ano = base.getUTCFullYear();
    const mes = base.getUTCMonth() + 1;
    await query(
      `INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
       VALUES ($1,$2,NULL,'aberto')
       ON CONFLICT DO NOTHING`,
      [ano, mes],
    );
    base.setUTCMonth(base.getUTCMonth() + 1);
  }
}
async function dataComHorarios(agente, servicoId) {
  let data = proximaSegunda();
  for (let i = 0; i < 14; i += 1) {
    const hz = await agente.get(`/api/agenda/horarios?data=${data}&servico_id=${servicoId}`);
    if (hz.body && Array.isArray(hz.body.horarios) && hz.body.horarios.length) {
      return { data, horarios: hz.body.horarios };
    }
    const d = new Date(data + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    data = d.toISOString().slice(0, 10);
  }
  throw new Error('nenhum dia com horários livres encontrado');
}

test('cria agendamento para cliente novo (nome+celular)', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  await abrirMeses();
  const { data, horarios } = await dataComHorarios(agente, servicoId);
  const res = await agente.post('/api/admin/agendamentos').set('Origin', config.APP_URL).send({
    cliente: { nome: 'Walk In', celular: '11988887777' }, servico_id: servicoId, data, horario: horarios[0],
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.agendamento.id);
});

test('cria para cliente existente por cliente_id', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  const c = await query(`INSERT INTO clientes (nome, celular) VALUES ('Fulano','11977776666') RETURNING id`);
  await abrirMeses();
  const { data, horarios } = await dataComHorarios(agente, servicoId);
  const res = await agente.post('/api/admin/agendamentos').set('Origin', config.APP_URL).send({
    cliente_id: c.rows[0].id, servico_id: servicoId, data, horario: horarios[0],
  });
  assert.equal(res.status, 201);
});

test('409 quando o horário já está ocupado', async () => {
  const agente = await logarEquipe();
  const { servicoId } = await contexto();
  await abrirMeses();
  const { data, horarios } = await dataComHorarios(agente, servicoId);
  const horario = horarios[0];
  const body = { cliente: { nome: 'A', celular: '11900000001' }, servico_id: servicoId, data, horario };
  const um = await agente.post('/api/admin/agendamentos').set('Origin', config.APP_URL).send(body);
  assert.equal(um.status, 201);
  const dois = await agente.post('/api/admin/agendamentos').set('Origin', config.APP_URL)
    .send({ ...body, cliente: { nome: 'B', celular: '11900000002' } });
  assert.equal(dois.status, 409);
  assert.match(dois.body.erro, /HORARIO_INDISPONIVEL|SLOT_OCUPADO/);
});

test('a tela de agendamentos carrega o formulário de criação', async () => {
  const agente = await logarEquipe();
  const res = await agente.get('/admin/agendamentos');
  assert.equal(res.status, 200);
  assert.match(res.text, /Novo agendamento/);
});
