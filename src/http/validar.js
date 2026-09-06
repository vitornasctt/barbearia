// src/http/validar.js
import { ErroHttp } from './erros.js';

function fazer(fonte) {
  return (schema) => (req, res, next) => {
    const r = schema.safeParse(req[fonte]);
    if (!r.success) {
      const e = new ErroHttp('VALIDACAO');
      e.campos = r.error.issues.map((i) => ({ caminho: i.path.join('.'), mensagem: i.message }));
      return next(e);
    }
    req[fonte] = r.data;
    next();
  };
}

export const validarCorpo = fazer('body');
export const validarQuery = fazer('query');
