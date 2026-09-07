import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderizarTemplate } from '../../src/lib/template.js';
import { TEMPLATES } from '../../src/db/seed.js';

const CONHECIDAS = new Set(['nome_cliente', 'nome_servico', 'data', 'horario', 'endereco_barbearia', 'nome_barbearia', 'codigo']);
const VARS = { nome_cliente: 'Ana', nome_servico: 'Corte', data: '10/09', horario: '14:00', endereco_barbearia: 'Rua X, 1', nome_barbearia: 'Barbearia', codigo: '123456' };

for (const [chave, , corpo] of TEMPLATES) {
  test(`${chave}: só usa variáveis conhecidas`, () => {
    const usadas = [...corpo.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]);
    for (const u of usadas) assert.ok(CONHECIDAS.has(u), `variável desconhecida: ${u}`);
  });
  test(`${chave}: renderiza sem {{ sobrando`, () => {
    const out = renderizarTemplate(corpo, VARS);
    assert.doesNotMatch(out, /\{\{/);
  });
}
