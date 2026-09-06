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
import * as servicos from '../repos/servicos.js';
import { requireAdmin } from '../auth/middleware.js';
import * as templates from '../repos/templates.js';
import * as mensagens from '../repos/mensagens.js';
import * as comissoes from '../repos/comissoes.js';
import * as configuracao from '../repos/configuracao.js';
import { limiteMensagens } from '../auth/rateLimit.js';
import { confirmarAgendamento, cancelarAgendamento } from '../agenda/agendar.js';
import { processarPendentes } from '../services/mensageiro.js';
import {
  emitirAgendaAtualizada, emitirNovoAgendamento, emitirAgendamentoAtualizado, emitirDashboardTick,
} from '../realtime/emitir.js';
import * as cache from '../agenda/cache.js';
import * as meses from '../repos/disponibilidadeMeses.js';
import * as bloqueios from '../repos/bloqueios.js';

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
    data: z.string().refine(ehData, 'data inválida').optional(),
    de: z.string().refine(ehData, 'data inválida').optional(),
    ate: z.string().refine(ehData, 'data inválida').optional(),
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
      let cel;
      try { cel = normalizarCelular(req.body.cliente.celular); }
      catch { const e = new ErroHttp('VALIDACAO'); e.campos = [{ caminho: 'cliente.celular', mensagem: 'inválido' }]; return next(e); }
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

adminApi.get('/disponibilidade',
  validarQuery(z.object({ ano: z.coerce.number().int(), barbeiro_id: z.coerce.number().int().positive().optional() })),
  rota(async (req, res) => {
    res.json({ meses: await meses.doAno(req.query.ano, req.query.barbeiro_id ?? null) });
  }));

adminApi.post('/disponibilidade',
  validarCorpo(z.object({
    ano: z.coerce.number().int(),
    mes: z.coerce.number().int().min(1).max(12),
    status: z.enum(['aberto', 'fechado']),
    limite_por_dia: z.coerce.number().int().nonnegative().nullable().optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const m = await meses.definir({
      ano: req.body.ano, mes: req.body.mes, status: req.body.status,
      limite_por_dia: req.body.limite_por_dia ?? null,
      barbeiro_id: req.body.barbeiro_id ?? null,
    });
    cache.limparTudo();
    res.json({ mes: m });
  }));

adminApi.get('/bloqueios',
  validarQuery(z.object({ de: z.string(), ate: z.string(), barbeiro_id: z.coerce.number().int().positive().optional() })),
  rota(async (req, res) => {
    res.json({ bloqueios: await bloqueios.entre(req.query.de, req.query.ate, req.query.barbeiro_id ?? null) });
  }));

adminApi.post('/bloqueios',
  validarCorpo(z.object({
    data: z.string().refine(ehData, 'data inválida'),
    dia_inteiro: z.boolean().default(false),
    hora_inicio: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    hora_fim: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    motivo: z.string().max(200).optional(),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    const b = await bloqueios.criar({
      data: req.body.data,
      hora_inicio: req.body.dia_inteiro ? null : (req.body.hora_inicio ?? null),
      hora_fim: req.body.dia_inteiro ? null : (req.body.hora_fim ?? null),
      motivo: req.body.motivo ?? null,
      barbeiro_id: req.body.barbeiro_id ?? null,
      criado_por: req.session.usuarioId,
    });
    cache.limparTudo();
    res.status(201).json({ bloqueio: b });
  }));

adminApi.delete('/bloqueios/:id', rota(async (req, res, next) => {
  const ok = await bloqueios.remover(Number(req.params.id));
  if (!ok) return next(new ErroHttp('NAO_ENCONTRADO'));
  cache.limparTudo();
  res.status(204).end();
}));

adminApi.get('/servicos', rota(async (req, res) => {
  res.json({ servicos: await servicos.todos() });
}));

adminApi.post('/servicos',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100),
    duracao_minutos: z.coerce.number().int().positive(),
    preco: z.coerce.number().nonnegative(),
    comissao_percentual: z.coerce.number().min(0).max(100),
  })),
  rota(async (req, res) => {
    res.status(201).json({ servico: await servicos.criar(req.body) });
  }));

adminApi.patch('/servicos/:id',
  validarCorpo(z.object({
    nome: z.string().min(1).max(100).optional(),
    duracao_minutos: z.coerce.number().int().positive().optional(),
    preco: z.coerce.number().nonnegative().optional(),
    comissao_percentual: z.coerce.number().min(0).max(100).optional(),
    ativo: z.boolean().optional(),
  })),
  rota(async (req, res, next) => {
    const s = await servicos.atualizar(Number(req.params.id), req.body);
    if (!s) return next(new ErroHttp('NAO_ENCONTRADO'));
    res.json({ servico: s });
  }));

adminApi.delete('/servicos/:id', rota(async (req, res, next) => {
  const s = await servicos.porId(Number(req.params.id));
  if (!s) return next(new ErroHttp('NAO_ENCONTRADO'));
  const modo = await servicos.remover(Number(req.params.id));
  res.json({ modo });
}));

adminApi.get('/clientes',
  validarQuery(z.object({ busca: z.string().optional(), page: z.coerce.number().int().positive().default(1) })),
  rota(async (req, res) => {
    const { busca, page } = req.query;
    const params = [];
    let where = '';
    if (busca) { params.push(`%${busca}%`); where = `WHERE nome ILIKE $1 OR celular LIKE $1`; }
    const tot = await query(`SELECT count(*)::int AS n FROM clientes ${where}`, params);
    params.push(20, (page - 1) * 20);
    const r = await query(
      `SELECT id, nome, celular, email, ultimo_agendamento FROM clientes ${where}
       ORDER BY nome LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ itens: r.rows, total: tot.rows[0].n, page });
  }));

adminApi.get('/clientes/:id', rota(async (req, res, next) => {
  const r = await query(
    `SELECT id, nome, celular, email, celular_verificado, created_at, ultimo_agendamento
     FROM clientes WHERE id=$1`, [Number(req.params.id)]);
  if (r.rowCount === 0) return next(new ErroHttp('NAO_ENCONTRADO'));
  const cliente = r.rows[0];
  const ags = await agendamentos.listar({ cliente: cliente.celular, page: 1 });
  res.json({ cliente, agendamentos: ags });
}));

adminApi.post('/clientes/:id/anonimizar', requireAdmin, rota(async (req, res, next) => {
  const r = await query(
    `UPDATE clientes
     SET nome='removido', email=NULL, senha_hash=NULL,
         celular = 'ANON-' || id || '-' || substr(md5(random()::text), 1, 8)
     WHERE id=$1 RETURNING id`, [Number(req.params.id)]);
  if (r.rowCount === 0) return next(new ErroHttp('NAO_ENCONTRADO'));
  res.json({ ok: true });
}));

adminApi.get('/comissoes',
  validarQuery(z.object({
    ano: z.coerce.number().int(), mes: z.coerce.number().int().min(1).max(12),
    barbeiro_id: z.coerce.number().int().positive().optional(),
  })),
  rota(async (req, res) => {
    res.json(await comissoes.relatorio({ ano: req.query.ano, mes: req.query.mes, barbeiroId: req.query.barbeiro_id ?? null }));
  }));

adminApi.get('/configuracao', rota(async (req, res) => {
  res.json(await configuracao.obter());
}));

adminApi.put('/configuracao', requireAdmin,
  validarCorpo(z.object({
    nome_barbearia: z.string().max(120).optional(),
    endereco: z.string().optional(),
    latitude: z.coerce.number().nullable().optional(),
    longitude: z.coerce.number().nullable().optional(),
    telefone_whatsapp: z.string().max(20).optional(),
    intervalo_minutos: z.coerce.number().int().positive().optional(),
    antecedencia_min_horas: z.coerce.number().int().nonnegative().optional(),
    limite_dias_futuros: z.coerce.number().int().positive().optional(),
    expediente: z.array(z.object({
      dia_semana: z.number().int().min(0).max(6),
      aberto: z.boolean(),
      abre: z.string(),
      fecha: z.string(),
    })).length(7).optional(),
  })),
  rota(async (req, res) => {
    const { expediente, ...campos } = req.body;
    const nova = await configuracao.atualizar(campos, expediente);
    cache.limparTudo();
    res.json(nova);
  }));

adminApi.get('/templates', rota(async (req, res) => {
  res.json({ templates: await templates.todos() });
}));

adminApi.put('/templates/:chave',
  validarCorpo(z.object({ titulo: z.string().min(1).max(100), corpo: z.string().min(1), ativo: z.boolean() })),
  rota(async (req, res, next) => {
    const t = await templates.atualizar(req.params.chave, req.body);
    if (!t) return next(new ErroHttp('NAO_ENCONTRADO'));
    res.json({ template: t });
  }));

adminApi.get('/mensagens',
  validarQuery(z.object({
    agendamento_id: z.coerce.number().int().positive().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().positive().default(1),
  })),
  rota(async (req, res) => {
    res.json(await mensagens.listar(req.query));
  }));

adminApi.post('/mensagens/enviar', limiteMensagens,
  validarCorpo(z.object({
    agendamento_id: z.coerce.number().int().positive(),
    template_chave: z.string().min(1),
  })),
  rota(async (req, res, next) => {
    const item = await agendamentos.porId(req.body.agendamento_id);
    if (!item) return next(new ErroHttp('NAO_ENCONTRADO'));
    const tpl = await templates.porChave(req.body.template_chave);
    if (!tpl) return next(new ErroHttp('NAO_ENCONTRADO'));
    if (!tpl.ativo) return next(new ErroHttp('TEMPLATE_INATIVO'));
    await enfileirarTemplate(item, req.body.template_chave);
    await processarPendentes({ limite: 5 }).catch((e) => req.log?.error({ e }, 'worker'));
    const lst = await mensagens.listar({ agendamento_id: item.id, page: 1 });
    res.status(202).json({ mensagem: lst.itens[0] });
  }));
