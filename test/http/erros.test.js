import test from 'node:test';
import assert from 'node:assert/strict';
import { mapaErroHttp, respostaDeErro, ErroHttp } from '../../src/http/erros.js';

test('mapaErroHttp cobre os códigos do motor', () => {
  for (const c of ['HORARIO_INDISPONIVEL', 'MES_FECHADO', 'NAO_ENCONTRADO', 'JA_CANCELADO',
    'NAO_AUTENTICADO', 'SEM_PERMISSAO', 'VALIDACAO']) {
    assert.equal(typeof mapaErroHttp[c], 'number');
  }
});

test('respostaDeErro mapeia e cai para 500 no desconhecido', () => {
  assert.deepEqual(respostaDeErro('HORARIO_INDISPONIVEL'), { status: 409, corpo: { erro: 'HORARIO_INDISPONIVEL' } });
  assert.deepEqual(respostaDeErro('MES_FECHADO'), { status: 422, corpo: { erro: 'MES_FECHADO' } });
  assert.deepEqual(respostaDeErro('BANANA'), { status: 500, corpo: { erro: 'ERRO_INTERNO' } });
});

test('ErroHttp carrega o código', () => {
  const e = new ErroHttp('SEM_PERMISSAO');
  assert.equal(e.codigoHttp, 'SEM_PERMISSAO');
});
