// src/lib/template.js
export function renderizarTemplate(corpo, vars = {}) {
  return corpo.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, chave) => {
    const v = vars[chave];
    return v === undefined || v === null ? '' : String(v);
  });
}
