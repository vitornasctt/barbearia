// src/public/js/admin/agendamentos.js
import { pedirJson, toast } from '../comum.js';

function painelAgendamentos() {
  return {
    itens: [], pagina: 1,
    filtro: { data: '', status: '', cliente: '' },
    novo: {
      busca: '', resultados: [], cliente_id: null, clienteNome: '',
      cadastrar: false, nome: '', celular: '',
      servicos: [], servico_id: '',
      ano: new Date().getFullYear(), mes: new Date().getMonth() + 1,
      dias: [], data: '', horarios: [], horario: '',
      observacoes: '', erro: '',
    },
    async init() {
      await this.buscar();
      window.addEventListener('admin:novo_agendamento', () => this.buscar());
      window.addEventListener('admin:agendamento_atualizado', (e) => {
        const i = this.itens.findIndex((x) => x.id === e.detail.id);
        if (i >= 0) this.itens[i] = { ...this.itens[i], status: e.detail.status };
      });
      await this.initNovo();
    },
    async initNovo() {
      const { ok, corpo } = await pedirJson('/api/admin/servicos');
      if (ok) this.novo.servicos = corpo.servicos || corpo;
    },
    async buscarCliente() {
      if (!this.novo.busca) { this.novo.resultados = []; return; }
      const { ok, corpo } = await pedirJson('/api/admin/clientes?busca=' + encodeURIComponent(this.novo.busca));
      if (ok) this.novo.resultados = (corpo.itens || corpo.clientes || corpo).slice(0, 8);
    },
    selecionarCliente(c) {
      this.novo.cliente_id = c.id; this.novo.clienteNome = c.nome;
      this.novo.resultados = []; this.novo.busca = ''; this.novo.cadastrar = false;
    },
    limparCliente() { this.novo.cliente_id = null; this.novo.clienteNome = ''; },
    async carregarDiasNovo() {
      this.novo.data = ''; this.novo.horario = ''; this.novo.horarios = [];
      if (!this.novo.servico_id) { this.novo.dias = []; return; }
      const q = `ano=${this.novo.ano}&mes=${this.novo.mes}&servico_id=${this.novo.servico_id}`;
      const { ok, corpo } = await pedirJson('/api/agenda/dias?' + q);
      this.novo.dias = ok ? (corpo.dias || []) : [];
    },
    async escolherDiaNovo(d) {
      this.novo.data = d; this.novo.horario = '';
      const q = `data=${d}&servico_id=${this.novo.servico_id}`;
      const { ok, corpo } = await pedirJson('/api/agenda/horarios?' + q);
      this.novo.horarios = ok ? (corpo.horarios || []) : [];
    },
    podeCriar() {
      const n = this.novo;
      const temCliente = n.cliente_id || (n.cadastrar && n.nome && n.celular);
      return Boolean(temCliente && n.servico_id && n.data && n.horario);
    },
    async criarAgendamento() {
      const n = this.novo;
      n.erro = '';
      const body = {
        servico_id: n.servico_id, data: n.data, horario: n.horario,
        ...(n.observacoes ? { observacoes: n.observacoes } : {}),
        ...(n.cliente_id ? { cliente_id: n.cliente_id } : { cliente: { nome: n.nome, celular: n.celular } }),
      };
      const { ok, corpo } = await pedirJson('/api/admin/agendamentos', { method: 'POST', body: JSON.stringify(body) });
      if (!ok) { n.erro = (corpo && corpo.erro) || 'Não foi possível criar.'; toast('Falha ao criar agendamento.', 'erro'); return; }
      toast('Agendamento criado.', 'info');
      Object.assign(this.novo, {
        busca: '', resultados: [], cliente_id: null, clienteNome: '', cadastrar: false,
        nome: '', celular: '', servico_id: '', dias: [], data: '', horarios: [], horario: '', observacoes: '', erro: '',
      });
      this.buscar();
    },
    async buscar() {
      const q = new URLSearchParams({ page: this.pagina });
      if (this.filtro.data) q.set('data', this.filtro.data);
      if (this.filtro.status) q.set('status', this.filtro.status);
      if (this.filtro.cliente) q.set('cliente', this.filtro.cliente);
      const { ok, corpo } = await pedirJson('/api/admin/agendamentos?' + q);
      if (ok) this.itens = corpo.agendamentos || corpo.itens || corpo;
    },
    async mudarStatus(a, status) {
      const { ok } = await pedirJson(`/api/admin/agendamentos/${a.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      if (ok) { toast('Status atualizado.', 'info'); this.buscar(); }
      else toast('Não foi possível atualizar.', 'erro');
    },
    async cancelar(a) {
      const motivo = prompt('Motivo:') || '';
      const { ok } = await pedirJson(`/api/admin/agendamentos/${a.id}/status`, {
        method: 'PATCH', body: JSON.stringify({ status: 'cancelado', motivo }),
      });
      if (ok) { toast('Cancelado.', 'info'); this.buscar(); }
    },
    async enviarWhatsapp(a) {
      const { ok } = await pedirJson('/api/admin/mensagens/enviar', {
        method: 'POST', body: JSON.stringify({ agendamento_id: a.id, template_chave: 'confirmacao' }),
      });
      toast(ok ? 'Mensagem enfileirada.' : 'Falha ao enfileirar.', ok ? 'info' : 'erro');
    },
  };
}

if (typeof window !== 'undefined') {
  window.painelAgendamentos = painelAgendamentos;
  document.addEventListener('alpine:init', () => window.Alpine.data('painelAgendamentos', painelAgendamentos));
}
