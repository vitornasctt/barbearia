// src/routes/auth.js
import express from 'express';
import { z } from 'zod';
import { rota } from '../http/async.js';
import { ErroHttp } from '../http/erros.js';
import { validarCorpo } from '../http/validar.js';
import { verificarSenha } from '../auth/senha.js';
import { limiteLogin, limiteLoginIp } from '../auth/rateLimit.js';
import { normalizarCelular } from '../lib/celular.js';
import * as usuarios from '../repos/usuarios.js';
import * as clientes from '../repos/clientes.js';
import * as logs from '../repos/logs.js';

export const auth = express.Router();
const DOZE_HORAS = 12 * 3600_000;

auth.post('/admin/login', limiteLoginIp, limiteLogin,
  validarCorpo(z.object({ email: z.string().email(), senha: z.string().min(1) })),
  rota(async (req, res, next) => {
    const u = await usuarios.porEmail(req.body.email);
    const ok = u && u.ativo && await verificarSenha(req.body.senha, u.senha_hash);
    if (!ok) {
      await logs.registrar({ quem_tipo: 'usuario', quem_id: u?.id ?? null, acao: 'login_falha', ip: req.ip });
      return next(new ErroHttp('CREDENCIAIS_INVALIDAS'));
    }
    await new Promise((ok, ko) => req.session.regenerate((e) => (e ? ko(e) : ok())));
    req.session.usuarioId = u.id;
    req.session.role = u.role;
    req.session.equipeExpiraEm = Date.now() + DOZE_HORAS;
    delete req.session.clienteId;
    await logs.registrar({ quem_tipo: 'usuario', quem_id: u.id, acao: 'login_ok', ip: req.ip });
    res.json({ usuario: { id: u.id, nome: u.nome, role: u.role } });
  }));

auth.post('/cliente/login', limiteLoginIp, limiteLogin,
  validarCorpo(z.object({ celular: z.string().min(1), senha: z.string().min(1) })),
  rota(async (req, res, next) => {
    let celular;
    try { celular = normalizarCelular(req.body.celular); }
    catch { return next(new ErroHttp('CREDENCIAIS_INVALIDAS')); }
    const c = await clientes.porCelular(celular);
    const ok = c && c.senha_hash && await verificarSenha(req.body.senha, c.senha_hash);
    if (!ok) {
      await logs.registrar({ quem_tipo: 'cliente', quem_id: c?.id ?? null, acao: 'login_falha', ip: req.ip });
      return next(new ErroHttp('CREDENCIAIS_INVALIDAS'));
    }
    req.session.clienteId = c.id;
    delete req.session.usuarioId;
    delete req.session.role;
    delete req.session.equipeExpiraEm;
    await logs.registrar({ quem_tipo: 'cliente', quem_id: c.id, acao: 'login_ok', ip: req.ip });
    res.json({ cliente: { id: c.id, nome: c.nome } });
  }));

auth.post('/logout', (req, res) => {
  req.session.destroy(() => res.status(204).end());
});
