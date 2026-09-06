import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarCelular } from '../../src/lib/celular.js';

test('normaliza formatos comuns', () => {
  assert.equal(normalizarCelular('(28) 99967-5424'), '5528999675424');
  assert.equal(normalizarCelular('28999675424'), '5528999675424');
  assert.equal(normalizarCelular('+55 28 99967-5424'), '5528999675424');
  assert.equal(normalizarCelular('5528999675424'), '5528999675424');
});

test('rejeita entrada absurda', () => {
  assert.throws(() => normalizarCelular('123'), /CELULAR_INVALIDO/);
});
