// src/server.js
import http from 'node:http';
import cron from 'node-cron';
import { config } from './config.js';
import { buildApp } from './app.js';
import { criarSessaoMiddleware } from './auth/sessao.js';
import { criarIo } from './realtime/io.js';
import { emitirHorarioLiberado } from './realtime/emitir.js';
import { limparExpirados } from './agenda/locks.js';
import { processarPendentes } from './services/mensageiro.js';
import { fecharPool } from './db/pool.js';
import * as cache from './agenda/cache.js';

export function criarServidor() {
  const sessaoMw = criarSessaoMiddleware();
  const server = http.createServer();
  const io = criarIo(server, sessaoMw);
  const app = buildApp({ io });
  server.on('request', app);

  const jobLocks = cron.schedule('* * * * *', async () => {
    try {
      const { itens } = await limparExpirados();
      for (const it of itens) {
        emitirHorarioLiberado(io, { data: it.data, horario: it.horario });
        cache.invalidarData(it.data);
      }
    } catch (e) { console.error('cron limparExpirados', e); }
  });

  const jobMsgs = cron.schedule('* * * * *', async () => {
    try { await processarPendentes(); } catch (e) { console.error('cron mensageiro', e); }
  });

  async function parar() {
    jobLocks.stop();
    jobMsgs.stop();
    await new Promise((r) => io.close(r));
    await new Promise((r) => server.close(r));
    await fecharPool();
  }

  return { app, server, io, parar };
}

const ehEntrypoint = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (ehEntrypoint) {
  const { server, parar } = criarServidor();
  server.listen(config.PORT, () => console.log('barbearia ouvindo em', config.PORT));
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => parar().then(() => process.exit(0)));
  }
}
