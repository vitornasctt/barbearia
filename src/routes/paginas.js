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
