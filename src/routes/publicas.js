// src/routes/publicas.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { validarQuery, validarCorpo } from '../http/validar.js';
import { query } from '../db/pool.js';
import { horariosDisponiveis } from '../agenda/disponibilidade.js';
import * as servicos from '../repos/servicos.js';
import { ehData, fimDoMes } from '../lib/datas.js';
import { criarLock, renovarLock, liberarLock } from '../agenda/locks.js';
import { ErroHttp } from '../http/erros.js';
import { emitirHorarioReservado, emitirHorarioLiberado } from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';
import { confirmarAgendamento } from '../agenda/agendar.js';
import * as clientes from '../repos/clientes.js';
import * as agendamentos from '../repos/agendamentos.js';
import { hashSenha } from '../auth/senha.js';
import { normalizarCelular } from '../lib/celular.js';
import { requireCliente } from '../auth/middleware.js';
import { emitirAgendaAtualizada, emitirNovoAgendamento, emitirDashboardTick } from '../realtime/emitir.js';
import { processarPendentes } from '../services/mensageiro.js';

const LOCK_TTL_MS = 5 * 60 * 1000;

export const publicas = express.Router();

async function barbeiroPadrao() {
  const r = await query(`SELECT barbeiro_padrao_id AS id FROM configuracao WHERE id=1`);
  return r.rows[0]?.id ?? null;
}

const MAIUSC = (s) => (s ? s.toUpperCase() : null);

publicas.get('/servicos', rota(async (req, res) => {
  res.json({ servicos: await servicos.ativos() });
}));

publicas.get('/horarios',
  validarQuery(z.object({
    data: z.string().refine(ehData, 'data inválida'),
    servico_id: z.coerce.number().int().positive(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const barbeiroId = req.query.barbeiro_id ?? await barbeiroPadrao();
    const r = await horariosDisponiveis({
      barbeiroId, data: req.query.data, servicoId: req.query.servico_id, sessionId: req.sessionId,
    });
    res.json({ horarios: r.disponivel, fechado: MAIUSC(r.fechado) });
  }));

publicas.get('/dias',
  validarQuery(z.object({
    ano: z.coerce.number().int(),
    mes: z.coerce.number().int().min(1).max(12),
    servico_id: z.coerce.number().int().positive(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const { ano, mes } = req.query;
    const barbeiroId = req.query.barbeiro_id ?? await barbeiroPadrao();
    const ultimo = Number(fimDoMes(ano, mes).slice(-2));
    const dias = [];
    let fechado = null;
    for (let d = 1; d <= ultimo; d++) {
      const data = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const r = await horariosDisponiveis({ barbeiroId, data, servicoId: req.query.servico_id, sessionId: req.sessionId });
      if (r.fechado === 'mes_fechado') { fechado = 'MES_FECHADO'; break; }
      if (r.disponivel.length > 0) dias.push(data);
    }
    res.json({ dias, fechado });
  }));

const corpoLock = z.object({
  data: z.string().refine(ehData, 'data inválida'),
  horario: z.string().regex(/^\d{2}:\d{2}$/),
  servico_id: z.coerce.number().int().positive(),
  barbeiro_id: z.coerce.number().int().positive().optional(),
});

// A sessão anônima só ganha cookie (e portanto identidade estável entre requests)
// quando algo é gravado nela — saveUninitialized:false. Os locks dependem disso.
function fixarSessao(req) {
  if (req.session && !req.session.anon) req.session.anon = true;
}

publicas.post('/lock', validarCorpo(corpoLock), rota(async (req, res, next) => {
  const { data, horario } = req.body;
  fixarSessao(req);
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  const r = await criarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  if (!r.ok) return next(new ErroHttp(r.erro));
  const expira_em = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  emitirHorarioReservado(req.io, { data, horario });
  cache.invalidarData(data);
  res.json({ ok: true, expira_em });
}));

publicas.post('/lock/renovar', validarCorpo(corpoLock), rota(async (req, res, next) => {
  const { data, horario } = req.body;
  fixarSessao(req);
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  const r = await renovarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  if (!r.ok) return next(new ErroHttp('LOCK_EXPIRADO'));
  const expira_em = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  res.json({ ok: true, expira_em });
}));

publicas.post('/lock/liberar', validarCorpo(corpoLock), rota(async (req, res) => {
  const { data, horario } = req.body;
  fixarSessao(req);
  const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
  await liberarLock({ barbeiroId, data, horario, sessionId: req.sessionId });
  emitirHorarioLiberado(req.io, { data, horario });
  cache.invalidarData(data);
  res.json({ ok: true });
}));

publicas.post('/cadastro',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100),
    celular: z.string().min(1),
    email: z.string().email().optional(),
    senha: z.string().min(6).optional(),
    consentimento: z.literal(true),
  })),
  rota(async (req, res, next) => {
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'celular', mensagem: 'inválido' }]; return next(e); }
    if (req.body.senha && !req.body.email) {
      const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'email', mensagem: 'obrigatório com senha' }]; return next(e);
    }
    const existente = await clientes.porCelular(celular);
    if (existente?.senha_hash) return next(new ErroHttp('CELULAR_EM_USO'));
    const cliente = existente ?? await clientes.criar({
      nome: req.body.nome, celular,
      email: req.body.email ?? null,
      senha_hash: req.body.senha ? await hashSenha(req.body.senha) : null,
    });
    req.session.clienteId = cliente.id;
    delete req.session.usuarioId;
    res.status(201).json({ cliente: { id: cliente.id, nome: cliente.nome } });
  }));

publicas.post('/confirmar', requireCliente,
  validarCorpo(z.object({
    servico_id: z.coerce.number().int().positive(),
    data: z.string().refine(ehData, 'data inválida'),
    horario: z.string().regex(/^\d{2}:\d{2}$/),
    observacoes: z.string().max(1000).optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res, next) => {
    const barbeiroId = req.body.barbeiro_id ?? await barbeiroPadrao();
    const r = await confirmarAgendamento({
      clienteId: req.session.clienteId,
      servicoId: req.body.servico_id,
      barbeiroId,
      data: req.body.data,
      horario: req.body.horario,
      sessionId: req.sessionId,
      observacoes: req.body.observacoes ?? null,
    });
    if (!r.ok) return next(new ErroHttp(r.erro));
    const item = await agendamentos.porId(r.agendamento.id);
    emitirAgendaAtualizada(req.io, { data: item.data_agendamento });
    emitirNovoAgendamento(req.io, {
      id: item.id, cliente: item.cliente.nome, servico: item.servico.nome,
      data: item.data_agendamento, horario: item.horario_inicio, status: item.status,
    });
    emitirDashboardTick(req.io, (await agendamentos.dashboard()).contadores);
    cache.invalidarData(req.body.data);
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker de mensagens'));
    res.status(201).json({ agendamento: item });
  }));
