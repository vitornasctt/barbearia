// src/public/js/admin/login.js
import { pedirJson } from '../comum.js';

function adminLogin() {
  return {
    email: '', senha: '', erro: '',
    async entrar() {
      this.erro = '';
      const { ok, status, corpo } = await pedirJson('/api/auth/admin/login', {
        method: 'POST', body: JSON.stringify({ email: this.email, senha: this.senha }),
      });
      if (!ok) {
        this.erro = status === 429 ? 'Muitas tentativas, aguarde.' : 'E-mail ou senha inválidos.';
        return;
      }
      const next = new URLSearchParams(location.search).get('next');
      location.href = next && next.startsWith('/admin') ? next : '/admin';
    },
  };
}

if (typeof window !== 'undefined') {
  window.adminLogin = adminLogin;
  document.addEventListener('alpine:init', () => window.Alpine.data('adminLogin', adminLogin));
}
