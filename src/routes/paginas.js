// src/routes/paginas.js
import express from 'express';
import { rota } from '../http/async.js';
import { renderPagina } from '../http/render.js';
import * as configuracaoRepo from '../repos/configuracao.js';
import * as servicos from '../repos/servicos.js';
import { dadosMapa } from '../services/mapa.js';

export const paginas = express.Router();

paginas.get('/', rota(async (req, res) => {
  const [configuracao, lista, mapa] = await Promise.all([
    configuracaoRepo.obter(), servicos.ativos(), dadosMapa(),
  ]);
  renderPagina(res, 'inicio', {
    titulo: configuracao.nome_barbearia, configuracao, servicos: lista, mapa,
  });
}));

paginas.get('/agendar', rota(async (req, res) => {
  const [configuracao, lista] = await Promise.all([
    configuracaoRepo.obter(), servicos.ativos(),
  ]);
  renderPagina(res, 'agendar', {
    titulo: 'Agendar — ' + configuracao.nome_barbearia,
    configuracao,
    dadosPagina: {
      servicos: lista,
      antecedenciaHoras: configuracao.antecedencia_min_horas,
      intervaloMin: configuracao.intervalo_minutos,
    },
  });
}));

paginas.get('/minha-conta', rota(async (req, res) => {
  const configuracao = await configuracaoRepo.obter();
  renderPagina(res, 'minha-conta', { titulo: 'Minha conta', configuracao, dadosPagina: {} });
}));

paginas.get('/privacidade', rota(async (req, res) => {
  const configuracao = await configuracaoRepo.obter();
  renderPagina(res, 'privacidade', { titulo: 'Privacidade', configuracao });
}));

// eslint-disable-next-line no-unused-vars
export function erroPagina(err, req, res, next) {
  if (req.log) req.log.error({ err }, 'erro em rota de página');
  else console.error('erro em rota de página', err);
  const status = Number.isInteger(err?.status) ? err.status : 500;
  res.status(status);
  renderPagina(res, 'erro', { titulo: 'Erro', status, configuracao: null });
}
