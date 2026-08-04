// Escala tipográfica — Direção A (densa e sóbria), referência Linear/Stripe/Attio.
//
// O problema que isto resolve: o app tinha 552 `uppercase`, 506 `font-black`,
// 474 `tracking-widest` e 417 `text-[10px]`. Quando TODO rótulo é caixa alta,
// peso máximo e 10px, não existe hierarquia — tudo grita no mesmo tom e o nome do
// condomínio (que é o que a pessoa procura) tem o mesmo peso visual da palavra
// "AÇÕES" no cabeçalho.
//
// Duas regras:
//   1. Hierarquia vem de TAMANHO e COR, não de caixa alta e peso.
//   2. Dois pesos só: normal (400) e medium/semibold. `font-black` sai de cena.
//
// Caixa alta fica reservada a sigla (CNPJ, CPF) — nunca a frase.

export const tipo = {
  // Título da tela.
  titulo: 'text-lg font-semibold text-slate-900 tracking-tight',

  // Título de bloco/cartão dentro da tela.
  secao: 'text-sm font-semibold text-slate-900',

  // Nome do item numa lista — o que a pessoa está procurando. Domina a linha.
  item: 'text-sm font-medium text-slate-900',

  // Linha de apoio do item (gerente, vencimento).
  apoio: 'text-[13px] text-slate-500',

  // Rótulo de campo e cabeçalho de tabela. Sem caixa alta, sem tracking.
  rotulo: 'text-xs font-medium text-slate-500',

  // Texto auxiliar (ajuda sob um campo, contagem de resultados).
  auxiliar: 'text-xs text-slate-400',

  // Número em destaque (cards de métrica). tabular-nums para não dançar.
  numero: 'text-2xl font-semibold text-slate-900 tabular-nums',
};

// Dois raios só, no lugar dos sete que conviviam (lg, xl, 2xl, 3xl, 2rem, 2.5rem, full).
export const raio = {
  controle: 'rounded-lg',   // botão, campo, selo
  cartao: 'rounded-xl',     // painel, cartão, modal
};
