'use client';
import { AlertTriangle } from 'lucide-react';

/**
 * Tag "Prioritário" (0096) — aparece em toda tela que lista condomínio.
 *
 * Duas informações, ambas opcionais, e ter qualquer uma já torna o condomínio
 * prioritário:
 *   prazo_expedicao_dia — dia limite de ENTREGA, todo mês
 *   prioridade_motivo   — por que, escrito por quem sabe
 *
 * O motivo importa tanto quanto o prazo. "Prioritário" sozinho vira ruído que
 * todo mundo aprende a ignorar; "prioritário porque o síndico cobra no dia 18"
 * é instrução. Por isso o motivo vai no title, sempre visível ao passar o mouse.
 *
 * A cor conta quanto falta, porque "dia 20" em pé não diz nada:
 *   âmbar    — falta pouco, ou não há prazo (só motivo)
 *   vermelho — passou do dia
 *   neutro   — ainda há folga
 *
 * Só conta os dias no mês corrente. Em mês futuro daria "faltam 45 dias"
 * (ruído); em mês passado marcaria como atrasado tudo que saiu no prazo.
 */
export default function TagPrioritario({ condo, mes, ano, className = '' }) {
  const dia = condo?.prazo_expedicao_dia ?? null;
  const motivo = (condo?.prioridade_motivo || '').trim();
  if (!dia && !motivo) return null;

  const hoje = new Date();
  const noMesCorrente = mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
  const restam = dia && noMesCorrente ? dia - hoje.getDate() : null;

  const vencido = restam !== null && restam < 0;
  const apertando = restam !== null && restam >= 0 && restam <= 3;

  const tom = vencido
    ? 'border-rose-300 bg-rose-50 text-rose-800'
    : apertando
      ? 'border-amber-300 bg-amber-50 text-amber-900'
      : 'border-amber-200 bg-amber-50 text-amber-800';

  const sufixo = !dia ? ''
    : vencido ? ' · atrasado'
    : restam === 0 ? ' · hoje'
    : apertando ? ` · ${restam}d`
    : '';

  const titulo = [
    dia ? `Entregar até o dia ${dia} de cada mês.` : 'Condomínio prioritário.',
    motivo || null,
  ].filter(Boolean).join(' ');

  return (
    <span
      title={titulo}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${tom} ${className}`}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      {dia ? `Prazo dia ${dia}` : 'Prioritário'}{sufixo}
    </span>
  );
}

/** É prioritário? Uma regra só, para as telas não divergirem. */
export function ehPrioritario(condo) {
  return !!(condo?.prazo_expedicao_dia || (condo?.prioridade_motivo || '').trim());
}
