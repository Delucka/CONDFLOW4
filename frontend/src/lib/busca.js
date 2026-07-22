// Busca única do sistema — use em TODA tela que tem campo de pesquisa.
// Resolve os 3 problemas das buscas antigas (`.toLowerCase().includes(...)`):
//   1. acento: "sao"/"são", "america"/"américa" passam a achar a mesma coisa
//   2. ordem das palavras: "caioba 002" acha "002 - COND. ED. CAIOBA"
//   3. código com zero à esquerda: "2" acha "002", e "002" acha "2"

export function normalizar(s) {
  return (s ?? '')
    .toString()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

// Código numérico no começo do nome: "002 - COND. ED. CAIOBA" -> "002"
function codigoDe(texto) {
  const m = normalizar(texto).match(/^(\d+)/);
  return m ? m[1] : null;
}

/**
 * `termo` casa com `campos` se CADA palavra do termo aparecer em algum campo.
 * @param {string} termo   o que o usuário digitou
 * @param {...any} campos  nome do condomínio, gerente, descrição…
 */
export function combina(termo, ...campos) {
  const t = normalizar(termo);
  if (!t) return true;                       // busca vazia = mostra tudo

  const alvo = campos.map(normalizar).filter(Boolean).join(' ');
  if (!alvo) return false;

  const codigo = campos.map(codigoDe).find(Boolean) || null;

  return t.split(/\s+/).every((palavra) => {
    if (alvo.includes(palavra)) return true;
    // "2" acha "002" e "002" acha "2" (compara sem zeros à esquerda)
    if (codigo && /^\d+$/.test(palavra)) {
      return codigo.replace(/^0+/, '') === palavra.replace(/^0+/, '');
    }
    return false;
  });
}

/** Açúcar: filtra uma lista extraindo os campos de busca de cada item. */
export function filtrarPorBusca(lista, termo, extrairCampos) {
  if (!normalizar(termo)) return lista;
  return (lista || []).filter((item) => combina(termo, ...[].concat(extrairCampos(item))));
}
