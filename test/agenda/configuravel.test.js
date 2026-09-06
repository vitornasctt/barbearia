// test/agenda/configuravel.test.js
// Prova que o motor lê intervalo e antecedência de `configuracao`, sem valores fixos (35/2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepararBanco, semearBase, fecharBanco } from '../helpers/db.js';
import { query } from '../../src/db/pool.js';
import { horariosDisponiveis } from '../../src/agenda/disponibilidade.js';
import * as cache from '../../src/agenda/cache.js';

test.after(() => fecharBanco());
test.beforeEach(async () => { await prepararBanco(); await semearBase(); cache.limparTudo(); });

const DATA = '2026-09-10'; // quinta

async function barbeiro() {
  return (await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`)).rows[0].id;
}
async function servicoCorte() {
  return (await query(`SELECT id FROM servicos WHERE nome='Corte'`)).rows[0].id;
}

test('intervalo=20 e antecedencia=5h vêm de configuracao', async () => {
  await query(`UPDATE configuracao SET intervalo_minutos=20, antecedencia_min_horas=5 WHERE id=1`);
  await query(`INSERT INTO agenda_disponibilidade (ano, mes, barbeiro_id, status)
    VALUES (2026, 9, NULL, 'aberto')`);
  const bId = await barbeiro();
  const servicoId = await servicoCorte();

  // grade em passos de 20 min a partir de 09:00
  const cedo = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId,
    agora: new Date('2026-09-01T08:00:00') });
  assert.equal(cedo.fechado, null);
  assert.ok(cedo.disponivel.includes('09:20'));
  assert.ok(cedo.disponivel.includes('09:40'));
  assert.ok(!cedo.disponivel.includes('09:35')); // não seria passo de 20

  // antecedência de 5h: às 12:00 o slot 15:00 (3h à frente) continua escondido; 18:00 aparece
  cache.limparTudo();
  const r = await horariosDisponiveis({ barbeiroId: bId, data: DATA, servicoId,
    agora: new Date('2026-09-10T12:00:00') });
  assert.ok(!r.disponivel.includes('15:00'));
  assert.ok(r.disponivel.includes('18:00'));
});
