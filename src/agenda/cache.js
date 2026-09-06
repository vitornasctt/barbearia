const store = new Map();

export function chaveDisponibilidade(barbeiroId, data, servicoId) {
  return `disp:${barbeiroId}:${data}:${servicoId}`;
}

export function get(chave) {
  const item = store.get(chave);
  if (!item) return undefined;
  if (item.expiraEm <= Date.now()) {
    store.delete(chave);
    return undefined;
  }
  return item.valor;
}

export function set(chave, valor, ttlMs = 30_000) {
  store.set(chave, { valor, expiraEm: Date.now() + ttlMs });
}

export function invalidarData(data) {
  for (const chave of store.keys()) {
    if (chave.includes(`:${data}:`)) store.delete(chave);
  }
}

export function limparTudo() {
  store.clear();
}
