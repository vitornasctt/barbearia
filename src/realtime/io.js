// src/realtime/io.js
import { Server } from 'socket.io';
import { ehData } from '../lib/datas.js';

let ioSingleton = null;

export function criarIo(httpServer, sessaoMw) {
  const io = new Server(httpServer, { transports: ['websocket', 'polling'] });
  io.engine.use(sessaoMw);

  io.on('connection', (socket) => {
    const s = socket.request.session;
    if (s?.usuarioId && (s.role === 'admin' || s.role === 'barbeiro')) socket.join('admin');

    const sairDaAgenda = () => {
      for (const sala of socket.rooms) if (sala.startsWith('agenda:')) socket.leave(sala);
    };
    socket.on('entrar_agenda', ({ data } = {}) => {
      if (!ehData(data)) return;
      sairDaAgenda();
      socket.join(`agenda:${data}`);
    });
    socket.on('sair_agenda', sairDaAgenda);
  });

  ioSingleton = io;
  return io;
}

export function getIo() {
  return ioSingleton;
}
