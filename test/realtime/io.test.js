// test/realtime/io.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as Client } from 'socket.io-client';
import { criarIo } from '../../src/realtime/io.js';
import { EVENTOS } from '../../src/realtime/emitir.js';

function esperar(socket, ev) {
  return new Promise((resolve) => socket.once(ev, resolve));
}

test('cliente entra na sala da data e recebe agenda_atualizada', async () => {
  const server = http.createServer();
  const io = criarIo(server, (req, res, next) => next()); // sem sessão
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;
  const cli = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => cli.on('connect', r));
  cli.emit('entrar_agenda', { data: '2026-09-10' });
  await new Promise((r) => setTimeout(r, 50));

  const recebido = esperar(cli, EVENTOS.AGENDA_ATUALIZADA);
  io.to('agenda:2026-09-10').emit(EVENTOS.AGENDA_ATUALIZADA, { data: '2026-09-10' });
  assert.deepEqual(await recebido, { data: '2026-09-10' });

  cli.close();
  io.close();
  await new Promise((r) => server.close(r));
});

test('socket sem sessão de equipe não entra em admin', async () => {
  const server = http.createServer();
  const io = criarIo(server, (req, res, next) => next());
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;
  const cli = Client(`http://localhost:${porta}`, { transports: ['websocket'] });
  await new Promise((r) => cli.on('connect', r));
  await new Promise((r) => setTimeout(r, 50));
  const sockets = await io.in('admin').fetchSockets();
  assert.equal(sockets.length, 0);
  cli.close(); io.close();
  await new Promise((r) => server.close(r));
});
