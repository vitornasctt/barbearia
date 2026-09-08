// src/public/js/minha-conta.js
import { pedirJson, toast } from './comum.js';

export function areaCliente() {
  return {
    carregando: true,
    logado: false,
    aba: 'proximos',
    proximos: [],
    historico: [],
    login: { celular: '', senha: '' },
    semSenha: { nome: '', celular: '', consentimento: false },
    erro: '',
    remarcando: null,   // { id, ano, mes, grade, dia, horarios, horario }
    modoReset: false,
    passoReset: 1,
    reset: { celular: '', codigo: '', senha: '', senha2: '' },
    erroReset: '',

    async init() {
      const { ok } = await pedirJson('/api/cliente/me');
      this.logado = ok;
      this.carregando = false;
      if (ok) this.carregarListas();
    },

    async carregarListas() {
      const f = await pedirJson('/api/cliente/agendamentos?quando=futuros');
      const h = await pedirJson('/api/cliente/agendamentos?quando=historico');
      if (f.ok) this.proximos = f.corpo.agendamentos || f.corpo || [];
      if (h.ok) this.historico = h.corpo.agendamentos || h.corpo || [];
    },

    async entrar() {
      this.erro = '';
      const { ok, corpo } = await pedirJson('/api/auth/cliente/login', {
        method: 'POST', body: JSON.stringify(this.login),
      });
      if (!ok) { this.erro = corpo?.erro === 'MUITAS_TENTATIVAS' ? 'Muitas tentativas, aguarde.' : 'Celular ou senha inválidos.'; return; }
      this.logado = true; this.carregarListas();
    },

    async entrarSemSenha() {
      this.erro = '';
      if (!this.semSenha.consentimento) { this.erro = 'Aceite a política de privacidade.'; return; }
      const { ok } = await pedirJson('/api/agenda/cadastro', {
        method: 'POST', body: JSON.stringify({ ...this.semSenha, consentimento: true }),
      });
      if (!ok) { this.erro = 'Não foi possível entrar.'; return; }
      this.logado = true; this.carregarListas();
    },

    async cancelar(item) {
      const motivo = prompt('Motivo do cancelamento (opcional):') || '';
      const { ok, status, corpo } = await pedirJson(`/api/cliente/agendamentos/${item.id}/cancelar`, {
        method: 'POST', body: JSON.stringify({ motivo }),
      });
      if (!ok) {
        toast(status === 403 ? 'Fora do prazo para cancelar.' : (corpo?.erro || 'Não foi possível cancelar.'), 'erro');
        return;
      }
      toast('Agendamento cancelado.', 'info');
      this.carregarListas();
    },

    abrirRemarcar(item) {
      const hoje = new Date();
      this.remarcando = { id: item.id, servico_id: item.servico_id ?? item.servico?.id,
        ano: hoje.getFullYear(), mes: hoje.getMonth() + 1, grade: [], dia: null, horarios: [], horario: null };
      this.carregarDiasRemarcar();
    },
    async carregarDiasRemarcar() {
      const r = this.remarcando;
      const { ok, corpo } = await pedirJson(`/api/agenda/dias?ano=${r.ano}&mes=${r.mes}&servico_id=${r.servico_id}`);
      if (ok) r.grade = corpo.dias || [];
    },
    async escolherDiaRemarcar(data) {
      const r = this.remarcando; r.dia = data;
      const { ok, corpo } = await pedirJson(`/api/agenda/horarios?data=${data}&servico_id=${r.servico_id}`);
      if (ok) r.horarios = corpo.horarios || [];
    },
    async confirmarRemarcar() {
      const r = this.remarcando;
      const { ok, status } = await pedirJson(`/api/cliente/agendamentos/${r.id}/remarcar`, {
        method: 'POST', body: JSON.stringify({ nova_data: r.dia, novo_horario: r.horario }),
      });
      if (!ok) { toast(status === 409 ? 'Horário indisponível.' : 'Não foi possível remarcar.', 'erro'); return; }
      toast('Agendamento remarcado.', 'info');
      this.remarcando = null; this.carregarListas();
    },

    async enviarCodigoReset() {
      this.erroReset = '';
      if (!this.reset.celular) { this.erroReset = 'Informe o celular.'; return; }
      await pedirJson('/api/auth/otp/enviar', {
        method: 'POST',
        body: JSON.stringify({ celular: this.reset.celular, proposito: 'reset' }),
      });
      // resposta é sempre 200 (não vaza) — avança para o passo do código
      this.passoReset = 2;
    },

    async redefinirSenha() {
      this.erroReset = '';
      if (this.reset.senha.length < 6) { this.erroReset = 'A senha precisa de ao menos 6 caracteres.'; return; }
      if (this.reset.senha !== this.reset.senha2) { this.erroReset = 'As senhas não conferem.'; return; }
      const { ok, corpo } = await pedirJson('/api/auth/senha/redefinir', {
        method: 'POST',
        body: JSON.stringify({ celular: this.reset.celular, codigo: this.reset.codigo, nova_senha: this.reset.senha }),
      });
      if (!ok) {
        this.erroReset = corpo?.erro === 'MUITAS_TENTATIVAS'
          ? 'Muitas tentativas, aguarde alguns minutos.'
          : 'Código inválido ou expirado.';
        this.passoReset = 2;
        return;
      }
      this.modoReset = false;
      this.passoReset = 1;
      this.reset = { celular: '', codigo: '', senha: '', senha2: '' };
      this.logado = true;
      this.aba = 'proximos';
      this.carregarListas();
      toast('Senha redefinida. Você está logado.', 'info');
    },

    async sair() {
      await pedirJson('/api/auth/logout', { method: 'POST' });
      location.reload();
    },
  };
}

if (typeof window !== 'undefined') {
  window.areaCliente = areaCliente;
  document.addEventListener('alpine:init', () => window.Alpine.data('areaCliente', areaCliente));
}
