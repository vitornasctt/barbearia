import test from 'node:test';
import assert from 'node:assert/strict';
import { gerarSlots } from '../../src/agenda/slots.js';

test('09:00–19:30, passo 35, serviço 35: primeiro 09:00, último 18:55', () => {
  const s = gerarSlots({ abre: '09:00', fecha: '19:30', intervaloMinutos: 35, duracaoServico: 35 });
  assert.equal(s[0], '09:00');
  assert.equal(s[1], '09:35');
  assert.equal(s.at(-1), '18:55');
});

test('serviço de 50 min encurta a cauda (último 18:20)', () => {
  const s = gerarSlots({ abre: '09:00', fecha: '19:30', intervaloMinutos: 35, duracaoServico: 50 });
  assert.equal(s.at(-1), '18:20');
});

test('dia sem janela útil devolve vazio', () => {
  assert.deepEqual(gerarSlots({ abre: '19:00', fecha: '19:20', intervaloMinutos: 35, duracaoServico: 35 }), []);
  assert.deepEqual(gerarSlots({ abre: '19:30', fecha: '09:00', intervaloMinutos: 35, duracaoServico: 35 }), []);
});
