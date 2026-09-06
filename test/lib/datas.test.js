import test from 'node:test';
import assert from 'node:assert/strict';
import * as datas from '../../src/lib/datas.js';

test('inicio/fim do mês', () => {
  assert.equal(datas.inicioDoMes(2026, 9), '2026-09-01');
  assert.equal(datas.fimDoMes(2026, 9), '2026-09-30');
  assert.equal(datas.fimDoMes(2026, 2), '2026-02-28');
});

test('ehData', () => {
  assert.equal(datas.ehData('2026-09-10'), true);
  assert.equal(datas.ehData('2026-13-01'), false);
  assert.equal(datas.ehData('10/09/2026'), false);
});

test('hoje tem o formato certo', () => {
  assert.match(datas.hoje(), /^\d{4}-\d{2}-\d{2}$/);
});
