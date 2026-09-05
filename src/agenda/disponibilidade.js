// src/agenda/disponibilidade.js
import { query } from '../db/pool.js';
import { gerarSlots } from './slots.js';
import { paraMinutos } from '../lib/tempo.js';
import * as cache from './cache.js';

function dowUTC(data) {
  const [y, m, d] = data.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=domingo
}

// helper: ranges ocupados (agendamentos ativos + bloqueios) em minutos
async function rangesOcupados(exec, { barbeiroId, data, abre, fecha }) {
  const ativos = await exec(
    `SELECT to_char(horario_inicio,'HH24:MI') AS ini, to_char(horario_fim,'HH24:MI') AS fim
     FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND status IN ('pendente','confirmado')`,
    [barbeiroId, data],
  );
  const bloqueios = await exec(
    `SELECT to_char(hora_inicio,'HH24:MI') AS ini, to_char(hora_fim,'HH24:MI') AS fim
     FROM bloqueios_agenda
     WHERE data=$1 AND (barbeiro_id IS NULL OR barbeiro_id=$2)`,
    [data, barbeiroId],
  );
  const ranges = [];
  for (const r of ativos.rows) ranges.push([paraMinutos(r.ini), paraMinutos(r.fim)]);
  for (const r of bloqueios.rows) {
    ranges.push(r.ini ? [paraMinutos(r.ini), paraMinutos(r.fim)]
                      : [paraMinutos(abre), paraMinutos(fecha)]);
  }
  return ranges;
}

function invade(ini, fim, ranges) {
  return ranges.some(([oIni, oFim]) => ini < oFim && oIni < fim);
}

async function contarAtivos(exec, barbeiroId, data) {
  const r = await exec(
    `SELECT count(*)::int AS n FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND status IN ('pendente','confirmado')`,
    [barbeiroId, data],
  );
  return r.rows[0].n;
}

async function limitePorDia(exec, ano, mes, barbeiroId) {
  const r = await exec(
    `SELECT limite_por_dia FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto' AND (barbeiro_id IS NULL OR barbeiro_id=$3)
     ORDER BY barbeiro_id NULLS LAST LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  return r.rows[0]?.limite_por_dia ?? null;
}

export async function calcularBase(exec, { barbeiroId, data, servicoId }) {
  const [ano, mes] = data.split('-').map(Number);

  const disp = await exec(
    `SELECT 1 FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto'
       AND (barbeiro_id IS NULL OR barbeiro_id=$3) LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  if (disp.rowCount === 0) return { fechado: 'mes_fechado' };

  const func = await exec(
    `SELECT aberto, to_char(abre,'HH24:MI') AS abre, to_char(fecha,'HH24:MI') AS fecha
     FROM horario_funcionamento WHERE dia_semana=$1`,
    [dowUTC(data)],
  );
  if (func.rowCount === 0 || !func.rows[0].aberto) return { fechado: 'dia_fechado' };
  const { abre, fecha } = func.rows[0];

  const cfg = await exec(
    `SELECT intervalo_minutos, antecedencia_min_horas FROM configuracao WHERE id=1`,
  );
  const { intervalo_minutos, antecedencia_min_horas } = cfg.rows[0];

  const srv = await exec(`SELECT duracao_minutos FROM servicos WHERE id=$1 AND ativo`, [servicoId]);
  if (srv.rowCount === 0) return { fechado: 'servico_invalido' };
  const duracao = srv.rows[0].duracao_minutos;

  const slots = gerarSlots({
    abre, fecha, intervaloMinutos: intervalo_minutos, duracaoServico: duracao,
  });

  const [anoN, mesN] = data.split('-').map(Number);
  const limite = await limitePorDia(exec, anoN, mesN, barbeiroId);
  if (limite != null && (await contarAtivos(exec, barbeiroId, data)) >= limite) {
    return { fechado: 'limite_atingido' };
  }

  const ranges = await rangesOcupados(exec, { barbeiroId, data, abre, fecha });
  const slotsLivres = slots.filter((s) => {
    const ini = paraMinutos(s);
    return !invade(ini, ini + duracao, ranges);
  });

  return { slots: slotsLivres, duracao, antecedenciaHoras: antecedencia_min_horas, abre, fecha, fechado: null };
}

export async function verificarSlot(exec, { barbeiroId, data, horario, duracaoMinutos, agora = new Date() }) {
  const [ano, mes] = data.split('-').map(Number);

  const disp = await exec(
    `SELECT 1 FROM agenda_disponibilidade
     WHERE ano=$1 AND mes=$2 AND status='aberto' AND (barbeiro_id IS NULL OR barbeiro_id=$3) LIMIT 1`,
    [ano, mes, barbeiroId],
  );
  if (disp.rowCount === 0) return { ok: false, erro: 'MES_FECHADO' };

  const func = await exec(
    `SELECT aberto, to_char(abre,'HH24:MI') AS abre, to_char(fecha,'HH24:MI') AS fecha
     FROM horario_funcionamento WHERE dia_semana=$1`, [dowUTC(data)],
  );
  if (func.rowCount === 0 || !func.rows[0].aberto) return { ok: false, erro: 'DIA_FECHADO' };
  const { abre, fecha } = func.rows[0];

  const ini = paraMinutos(horario);
  const fim = ini + duracaoMinutos;
  if (ini < paraMinutos(abre) || fim > paraMinutos(fecha)) return { ok: false, erro: 'FORA_DO_EXPEDIENTE' };

  const cfg = await exec(`SELECT antecedencia_min_horas FROM configuracao WHERE id=1`);
  const limite = new Date(agora.getTime() + cfg.rows[0].antecedencia_min_horas * 3_600_000);
  if (new Date(`${data}T${horario}:00`) < limite) return { ok: false, erro: 'ANTECEDENCIA' };

  const lim = await limitePorDia(exec, ano, mes, barbeiroId);
  if (lim != null && (await contarAtivos(exec, barbeiroId, data)) >= lim) {
    return { ok: false, erro: 'LIMITE_ATINGIDO' };
  }

  const ranges = await rangesOcupados(exec, { barbeiroId, data, abre, fecha });
  if (invade(ini, fim, ranges)) return { ok: false, erro: 'HORARIO_INDISPONIVEL' };

  return { ok: true };
}

export async function horariosDisponiveis({
  barbeiroId, data, servicoId, sessionId = null, agora = new Date(),
}) {
  const chave = cache.chaveDisponibilidade(barbeiroId, data, servicoId);
  let base = cache.get(chave);
  if (!base) {
    base = await calcularBase(query, { barbeiroId, data, servicoId });
    cache.set(chave, base);
  }
  if (base.fechado) return { disponivel: [], fechado: base.fechado };

  const limite = new Date(agora.getTime() + base.antecedenciaHoras * 3_600_000);
  let livres = base.slots.filter((s) => new Date(`${data}T${s}:00`) >= limite);

  const locks = await query(
    `SELECT to_char(horario,'HH24:MI') AS horario FROM horarios_lock
     WHERE barbeiro_id=$1 AND data=$2 AND expira_em > now()
       AND ($3::text IS NULL OR session_id <> $3)`,
    [barbeiroId, data, sessionId],
  );
  const travados = new Set(locks.rows.map((r) => r.horario));
  livres = livres.filter((s) => !travados.has(s));

  return { disponivel: livres, fechado: null };
}
