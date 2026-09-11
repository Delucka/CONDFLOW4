// Filtro por vencimento — uma regra só, para todas as telas.
//
// O vencimento mora em DOIS campos: `due_day` e, para quem vence dividido
// ("dia 5 e 20"), `due_day_2`. Um condomínio que vence dia 5 e 20 aparece nos
// dois filtros: quem procura "o que vence dia 20" precisa vê-lo. Ler só o
// `due_day` esconderia a segunda metade de todo vencimento dividido.
//
// Em telas de emissão, o dia que vale pode ser o do GRUPO (`grupo_due_day`),
// não o do cadastro — por isso cada tela diz de onde tirar o dia (`pegar`).

const PADRAO = (c) => [c?.due_day, c?.due_day_2];

function diasDo(item, pegar = PADRAO) {
  const bruto = pegar(item);
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  return lista
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
}

/** Os dias presentes na lista, em ordem, e se há quem não tenha vencimento. */
export function diasDeVencimento(itens, pegar = PADRAO) {
  const dias = new Set();
  let temSem = false;
  for (const it of itens || []) {
    const ds = diasDo(it, pegar);
    if (ds.length) ds.forEach((d) => dias.add(d));
    else temSem = true;
  }
  return { dias: [...dias].sort((a, b) => a - b), temSem };
}

/** `filtro`: '' = todos · 'sem' = sem vencimento cadastrado · '5' = vence dia 5. */
export function passaVencimento(item, filtro, pegar = PADRAO) {
  if (!filtro) return true;
  const ds = diasDo(item, pegar);
  if (filtro === 'sem') return ds.length === 0;
  return ds.includes(Number(filtro));
}
