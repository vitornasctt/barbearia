import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

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
