import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewTemplate } from '../../src/public/js/admin/templates.js';

test('previewTemplate troca {{var}} pelos valores', () => {
  assert.equal(
    previewTemplate('Olá {{nome}}, seu horário é {{hora}}.', { nome: 'Ana', hora: '14:00' }),
    'Olá Ana, seu horário é 14:00.',
  );
  assert.equal(previewTemplate('sem vars', {}), 'sem vars');
});
