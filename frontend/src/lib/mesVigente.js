// A operação trabalha SEMPRE 1 mês à frente: o mês "vigente" do sistema é M+1.
// (em junho, o mês de trabalho é julho — e em dezembro, janeiro do ano seguinte)
// Espelha o `_mes_alvo_padrao()` do backend (api/api_routes.py).
// Use como padrão de mês/ano em TODAS as telas — não repita `getMonth() + 1`.

export function mesAnoVigente(d = new Date()) {
  const m = d.getMonth(); // 0..11
  return m === 11
    ? { mes: 1, ano: d.getFullYear() + 1 }
    : { mes: m + 2, ano: d.getFullYear() };
}

export const mesVigente = (d) => mesAnoVigente(d).mes;
export const anoVigente = (d) => mesAnoVigente(d).ano;

/**
 * O mês já ficou para trás? Fechado = anterior ao mês de trabalho.
 *
 * A régua antiga era "dia 16 do próprio mês", o que fechava tudo um mês tarde:
 * em 05/08/2026 o mês de trabalho já é 09/2026, os boletos de agosto foram
 * emitidos em julho e vencem agora — e mesmo assim agosto seguia aberto até
 * 16/08. Dava para lançar cobrança extra num mês cujo boleto já estava na mão
 * do condômino.
 *
 * Comparar por (ano*12 + mes) resolve a virada de ano de graça: em dezembro o
 * mês de trabalho é janeiro do ano seguinte, e dezembro fecha.
 */
export function mesFechado(mes, ano, d = new Date()) {
  const vig = mesAnoVigente(d);
  return (ano * 12 + mes) < (vig.ano * 12 + vig.mes);
}
