'use client';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

/**
 * O botão do CondoFlow — o mesmo de sempre, mas que responde.
 *
 * POR QUE ELE EXISTE
 * ------------------
 * São 498 botões no app e nenhum componente compartilhado. O resultado, medido:
 * 411 chamadas de `addToast` contra 81 botões com estado de carregando. O app
 * conta muito bem o que ACONTECEU e quase nunca diz que está ACONTECENDO — e no
 * meio disso o usuário clica de novo, porque nada mudou na tela.
 *
 * O QUE OS BONS FAZEM (conferido no CSS deles em 07/09/2026)
 * ----------------------------------------------------------
 * O Primer, do GitHub, tem 41 regras de `:active`, 49 de `focus-visible` e 46
 * de `:disabled`. O Linear transiciona `background` em 160 ms. Nos dois,
 * **zero** `transform` no `:active` — ninguém encolhe o botão. O que existe é:
 *
 *   1. cor de fundo própria no pressionado;
 *   2. anel de foco só para quem navega por teclado
 *      (`:focus:not(:focus-visible)` remove o anel do clique de mouse);
 *   3. disabled com cursor e cor próprios, não só opacidade;
 *   4. transição curta, e só na cor.
 *
 * A LARGURA NÃO PODE PULAR. O `Loader2` entra no lugar do ícone, com o mesmo
 * tamanho — trocar o rótulo por "Salvando…" alarga o botão e o mouse do usuário
 * fica apontando para o lugar errado. Por isso `rotuloCarregando` é opt-in, para
 * ações longas onde vale mais avisar do que manter a régua.
 *
 * VISUAL IDÊNTICO ao que já existe: as classes saíram dos botões que o projeto
 * já tinha (`rounded-xl`, `text-[11px] font-black uppercase tracking-wider`,
 * `violet-600` que no `globals.css` é NAVY). Trocar um `<button>` por este não
 * muda o desenho — só acrescenta os estados que faltavam.
 */

const TONS = {
  primario: 'bg-violet-600 text-white hover:bg-violet-500 active:bg-violet-700 '
    + 'disabled:hover:bg-violet-600 focus-visible:ring-violet-500/50',
  secundario: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 '
    + 'active:bg-slate-200 disabled:hover:bg-white focus-visible:ring-slate-400/50',
  perigo: 'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700 '
    + 'disabled:hover:bg-rose-600 focus-visible:ring-rose-500/50',
  sucesso: 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700 '
    + 'disabled:hover:bg-emerald-600 focus-visible:ring-emerald-500/50',
  fantasma: 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 active:bg-slate-200 '
    + 'disabled:hover:bg-transparent focus-visible:ring-slate-400/50',
};

const TAMANHOS = {
  sm: 'px-3 py-1.5 text-[10px] gap-1.5',
  md: 'px-4 py-2 text-[11px] gap-2',
  lg: 'px-5 py-2.5 text-xs gap-2',
};

const ICONE = { sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-4 h-4' };

const Botao = forwardRef(function Botao({
  children,
  icone: Icone,
  tom = 'primario',
  tamanho = 'md',
  carregando = false,
  rotuloCarregando,
  disabled = false,
  className = '',
  type = 'button',
  ...resto
}, ref) {
  const travado = disabled || carregando;
  const tamIcone = ICONE[tamanho] || ICONE.md;

  return (
    <button
      ref={ref}
      type={type}
      disabled={travado}
      // `aria-busy` é o que o leitor de tela usa para anunciar "ocupado". Sem
      // isso, quem não enxerga o spinner não sabe que a ação está em curso.
      aria-busy={carregando || undefined}
      className={[
        'inline-flex items-center justify-center rounded-xl font-black uppercase tracking-wider',
        'transition-colors duration-150',
        // Anel só para teclado. Quem clica com o mouse não vê nada — é o
        // `:focus:not(:focus-visible)` do Primer, escrito do jeito do Tailwind.
        'outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        // Disabled de verdade: cursor muda, hover morre, e o `motion-safe`
        // deixa o spinner parado para quem pediu menos movimento.
        'disabled:opacity-40 disabled:cursor-not-allowed',
        TAMANHOS[tamanho] || TAMANHOS.md,
        TONS[tom] || TONS.primario,
        className,
      ].join(' ')}
      {...resto}
    >
      {carregando
        ? <Loader2 className={`${tamIcone} shrink-0 motion-safe:animate-spin`} aria-hidden="true" />
        : (Icone ? <Icone className={`${tamIcone} shrink-0`} aria-hidden="true" /> : null)}
      {carregando && rotuloCarregando ? rotuloCarregando : children}
    </button>
  );
});

export default Botao;
