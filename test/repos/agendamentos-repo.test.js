// test/repos/agendamentos-repo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import * as ag from '../../src/repos/agendamentos.js';
import * as comissoes from '../../src/repos/comissoes.js';
import * as templates from '../../src/repos/templates.js';
import { hoje } from '../../src/lib/datas.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); });

async function base() {
  const b = (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
  const s = (await query(`SELECT id, preco, comissao_percentual FROM servicos WHERE nome='Corte'`)).rows[0];
  const cli = (await query(`INSERT INTO clientes (nome, celular) VALUES ('Ana','5511') RETURNING id`)).rows[0].id;
  return { b, s, cli };
}
async function criar(b, s, cli, data, hora, status) {
  await query(`INSERT INTO agendamentos (cliente_id, servico_id, barbeiro_id, data_agendamento,
    horario_inicio, horario_fim, status, valor_total, comissao_valor)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [cli, s.id, b, data, hora, hora, status, s.preco, (s.preco * s.comissao_percentual / 100)]);
}

test('listar filtra por status e pagina', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, '2026-09-10', '09:00', 'pendente');
  await criar(b, s, cli, '2026-09-11', '09:00', 'cancelado');
  const r = await ag.listar({ status: 'pendente' });
  assert.equal(r.total, 1);
  assert.equal(r.itens[0].cliente.nome, 'Ana');
  assert.equal(r.itens[0].servico.nome, 'Corte');
});

test('doCliente separa futuros e histórico', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, hoje(), '18:00', 'confirmado');
  await criar(b, s, cli, '2020-01-01', '09:00', 'concluido');
  assert.equal((await ag.doCliente(cli, 'futuros')).length, 1);
  assert.equal((await ag.doCliente(cli, 'historico')).length, 1);
});

test('dashboard soma faturamento/comissão de concluídos do mês', async () => {
  const { b, s, cli } = await base();
  const [ano, mes] = hoje().split('-');
  await criar(b, s, cli, `${ano}-${mes}-05`, '09:00', 'concluido');
  await criar(b, s, cli, `${ano}-${mes}-06`, '09:00', 'concluido');
  const d = await ag.dashboard();
  assert.equal(Number(d.contadores.faturamento_mes), 90);
  assert.equal(Number(d.contadores.comissao_mes), 45);
});

test('comissoes.relatorio agrupa por serviço com total', async () => {
  const { b, s, cli } = await base();
  await criar(b, s, cli, '2026-09-05', '09:00', 'concluido');
  await criar(b, s, cli, '2026-09-06', '09:00', 'concluido');
  const r = await comissoes.relatorio({ ano: 2026, mes: 9 });
  assert.equal(r.linhas[0].qtd, 2);
  assert.equal(Number(r.total.comissao), 45);
});

test('templates.atualizar muda o corpo', async () => {
  const t = await templates.atualizar('confirmacao', { titulo: 'T', corpo: 'novo {{nome_cliente}}', ativo: true });
  assert.equal(t.corpo, 'novo {{nome_cliente}}');
});
