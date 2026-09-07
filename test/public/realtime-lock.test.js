import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restanteDoLock } from '../../src/public/js/realtime.js';
import { formatarMMSS } from '../../src/public/js/comum.js';

test('restanteDoLock devolve segundos restantes e nunca negativo', () => {
  const base = Date.parse('2026-09-07T12:00:00.000Z');
  assert.equal(restanteDoLock('2026-09-07T12:05:00.000Z', base), 300);
  assert.equal(restanteDoLock('2026-09-07T11:59:00.000Z', base), 0);
});

test('formatarMMSS formata com zero à esquerda', () => {
  assert.equal(formatarMMSS(300), '05:00');
  assert.equal(formatarMMSS(9), '00:09');
  assert.equal(formatarMMSS(0), '00:00');
});
