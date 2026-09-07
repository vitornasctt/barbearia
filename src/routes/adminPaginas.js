// src/routes/adminPaginas.js
import express from 'express';
import { renderAdmin } from '../http/render.js';
import { paginaEquipe, equipeValida } from '../auth/middleware.js';

export const adminPaginas = express.Router();

adminPaginas.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

adminPaginas.get('/login', (req, res) => {
  if (equipeValida(req.session)) return res.redirect(302, '/admin');
  renderAdmin(res, 'login', { telaAtiva: null, semChrome: true, titulo: 'Entrar', modulo: 'login' });
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
  ['comissoes', 'Comissões'],
  ['configuracao', 'Configuração'],
  ['templates', 'Templates'],
  ['mensagens', 'Mensagens'],
];
for (const [slug, titulo] of telas) {
  adminPaginas.get('/' + slug, paginaEquipe, (req, res) => {
    renderAdmin(res, slug, { telaAtiva: slug, titulo, modulo: slug });
  });
}
