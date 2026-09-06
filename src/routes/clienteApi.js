// src/routes/clienteApi.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo, validarQuery } from '../http/validar.js';
import { query } from '../db/pool.js';
import { ehData } from '../lib/datas.js';
import * as agendamentos from '../repos/agendamentos.js';
import { cancelarAgendamento, remarcarAgendamento } from '../agenda/agendar.js';
import { emitirAgendaAtualizada, emitirAgendamentoAtualizado, emitirDashboardTick } from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';

export const clienteApi = express.Router();

async function meuAgendamento(id, clienteId) {
  const item = await agendamentos.porId(id);
  if (!item || item.cliente.id !== clienteId) return null;
  return item;
}

async function antecedenciaHoras() {
  const r = await query(`SELECT antecedencia_min_horas FROM configuracao WHERE id=1`);
  return r.rows[0].antecedencia_min_horas;
}

clienteApi.get('/me', rota(async (req, res) => {
  const r = await query(
    `SELECT id, nome, celular, email, celular_verificado FROM clientes WHERE id=$1`,
    [req.session.clienteId]);
  res.json({ cliente: r.rows[0] });
}));

clienteApi.get('/agendamentos',
  validarQuery(z.object({ quando: z.enum(['futuros', 'historico']).default('futuros') })),
  rota(async (req, res) => {
    res.json({ agendamentos: await agendamentos.doCliente(req.session.clienteId, req.query.quando) });
  }));

clienteApi.post('/agendamentos/:id/cancelar',
  validarCorpo(z.object({ motivo: z.string().max(500).optional() })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const item = await meuAgendamento(id, req.session.clienteId);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    const dataISO = item.data_agendamento instanceof Date
      ? item.data_agendamento.toISOString().slice(0, 10)
      : item.data_agendamento;
    const quando = new Date(`${dataISO}T${item.horario_inicio}:00`);
    if ((quando - Date.now()) / 3600_000 <= await antecedenciaHoras()) {
      return next(new ErroHttp('FORA_DO_PRAZO'));
    }
    const r = await cancelarAgendamento(id, { motivo: req.body.motivo ?? null });
    if (!r.ok) return next(new ErroHttp(r.erro));
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirAgendamentoAtualizado(req.io, { id, status: 'cancelado' });
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    cache.invalidarData(item.data_agendamento);
    res.json({ agendamento: await agendamentos.porId(id) });
  }));

clienteApi.post('/agendamentos/:id/remarcar',
  validarCorpo(z.object({
    nova_data: z.string().refine(ehData, 'data inválida'),
    novo_horario: z.string().regex(/^\d{2}:\d{2}$/),
  })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const item = await meuAgendamento(id, req.session.clienteId);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    const r = await remarcarAgendamento(id, { novaData: req.body.nova_data, novoHorario: req.body.novo_horario });
    if (!r.ok) return next(new ErroHttp(r.erro));
    for (const d of new Set([item.data_agendamento, req.body.nova_data])) {
      emitirAgendaAtualizada(req.io, { data: d });
      cache.invalidarData(d);
    }
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    res.json({ agendamento: await agendamentos.porId(r.agendamento.id) });
  }));
