// test/auth/senha.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSenha, verificarSenha } from '../../src/auth/senha.js';

test('hash e verificação batem; senha errada não', async () => {
  const h = await hashSenha('segredo123');
  assert.match(h, /^\$2[aby]\$12\$/);
  assert.equal(await verificarSenha('segredo123', h), true);
  assert.equal(await verificarSenha('outra', h), false);
});
