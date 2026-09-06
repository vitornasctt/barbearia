import test from 'node:test';
import assert from 'node:assert/strict';
import { carregarConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  SESSION_SECRET: '0123456789abcdef0123',
  ADMIN_EMAIL: 'a@b.com',
  ADMIN_SENHA: 'segredo123',
};

test('aplica defaults quando opcionais faltam', () => {
  const c = carregarConfig(base);
  assert.equal(c.NODE_ENV, 'development');
  assert.equal(c.PORT, 3000);
  assert.equal(c.GOOGLE_MAPS_API_KEY, '');
});

test('coage PORT para número', () => {
  const c = carregarConfig({ ...base, PORT: '8080' });
  assert.equal(c.PORT, 8080);
});

test('lança erro citando o campo quando DATABASE_URL falta', () => {
  assert.throws(() => carregarConfig({ ...base, DATABASE_URL: undefined }), /DATABASE_URL/);
});

test('TEST_SCHEMA default é "test" e rejeita identificador inválido', () => {
  assert.equal(carregarConfig(base).TEST_SCHEMA, 'test');
  assert.throws(() => carregarConfig({ ...base, TEST_SCHEMA: 'no-hyphens' }), /TEST_SCHEMA/);
});
