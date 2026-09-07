// test/public/agendar-calendario.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarCalendario } from '../../src/public/js/agendar.js';

test('montarCalendario alinha o 1º dia na semana e marca os livres', () => {
  // setembro/2026: 1º é uma terça-feira (getUTCDay === 2)
  const grade = montarCalendario(2026, 9, ['2026-09-10', '2026-09-11']);
  assert.equal(grade[0], null);
  assert.equal(grade[1], null);
  assert.deepEqual(grade[2], { dia: 1, data: '2026-09-01', livre: false });
  const dez = grade.find((c) => c && c.dia === 10);
  assert.equal(dez.livre, true);
  assert.equal(grade.filter((c) => c && c.livre).length, 2);
});
