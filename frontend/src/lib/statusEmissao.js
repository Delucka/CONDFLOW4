'use client';

/**
 * Os conjuntos de status de emissão, num lugar só.
 *
 * POR QUE ISTO EXISTE
 *
 * As contagens da fila perguntavam com `ilike '%pendente_gerente%'`. Funciona,
 * mas curinga NO COMEÇO impede qualquer índice de ser usado: toda contagem vira
 * varredura completa da tabela. São seis delas a cada abertura do Painel.
 *
 * O motivo do `ilike` era real: o status tem grafias legadas convivendo com as
 * novas — `pendente_gerente` e `Aguardando Gerente` significam a mesma coisa,
 * de épocas diferentes do sistema. Listar só a nova perderia emissão antiga.
 *
 * Aqui as duas grafias ficam juntas, e a consulta passa a usar `.in()`, que o
 * índice atende. Se aparecer uma grafia nova, é este arquivo que muda — não
 * cinco telas.
 *
 * Os valores vieram do StatusBadge, que é quem sabe renderizar todos eles.
 */

/** Com o gerente, esperando a aprovação dele. */
export const COM_GERENTE = [
  'pendente_gerente',
  'Aguardando Gerente',
  'pendente',            // grafia mais antiga de todas
];

/** Com o supervisor de gerentes. */
export const COM_SUP_GERENTES = [
  'pendente_sup_gerentes',
  'Aguardando Chefe',
];

/** Com a supervisão de contabilidade. */
export const COM_SUP_CONTABILIDADE = [
  'pendente_sup_contabilidade',
  'Aguardando Supervisor',
];

/** Voltou para correção — em qualquer das grafias que já existiram. */
export const EM_CORRECAO = [
  'solicitar_correcao',
  'Solicitar alteração',
  'Solicitar correção',
];

/** Aprovado, esperando o registro. */
export const AGUARDANDO_REGISTRO = ['aprovado'];

/** Já saiu: registrado ou expedido. */
export const JA_EMITIDO = ['registrado', 'expedida'];

/**
 * Compara status ignorando caixa e acento — para filtrar em memória o que já
 * veio do banco. Para CONSULTA, use as listas acima com `.in()`.
 */
export function statusEstaEm(status, lista) {
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const alvo = norm(status);
  return lista.some((v) => norm(v) === alvo);
}
