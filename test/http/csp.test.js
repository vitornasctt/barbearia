import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { prepararBanco } from '../helpers/db.js';

before(prepararBanco);
beforeEach(prepararBanco);

test('CSP presente e restritiva', async () => {
  const res = await request(buildApp()).get('/css/app.css');
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'header CSP ausente');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src [^;]*'self'/);
  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
  assert.match(csp, /frame-src [^;]*www\.google\.com/);
  assert.match(csp, /connect-src [^;]*'self'/);
});

test('CSP na resposta de PAGE (GET /) mantém as diretivas restritivas', async () => {
  const res = await request(buildApp()).get('/');
  const csp = res.headers['content-security-policy'];
  assert.ok(csp, 'header CSP ausente');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src [^;]*'self'/);
  assert.match(csp, /script-src [^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src [^;]*'unsafe-inline'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-src [^;]*www\.openstreetmap\.org/);
});
