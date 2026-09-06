// src/routes/adminApi.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo, validarQuery } from '../http/validar.js';
import { query } from '../db/pool.js';
import { ehData } from '../lib/datas.js';
import { normalizarCelular } from '../lib/celular.js';
import { renderizarTemplate } from '../lib/template.js';
import * as agendamentos from '../repos/agendamentos.js';
import * as clientes from '../repos/clientes.js';
import * as templates from '../repos/templates.js';
import * as mensagens from '../repos/mensagens.js';
import { confirmarAgendamento, cancelarAgendamento } from '../agenda/agendar.js';
import { processarPendentes } from '../services/mensageiro.js';
import {
  emitirAgendaAtualizada, emitirNovoAgendamento, emitirAgendamentoAtualizado, emitirDashboardTick,
} from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';

export const adminApi = express.Router();

async function barbeiroPadrao() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0]?.id ?? null;
}

async function tick(req) {
  emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
}

async function enfileirarTemplate(item, chave) {
  const tpl = await templates.porChave(chave);
  if (!tpl?.ativo) return;
  const cfg = await query(`SELECT nome_barbearia, endereco FROM configuracao WHERE id=1`);
  const texto = renderizarTemplate(tpl.corpo, {
    nome_cliente: item.cliente.nome,
    nome_servico: item.servico.nome,
    data: item.data_agendamento,
    horario: item.horario_inicio,
    endereco_barbearia: cfg.rows[0].endereco ?? '',
    nome_barbearia: cfg.rows[0].nome_barbearia,
  });
  await mensagens.enfileirar({
    agendamento_id: item.id, template_chave: chave,
    telefone_destino: item.cliente.celular, mensagem_final: texto,
  });
}

adminApi.get('/dashboard', rota(async (req, res) => {
  res.json(await agendamentos.dashboard());
}));

adminApi.get('/agendamentos',
  validarQuery(z.object({
    data: z.string().optional(), de: z.string().optional(), ate: z.string().optional(),
    status: z.enum(['pendente', 'confirmado', 'concluido', 'cancelado']).optional(),
    cliente: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  })),
  rota(async (req, res) => {
    const { data, de, ate, status, cliente, page } = req.query;
    res.json(await agendamentos.listar({ de: data ?? de, ate: data ?? ate, status, cliente, page }));
  }));

adminApi.patch('/agendamentos/:id/status',
  validarCorpo(z.object({
    status: z.enum(['confirmado', 'concluido', 'cancelado']),
    motivo: z.string().max(500).optional(),
  })),
  rota(async (req, res, next) => {
    const id = Number(req.params.id);
    const { status, motivo } = req.body;
    let item = null;
    if (status === 'confirmado') item = await agendamentos.confirmarStatus(id);
    else if (status === 'concluido') {
      item = await agendamentos.concluir(id);
      if (item) { await enfileirarTemplate(item, 'pos_atendimento'); }
    } else {
      const r = await cancelarAgendamento(id, { motivo: motivo ?? null });
      if (!r.ok) return next(new ErroHttp(r.erro));
      item = await agendamentos.porId(id);
    }
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    emitirAgendamentoAtualizado(req.io, { id, status: item.status });
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    await tick(req);
    cache.invalidarData(item.data_agendamento);
    if (status === 'concluido') {
      await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    }
    res.json({ agendamento: item });
  }));

adminApi.post('/agendamentos',
  validarCorpo(z.object({
    cliente_id: z.coerce.number().int().positive().optional(),
    cliente: z.object({ nome: z.string().min(1), celular: z.string().min(1) }).optional(),
    servico_id: z.coerce.number().int().positive(),
    data: z.string().refine(ehData, 'data inválida'),
    horario: z.string().regex(/^\d{2}:\d{2}$/),
    barbeiro_id: z.coerce.number().int().positive().optional(),
    observacoes: z.string().max(1000).optional(),
  }).refine((v) => v.cliente_id || v.cliente, { message: 'informe cliente_id ou cliente', path: ['cliente'] })),
  rota(async (req, res, next) => {
    let clienteId = req.body.cliente_id;
    if (!clienteId) {
      const cel = normalizarCelular(req.body.cliente.celular);
      const existente = await clientes.porCelular(cel);
      clienteId = existente?.id ?? (await clientes.criar({ nome: req.body.cliente.nome, celular: cel })).id;
    }
    const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
    const r = await confirmarAgendamento({
      clienteId, servicoId: req.body.servico_id, barbeiroId,
      data: req.body.data, horario: req.body.horario,
      sessionId: `admin:${req.session.usuarioId}`, observacoes: req.body.observacoes ?? null,
    });
    if (!r.ok) return next(new ErroHttp(r.erro));
    const item = await agendamentos.porId(r.agendamento.id);
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirNovoAgendamento(req.io, {
      id: item.id, cliente: item.cliente.nome, servico: item.servico.nome,
      data: item.data_agendamento, horario: item.horario_inicio, status: item.status,
    });
    await tick(req);
    cache.invalidarData(req.body.data);
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    res.status(201).json({ agendamento: item });
  }));
