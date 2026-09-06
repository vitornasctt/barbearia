// src/agenda/locks.js
import { query } from '../db/pool.js';

const LOCK_MINUTOS = 5;

export async function criarLock({ barbeiroId, data, horario, sessionId }) {
  const ocupado = await query(
    `SELECT 1 FROM agendamentos
     WHERE barbeiro_id=$1 AND data_agendamento=$2 AND horario_inicio=$3
       AND status IN ('pendente','confirmado') LIMIT 1`,
    [barbeiroId, data, horario],
  );
  if (ocupado.rowCount > 0) return { ok: false, erro: 'SLOT_OCUPADO' };

  const res = await query(
    `INSERT INTO horarios_lock (barbeiro_id, data, horario, session_id, expira_em)
     VALUES ($1, $2, $3, $4, now() + interval '${LOCK_MINUTOS} minutes')
     ON CONFLICT (barbeiro_id, data, horario) DO UPDATE
       SET session_id = EXCLUDED.session_id,
           expira_em  = EXCLUDED.expira_em,
           criado_em  = now()
     WHERE horarios_lock.session_id = EXCLUDED.session_id
        OR horarios_lock.expira_em < now()
     RETURNING id`,
    [barbeiroId, data, horario, sessionId],
  );
  return res.rowCount === 0 ? { ok: false, erro: 'SLOT_TRAVADO' } : { ok: true };
}

export async function renovarLock({ barbeiroId, data, horario, sessionId }) {
  const res = await query(
    `UPDATE horarios_lock SET expira_em = now() + interval '${LOCK_MINUTOS} minutes'
     WHERE barbeiro_id=$1 AND data=$2 AND horario=$3 AND session_id=$4`,
    [barbeiroId, data, horario, sessionId],
  );
  return { ok: res.rowCount > 0 };
}

export async function liberarLock({ barbeiroId, data, horario, sessionId }) {
  await query(
    `DELETE FROM horarios_lock
     WHERE barbeiro_id=$1 AND data=$2 AND horario=$3 AND session_id=$4`,
    [barbeiroId, data, horario, sessionId],
  );
  return { ok: true };
}

export async function limparExpirados() {
  const res = await query(
    `DELETE FROM horarios_lock WHERE expira_em < now()
     RETURNING to_char(data,'YYYY-MM-DD') AS data, to_char(horario,'HH24:MI') AS horario, barbeiro_id`);
  return { removidos: res.rowCount, itens: res.rows };
}
