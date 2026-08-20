'use client';
import { Ban } from 'lucide-react';

/**
 * O selo de emissão cancelada — o mesmo em toda tela.
 *
 * A emissão cancelada não é apagada: ela fica no sistema porque o erro que a
 * motivou é o que alguém vai querer entender depois. Só que "ficar" não basta —
 * ela precisa se anunciar em cada lugar onde aparece: no anexo, na aprovação,
 * no histórico do condomínio e no arquivo.
 *
 * Um componente só, em vez de repetir a marcação em cada tela, porque marca que
 * diverge entre telas deixa de ser marca: vira ruído que cada um interpreta de
 * um jeito.
 *
 * `motivo` é opcional para caber em linha estreita — mas quando há espaço, ele
 * é o mais importante. O selo diz que foi cancelada; o motivo diz por quê, que
 * é a pergunta seguinte.
 */
export default function SeloCancelada({ pacote, mostrarMotivo = true, className = '' }) {
  if ((pacote?.status || '').toLowerCase() !== 'cancelada') return null;

  const quando = pacote.mes_referencia
    ? ` · ${String(pacote.mes_referencia).padStart(2, '0')}/${pacote.ano_referencia}`
    : '';

  return (
    <span className={`inline-flex flex-col gap-0.5 ${className}`}>
      <span
        title={pacote.cancelamento_motivo || 'Emissão cancelada'}
        className="inline-flex w-max items-center gap-1 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white"
      >
        <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />
        Cancelada{quando}
      </span>

      {mostrarMotivo && pacote.cancelamento_motivo && (
        <span className="text-[11px] font-normal normal-case text-slate-600 border-l-2 border-rose-300 pl-2">
          {pacote.cancelada_por_nome ? `${pacote.cancelada_por_nome}: ` : ''}
          {pacote.cancelamento_motivo}
          {pacote.substituida_por && (
            <span className="block text-[10px] text-violet-600">
              uma nova emissão foi aberta no lugar
            </span>
          )}
        </span>
      )}
    </span>
  );
}
