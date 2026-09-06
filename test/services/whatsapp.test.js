// test/services/whatsapp.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { enviar } from '../../src/services/whatsapp.js';
import { config } from '../../src/config.js';

test('sem credencial => driver simulado', async () => {
  assert.equal(config.WHATSAPP_TOKEN, '');
  const r = await enviar({ id: 1, telefone_destino: '5528999990000', mensagem_final: 'oi' });
  assert.deepEqual(r, { status: 'simulado' });
});
