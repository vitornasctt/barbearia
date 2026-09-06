export const mapaErroHttp = {
  VALIDACAO: 400,
  NAO_AUTENTICADO: 401,
  CREDENCIAIS_INVALIDAS: 401,
  SEM_PERMISSAO: 403,
  FORA_DO_PRAZO: 403,
  FORA_DO_EXPEDIENTE: 422,
  NAO_ENCONTRADO: 404,
  HORARIO_INDISPONIVEL: 409,
  SLOT_TRAVADO: 409,
  SLOT_OCUPADO: 409,
  LOCK_EXPIRADO: 409,
  JA_CANCELADO: 409,
  JA_CONCLUIDO: 409,
  CELULAR_EM_USO: 409,
  MES_FECHADO: 422,
  DIA_FECHADO: 422,
  ANTECEDENCIA: 422,
  LIMITE_ATINGIDO: 422,
  SERVICO_INVALIDO: 422,
  TEMPLATE_INATIVO: 422,
  MUITAS_TENTATIVAS: 429,
};

export class ErroHttp extends Error {
  constructor(codigo) {
    super(codigo);
    this.name = 'ErroHttp';
    this.codigoHttp = codigo;
  }
}

export function respostaDeErro(codigo) {
  const status = mapaErroHttp[codigo];
  if (!status) return { status: 500, corpo: { erro: 'ERRO_INTERNO' } };
  return { status, corpo: { erro: codigo } };
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err && typeof err.codigoHttp === 'string') {
    const { status, corpo } = respostaDeErro(err.codigoHttp);
    if (err.campos) corpo.campos = err.campos;
    return res.status(status).json(corpo);
  }
  (req.log?.error ?? console.error)({ err }, 'erro não tratado na rota');
  res.status(500).json({ erro: 'ERRO_INTERNO' });
}
