// src/public/js/realtime.js
export function restanteDoLock(expiraEmISO, agoraMs = Date.now()) {
  const alvo = Date.parse(expiraEmISO);
  if (Number.isNaN(alvo)) return 0;
  return Math.max(0, Math.round((alvo - agoraMs) / 1000));
}

export function conectarAgenda(data, handlers = {}) {
  const socket = window.io('/', { transports: ['websocket', 'polling'] });
  let atual = data;
  const entrar = (d) => socket.emit('entrar_agenda', { data: d });
  socket.on('connect', () => entrar(atual));
  for (const [evento, fn] of Object.entries(handlers)) socket.on(evento, fn);
  return {
    sair() { socket.close(); },
    trocarData(novaData) { atual = novaData; entrar(novaData); },
  };
}
