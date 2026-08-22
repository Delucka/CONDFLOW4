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

/**
 * A marca d'água atravessando o cartão da emissão cancelada.
 *
 * O selo diz "cancelada" a quem lê a linha inteira. A marca d'água diz a quem
 * só passa o olho — e é assim que a maioria olha uma lista de 56 emissões.
 *
 * O elemento é decorativo: `aria-hidden` para não repetir a palavra em leitor
 * de tela (o selo já a diz) e `pointer-events-none` para não roubar o clique
 * dos botões que ficam por cima.
 *
 * Quem usa precisa de duas coisas no container: `relative` e `overflow-hidden`
 * — e o conteúdo por cima precisa de `relative`, senão o texto em fluxo pinta
 * ABAIXO de um elemento posicionado, e a marca d'água cobre a linha.
 */
export function MarcaDaguaCancelada({ texto = 'Cancelada' }) {
  return (
    <span
      aria-hidden="true"
      className="marca-dagua-cancelada pointer-events-none absolute inset-0 z-0 flex select-none items-center justify-center overflow-hidden"
    >
      <span className="-rotate-12 whitespace-nowrap text-5xl font-black uppercase tracking-[0.25em] sm:text-6xl">
        {texto}
      </span>
    </span>
  );
}

/**
 * O aviso que fica ACIMA da linha do condomínio no mês.
 *
 * A emissão cancelada e a que a substituiu são duas linhas diferentes, e nada
 * dizia que uma tem a ver com a outra. Quem abre setembro precisa saber, antes
 * de agir, que aquele condomínio já teve uma emissão descartada no mês — senão
 * refaz a análise sem o motivo, que é justamente o que ficou guardado.
 *
 * `onVer` leva à cancelada. Sem ele, o aviso é só aviso.
 */
export function AvisoCanceladas({ canceladas = [], onVer, className = '' }) {
  const n = canceladas.length;
  if (!n) return null;

  const primeira = canceladas[0];
  const motivo = canceladas.length === 1 ? primeira?.cancelamento_motivo : null;

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-1.5 ${className}`}
    >
      <Ban className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden="true" />
      <span className="text-[11px] font-black uppercase tracking-wider text-rose-700">
        {n === 1 ? 'Há emissão cancelada neste mês' : `Há ${n} emissões canceladas neste mês`}
      </span>
      {motivo && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={motivo}>
          {primeira.cancelada_por_nome ? `${primeira.cancelada_por_nome}: ` : ''}
          {motivo}
        </span>
      )}
      {onVer && (
        <button
          type="button"
          onClick={() => onVer(primeira)}
          className="ml-auto shrink-0 rounded-md border border-rose-400 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-100"
        >
          Ver a cancelada
        </button>
      )}
    </div>
  );
}
