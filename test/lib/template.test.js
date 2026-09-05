// test/lib/template.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderizarTemplate } from '../../src/lib/template.js';

test('substitui variáveis presentes', () => {
  const out = renderizarTemplate('Olá, {{nome}}! Dia {{data}}.', { nome: 'Ana', data: '10/09' });
  assert.equal(out, 'Olá, Ana! Dia 10/09.');
});

test('aceita espaços dentro das chaves', () => {
  assert.equal(renderizarTemplate('{{ x }}', { x: 1 }), '1');
});

test('chave ausente vira string vazia', () => {
  assert.equal(renderizarTemplate('a{{b}}c', {}), 'ac');
});
