import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { enfileirarMensagem } from '../../src/services/mensagens.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('enfileira mensagem com agendamento_id nulo usando um template existente', async () => {
  const r = await enfileirarMensagem({
    templateChave: 'confirmacao',
    telefone: '5511900000000',
    vars: { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X', nome_barbearia: 'B' },
  });
  assert.equal(r.enfileirada, true);
  const m = await query(`SELECT agendamento_id, template_chave, telefone_destino, mensagem_final, status_envio FROM mensagens_whatsapp`);
  assert.equal(m.rowCount, 1);
  assert.equal(m.rows[0].agendamento_id, null);
  assert.equal(m.rows[0].template_chave, 'confirmacao');
  assert.equal(m.rows[0].status_envio, 'pendente');
  assert.match(m.rows[0].mensagem_final, /Ana/);
});

test('template inexistente não enfileira e retorna enfileirada:false', async () => {
  const r = await enfileirarMensagem({ templateChave: 'nao_existe', telefone: '5511900000000', vars: {} });
  assert.equal(r.enfileirada, false);
  const m = await query(`SELECT count(*)::int AS n FROM mensagens_whatsapp`);
  assert.equal(m.rows[0].n, 0);
});
