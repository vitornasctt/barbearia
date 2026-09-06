// src/routes/webhooks.js
import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { rota } from '../http/async.js';
import { query } from '../db/pool.js';
import { cancelarAgendamento } from '../agenda/agendar.js';
import { emitirAgendaAtualizada, emitirAgendamentoAtualizado, emitirDashboardTick } from '../realtime/emitir.js';
import * as agendamentos from '../repos/agendamentos.js';
import * as cache from '../agenda/cache.js';

export const webhooks = express.Router();

webhooks.get('/whatsapp', (req, res) => {
  if (!config.WHATSAPP_VERIFY_TOKEN) return res.sendStatus(404);
  if (req.query['hub.mode'] === 'subscribe'
    && req.query['hub.verify_token'] === config.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

webhooks.post('/whatsapp', express.raw({ type: '*/*', limit: '1mb' }), rota(async (req, res) => {
  if (!config.WHATSAPP_APP_SECRET) return res.sendStatus(404);
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const esperado = 'sha256=' + crypto.createHmac('sha256', config.WHATSAPP_APP_SECRET).update(raw).digest('hex');
  const recebido = req.get('x-hub-signature-256') || '';
  const a = Buffer.from(recebido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(403);
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(200); }

  const mudancas = payload.entry?.flatMap((e) => e.changes ?? []) ?? [];
  for (const ch of mudancas) {
    for (const m of ch.value?.messages ?? []) {
      const texto = m.text?.body?.trim().toUpperCase();
      if (!['SIM', 'NAO', 'NÃO'].includes(texto)) continue;
      const r = await query(
        `SELECT id, data_agendamento FROM agendamentos
         WHERE cliente_id = (SELECT id FROM clientes WHERE celular=$1)
           AND status IN ('pendente','confirmado')
         ORDER BY created_at DESC LIMIT 1`, [m.from]);
      const ag = r.rows[0];
      if (!ag) continue;
      // house pattern: data_agendamento vem como Date do SELECT cru; normaliza p/ YYYY-MM-DD
      const dataISO = ag.data_agendamento instanceof Date
        ? ag.data_agendamento.toISOString().slice(0, 10)
        : ag.data_agendamento;
      if (texto === 'SIM') {
        await query(`UPDATE agendamentos SET status='confirmado', updated_at=now() WHERE id=$1`, [ag.id]);
        emitirAgendamentoAtualizado(req.io, { id: ag.id, status: 'confirmado' });
      } else {
        await cancelarAgendamento(ag.id, { motivo: 'cancelado via WhatsApp' });
        emitirAgendamentoAtualizado(req.io, { id: ag.id, status: 'cancelado' });
      }
      emitirAgendaAtualizada(req.io, { data: dataISO });
      emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
      cache.invalidarData(dataISO);
    }
  }
  res.sendStatus(200);
}));
