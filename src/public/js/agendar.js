// src/public/js/agendar.js
import { pedirJson, formatarMMSS, toast } from './comum.js';
import { restanteDoLock, conectarAgenda } from './realtime.js';

export function montarCalendario(ano, mes, diasLivres) {
  const livres = new Set(diasLivres);
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1));
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const grade = [];
  for (let i = 0; i < primeiro.getUTCDay(); i++) grade.push(null);
  for (let d = 1; d <= total; d++) {
    const data = `${ano}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    grade.push({ dia: d, data, livre: livres.has(data) });
  }
  return grade;
}

export function fluxoAgendamento() {
  const dados = JSON.parse(document.getElementById('dados-pagina').textContent);
  const hoje = new Date();
  return {
    dados,
    passo: 1,
    servico: null,
    ano: hoje.getFullYear(),
    mes: hoje.getMonth() + 1,
    grade: [],
    mesFechado: false,
    dia: null,
    horarios: [],
    horario: null,
    expiraEm: null,
    restante: 0,
    _tickTimer: null,
    _heartbeat: null,
    _pollTimer: null,
    _rt: null,
    form: { nome: '', celular: '', comSenha: false, email: '', senha: '', codigo: '', consentimento: false },
    codigoEnviado: false,
    reenvioEm: 0,
    _reenvioTimer: null,
    erro: '',

    init() {
      window.addEventListener('pagehide', () => this.liberar(true));
    },

    escolherServico(s) { this.servico = s; this.passo = 2; this.carregarDias(); },

    async carregarDias() {
      this.erro = ''; this.mesFechado = false;
      const q = `ano=${this.ano}&mes=${this.mes}&servico_id=${this.servico.id}`;
      const { ok, corpo } = await pedirJson(`/api/agenda/dias?${q}`);
      if (!ok) { this.erro = 'Não foi possível carregar o calendário.'; return; }
      if (corpo.fechado === 'MES_FECHADO') { this.mesFechado = true; this.grade = []; return; }
      this.grade = montarCalendario(this.ano, this.mes, corpo.dias || []);
    },

    mudarMes(delta) {
      this.mes += delta;
      if (this.mes < 1) { this.mes = 12; this.ano--; }
      if (this.mes > 12) { this.mes = 1; this.ano++; }
      this.carregarDias();
    },

    async escolherDia(data) {
      this.dia = data; this.passo = 3; this.horario = null;
      await this.carregarHorarios();
      if (this._rt) { this._rt.trocarData(data); }
      else {
        this._rt = conectarAgenda(data, {
          horario_reservado: (p) => { if (p.data === this.dia) this.marcarOcupado(p.horario); },
          horario_liberado: () => this.carregarHorarios(),
          agenda_atualizada: () => this.carregarHorarios(),
        });
      }
      clearInterval(this._pollTimer);
      this._pollTimer = setInterval(() => this.carregarHorarios(), 30000);
    },

    async carregarHorarios() {
      const q = `data=${this.dia}&servico_id=${this.servico.id}`;
      const { ok, corpo } = await pedirJson(`/api/agenda/horarios?${q}`);
      if (ok) this.horarios = corpo.horarios || [];
    },

    marcarOcupado(h) {
      this.horarios = this.horarios.filter((x) => x !== h);
      if (this.horario === h) { this.horario = null; toast('Esse horário acabou de ser reservado.', 'erro'); }
    },

    async escolherHorario(h) {
      this.erro = '';
      const corpoReq = { data: this.dia, horario: h, servico_id: this.servico.id };
      const { ok, status, corpo } = await pedirJson('/api/agenda/lock', { method: 'POST', body: JSON.stringify(corpoReq) });
      if (!ok) {
        if (status === 409) { toast('Horário indisponível, escolha outro.', 'erro'); await this.carregarHorarios(); return; }
        this.erro = 'Não foi possível reservar o horário.'; return;
      }
      this.horario = h;
      this.iniciarContador(corpo.expira_em);
      this.iniciarHeartbeat();
      this.passo = 4;
    },

    iniciarContador(expiraEm) {
      this.expiraEm = expiraEm;
      clearInterval(this._tickTimer);
      const tick = () => {
        this.restante = restanteDoLock(this.expiraEm);
        if (this.restante <= 0) {
          clearInterval(this._tickTimer);
          this.pararHeartbeat();
          this.horario = null;
          this.passo = 3;
          this.carregarHorarios();
          toast('Sua reserva expirou. Escolha o horário novamente.', 'erro');
        }
      };
      tick();
      this._tickTimer = setInterval(tick, 1000);
    },
    get contador() { return formatarMMSS(this.restante); },

    iniciarHeartbeat() {
      clearInterval(this._heartbeat);
      this._heartbeat = setInterval(async () => {
        const body = JSON.stringify({ data: this.dia, horario: this.horario, servico_id: this.servico.id });
        const { ok, corpo } = await pedirJson('/api/agenda/lock/renovar', { method: 'POST', body });
        if (ok && corpo.expira_em) this.expiraEm = corpo.expira_em;
      }, 120000);
    },
    pararHeartbeat() { clearInterval(this._heartbeat); },

    async liberar(beacon = false) {
      if (!this.horario || !this.dia) return;
      const payload = JSON.stringify({ data: this.dia, horario: this.horario, servico_id: this.servico.id });
      if (beacon && navigator.sendBeacon) {
        navigator.sendBeacon('/api/agenda/lock/liberar', new Blob([payload], { type: 'application/json' }));
      } else {
        await pedirJson('/api/agenda/lock/liberar', { method: 'POST', body: payload });
      }
    },

    voltarParaDia() { clearInterval(this._pollTimer); if (this._rt) { this._rt.sair(); this._rt = null; } this.passo = 2; },

    voltarParaHorarios() { this.liberar(); this.pararHeartbeat(); clearInterval(this._tickTimer); this.horario = null; this.passo = 3; this.carregarHorarios(); },

    async enviarCodigo() {
      this.erro = '';
      if (!this.form.celular) { this.erro = 'Informe o celular primeiro.'; return; }
      const { ok } = await pedirJson('/api/auth/otp/enviar', {
        method: 'POST',
        body: JSON.stringify({ celular: this.form.celular, proposito: 'cadastro' }),
      });
      if (!ok) { this.erro = 'Não foi possível enviar o código. Tente em instantes.'; return; }
      this.codigoEnviado = true;
      this.reenvioEm = 60;
      clearInterval(this._reenvioTimer);
      this._reenvioTimer = setInterval(() => {
        this.reenvioEm -= 1;
        if (this.reenvioEm <= 0) clearInterval(this._reenvioTimer);
      }, 1000);
    },

    async enviarCadastro() {
      this.erro = '';
      if (!this.form.consentimento) { this.erro = 'É preciso aceitar a política de privacidade.'; return; }
      const body = {
        nome: this.form.nome, celular: this.form.celular, consentimento: true,
        ...(this.form.comSenha
          ? { email: this.form.email, senha: this.form.senha, codigo: this.form.codigo }
          : {}),
      };
      const { ok, corpo } = await pedirJson('/api/agenda/cadastro', { method: 'POST', body: JSON.stringify(body) });
      if (!ok) {
        this.erro = corpo?.erro === 'OTP_INVALIDO'
          ? 'Código inválido ou expirado.'
          : ((corpo && corpo.campos && corpo.campos[0]?.mensagem) || 'Verifique os dados.');
        return;
      }
      this.passo = 5;
    },

    async confirmar() {
      this.erro = '';
      const body = JSON.stringify({ servico_id: this.servico.id, data: this.dia, horario: this.horario, observacoes: this.form.observacoes || undefined });
      const { ok, status, corpo } = await pedirJson('/api/agenda/confirmar', { method: 'POST', body });
      if (!ok) {
        if (status === 409) { toast('Esse horário ficou indisponível. Escolha outro.', 'erro'); this.passo = 3; this.carregarHorarios(); return; }
        this.erro = (corpo && corpo.erro) || 'Não foi possível confirmar.'; return;
      }
      this.pararHeartbeat(); clearInterval(this._tickTimer);
      if (this._rt) this._rt.sair();
      clearInterval(this._pollTimer);
      this.passo = 6;
    },
  };
}

if (typeof window !== 'undefined') {
  window.fluxoAgendamento = fluxoAgendamento;
  document.addEventListener('alpine:init', () => window.Alpine.data('fluxoAgendamento', fluxoAgendamento));
}
