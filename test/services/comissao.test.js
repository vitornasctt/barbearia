import test from 'node:test';
import assert from 'node:assert/strict';
import { calcularComissao } from '../../src/services/comissao.js';

test('calcula percentual simples', () => {
  assert.equal(calcularComissao(45.0, 50.0), 22.5);
  assert.equal(calcularComissao(70.0, 50.0), 35);
});

test('aceita strings vindas do NUMERIC do pg', () => {
  assert.equal(calcularComissao('33.33', '40.00'), 13.33);
});

test('arredonda a 2 casas', () => {
  assert.equal(calcularComissao(19.99, 33.0), 6.6);
});
