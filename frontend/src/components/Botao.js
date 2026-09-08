'use client';
import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { btn, cn } from '@/lib/botoes';

/**
 * O botão do CondoFlow: o estilo é o de `lib/botoes.js`, o comportamento é aqui.
 *
 * O QUE ESTE COMPONENTE NÃO FAZ
 * -----------------------------
 * Não define cor, tamanho nem espaçamento. Isso já existe e está bem resolvido
 * em `lib/botoes.js` — inclusive com decisões que custaram tentativas (o formato
 * contorno, a cor reservada para ESTADO e não decoração, o ícone de tabela densa
 * que errou a mão duas vezes antes). Criar uma segunda paleta ao lado dessa é
 * como um sistema de design apodrece.
 *
 * O que faltava não era estilo, era **comportamento**. Medido no app publicado:
 * 498 botões, 411 chamadas de `addToast` e só 81 com estado de carregando. O app
 * conta muito bem o que ACONTECEU e quase nunca diz que está ACONTECENDO — e é
 * nesse silêncio que o usuário clica de novo.
 *
 * O QUE ELE ACRESCENTA
 * --------------------
 * - **Spinner sem pular a largura.** O `Loader2` entra no lugar do ícone, do
 *   mesmo tamanho. Trocar o rótulo por "Salvando…" alarga o botão e o mouse do
 *   usuário fica apontando para o lugar errado — por isso `rotuloCarregando` é
 *   opt-in, para ações longas onde avisar vale mais que manter a régua.
 * - **`aria-busy`**, senão quem não enxerga o spinner não sabe que algo corre.
 * - **Trava enquanto roda**, sem precisar lembrar de somar `carregando` ao
 *   `disabled` em cada chamada.
 *
 * Uso:
 *     <Botao variante="primario" icone={Save} carregando={salvando}>Salvar</Botao>
 *     <Botao variante="icone" icone={Eye} carregando={abrindo} aria-label="Ver" />
 */

const SO_ICONE = new Set(['icone', 'iconeDiscreto']);

const Botao = forwardRef(function Botao({
  children,
  icone: Icone,
  variante = 'secundario',
  carregando = false,
  rotuloCarregando,
  disabled = false,
  className,
  type = 'button',
  ...resto
}, ref) {
  const estilo = btn[variante] || btn.secundario;
  // Nos botões de tabela densa o ícone é menor; nos demais segue o padrão.
  const tamIcone = variante === 'iconeDiscreto' ? 'w-4 h-4' : 'w-4 h-4';

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || carregando}
      aria-busy={carregando || undefined}
      className={cn(estilo, className)}
      {...resto}
    >
      {carregando
        ? <Loader2 className={cn(tamIcone, 'shrink-0 motion-safe:animate-spin')} aria-hidden="true" />
        : (Icone ? <Icone className={cn(tamIcone, 'shrink-0')} aria-hidden="true" /> : null)}
      {SO_ICONE.has(variante)
        ? null
        : (carregando && rotuloCarregando ? rotuloCarregando : children)}
    </button>
  );
});

export default Botao;
