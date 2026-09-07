import request from 'supertest';
import { buildApp } from '../../src/app.js';

// e-mail/senha do admin semeado — confira src/db/seed.js / .env.test
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'dono@teste.local';
export const ADMIN_SENHA = process.env.ADMIN_SENHA || 'teste123456';

export async function logarEquipe(app = buildApp()) {
  const agente = request.agent(app);
  const res = await agente.post('/api/auth/admin/login')
    .set('Origin', 'http://localhost:3000')
    .send({ email: ADMIN_EMAIL, senha: ADMIN_SENHA });
  if (res.status !== 200) throw new Error('login de equipe falhou no helper: ' + res.status + ' ' + JSON.stringify(res.body));
  return agente;
}
