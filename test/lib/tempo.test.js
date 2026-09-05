// test/lib/tempo.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { paraMinutos, paraHHMM, adicionarMinutos, sobrepoe } from '../../src/lib/tempo.js';

test('paraMinutos converte HH:MM em minutos desde meia-noite', () => {
  assert.equal(paraMinutos('00:00'), 0);
  assert.equal(paraMinutos('09:35'), 575);
  assert.equal(paraMinutos('19:30'), 1170);
});

test('paraHHMM converte minutos em HH:MM com zero à esquerda', () => {
  assert.equal(paraHHMM(0), '00:00');
  assert.equal(paraHHMM(575), '09:35');
  assert.equal(paraHHMM(1170), '19:30');
});

test('adicionarMinutos soma e reformata', () => {
  assert.equal(adicionarMinutos('09:00', 35), '09:35');
  assert.equal(adicionarMinutos('18:55', 50), '19:45');
});

test('sobrepoe é verdadeiro só quando os intervalos meio-abertos se cruzam', () => {
  assert.equal(sobrepoe('09:00', '09:35', '09:35', '10:10'), false); // encostam, não cruzam
  assert.equal(sobrepoe('09:00', '09:35', '09:20', '09:50'), true);
  assert.equal(sobrepoe('09:00', '09:50', '09:35', '10:10'), true);
  assert.equal(sobrepoe('10:00', '10:35', '09:00', '09:35'), false);
});
