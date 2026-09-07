// src/routes/adminPaginas.js
import express from 'express';
import { renderAdmin } from '../http/render.js';
import { paginaEquipe, equipeValida } from '../auth/middleware.js';

export const adminPaginas = express.Router();

adminPaginas.get('/login', (req, res) => {
  if (equipeValida(req.session)) return res.redirect(302, '/admin');
  renderAdmin(res, 'login', { telaAtiva: null, semChrome: true, titulo: 'Entrar' });
});

adminPaginas.get('/', paginaEquipe, (req, res) => {
  renderAdmin(res, 'dashboard', { telaAtiva: 'dashboard', titulo: 'Dashboard', modulo: 'dashboard' });
});

const telas = [
  ['agendamentos', 'Agendamentos'],
  ['meses', 'Agenda / Meses'],
  ['bloqueios', 'Bloqueios'],
  ['servicos', 'Serviços'],
  ['clientes', 'Clientes'],
];
for (const [slug, titulo] of telas) {
  adminPaginas.get('/' + slug, paginaEquipe, (req, res) => {
    renderAdmin(res, slug, { telaAtiva: slug, titulo, modulo: slug });
  });
}
