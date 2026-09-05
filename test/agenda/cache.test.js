import test from 'node:test';
import assert from 'node:assert/strict';
import * as cache from '../../src/agenda/cache.js';

test.beforeEach(() => cache.limparTudo());

test('get devolve o valor setado', () => {
  const k = cache.chaveDisponibilidade(1, '2026-09-10', 2);
  cache.set(k, { a: 1 });
  assert.deepEqual(cache.get(k), { a: 1 });
});

test('get devolve undefined após o TTL', async () => {
  const k = cache.chaveDisponibilidade(1, '2026-09-10', 2);
  cache.set(k, 'x', 5);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(cache.get(k), undefined);
});

test('invalidarData remove só as chaves daquela data', () => {
  cache.set(cache.chaveDisponibilidade(1, '2026-09-10', 2), 'a');
  cache.set(cache.chaveDisponibilidade(1, '2026-09-11', 2), 'b');
  cache.invalidarData('2026-09-10');
  assert.equal(cache.get(cache.chaveDisponibilidade(1, '2026-09-10', 2)), undefined);
  assert.equal(cache.get(cache.chaveDisponibilidade(1, '2026-09-11', 2)), 'b');
});
