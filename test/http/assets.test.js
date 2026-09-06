import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../../src/app.js';

test('serve o CSS estático de src/public', async () => {
  const res = await request(buildApp()).get('/css/app.css');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/css/);
});

test('serve o favicon', async () => {
  const res = await request(buildApp()).get('/img/favicon.svg');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /svg/);
});
