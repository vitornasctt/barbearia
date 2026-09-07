-- 004_meses_nulls_not_distinct.sql
-- agenda_disponibilidade.UNIQUE(ano,mes,barbeiro_id) não cobre barbeiro_id NULL
-- (dois "meses globais" para o mesmo ano/mês podiam coexistir). NULLS NOT DISTINCT corrige.
ALTER TABLE agenda_disponibilidade
  DROP CONSTRAINT IF EXISTS agenda_disponibilidade_ano_mes_barbeiro_id_key;

ALTER TABLE agenda_disponibilidade
  ADD CONSTRAINT agenda_disponibilidade_ano_mes_barbeiro_uk
  UNIQUE NULLS NOT DISTINCT (ano, mes, barbeiro_id);
