import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { carregarConfig } from '../../src/config.js';

// SCHEMA_KEYS deve espelhar o objeto zod de src/config.js
const SCHEMA_KEYS = [
  'NODE_ENV', 'PORT', 'TZ', 'DATABASE_URL', 'TEST_SCHEMA', 'SESSION_SECRET',
  'APP_URL', 'ADMIN_EMAIL', 'ADMIN_SENHA', 'GOOGLE_MAPS_API_KEY',
  'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_TOKEN', 'WHATSAPP_VERIFY_TOKEN',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_VERIFY_SERVICE_SID',
  'ORIGENS_PERMITIDAS', 'COOKIE_SECURE', 'WHATSAPP_APP_SECRET', 'LOG_LEVEL',
];

function parseEnvFile(p) {
  const out = {};
  for (const linha of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = linha.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}

test('todo campo do schema está documentado num dos exemplos', () => {
  const doc = { ...parseEnvFile('.env.example'), ...parseEnvFile('.env.test.example') };
  const faltando = SCHEMA_KEYS.filter((k) => !(k in doc));
  assert.deepEqual(faltando, [], `chaves não documentadas: ${faltando}`);
});

test('um env montado dos exemplos passa em carregarConfig', () => {
  const env = { ...parseEnvFile('.env.example'), ...parseEnvFile('.env.test.example') };
  // placeholders → valores plausíveis mínimos
  env.DATABASE_URL = env.DATABASE_URL?.startsWith('postgres')
    ? 'postgres://u:p@localhost:5432/db' : env.DATABASE_URL || 'postgres://u:p@localhost:5432/db';
  env.SESSION_SECRET = 'x'.repeat(64);
  env.ADMIN_SENHA = 'trocar-1234';
  assert.doesNotThrow(() => carregarConfig(env));
});
