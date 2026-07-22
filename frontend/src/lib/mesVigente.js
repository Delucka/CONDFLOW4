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
