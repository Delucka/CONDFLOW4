'use client';
import { CalendarClock } from 'lucide-react';

/**
 * Selo do grupo de emissão (0086).
 *
 * Só aparece quando o pacote tem grupo. Nos 277 condomínios de vencimento único
 * ele fica invisível — pôr "Geral" em toda emissão seria ruído em 90% da tela.
 * Onde importa (duas emissões do mesmo condomínio no mesmo mês, lado a lado) é
 * a única coisa que as distingue.
 */
export default function SeloGrupo({ pacote, className = '' }) {
  const nome = pacote?.grupo_nome;
  if (!nome) return null;
  const dia = pacote.grupo_due_day;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ${className}`}
      title={dia ? `Grupo "${nome}" — boletos vencem dia ${dia}` : `Grupo "${nome}"`}
    >
      <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
      {nome}{dia ? ` · dia ${dia}` : ''}
    </span>
  );
}
