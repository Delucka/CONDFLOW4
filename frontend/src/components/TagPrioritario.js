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
 *
 * Com `onEditar`, a tag vira botão: quem vê que o prazo mudou corrige ali, na
 * tela em que está. Sem isso, o motivo só existia no title e corrigir exigia
 * sair, achar o condomínio na lista e abrir outro painel.
 */
export default function TagPrioritario({ condo, mes, ano, className = '', onEditar }) {
  const dia = condo?.prazo_expedicao_dia ?? null;
  const motivo = (condo?.prioridade_motivo || '').trim();
  if (!dia && !motivo) return null;

  const hoje = new Date();
  const noMesCorrente = mes === hoje.getMonth() + 1 && ano === hoje.getFullYear();
  const restam = dia && noMesCorrente ? dia - hoje.getDate() : null;

  const vencido = restam !== null && restam < 0;
  const apertando = restam !== null && restam >= 0 && restam <= 3;

  // Vermelho SÓLIDO — a única coisa colorida diferente na linha. Os rótulos
  // (consumo, grupo, parcela) são navy de contorno, como o resto do app; esta é
  // a única que pede ação, então é a única que destoa.
  //
  // Dois reforços somados: matiz oposto ao navy, e preenchimento sólido contra
  // pílulas de contorno. Forma separa mesmo quando a cor não separa — daltonismo,
  // tela ruim, print em preto e branco.
  //
  // A urgência muda a densidade, não o tom. Um vermelho que fica mais forte lê
  // como escala; três cores diferentes leriam como enfeite.
  const tom = vencido
    ? 'border-rose-700 bg-rose-700 text-white'
    : apertando
      ? 'border-rose-600 bg-rose-600 text-white'
      : 'border-rose-500 bg-rose-500 text-white';

  const sufixo = !dia ? ''
    : vencido ? ' · atrasado'
    : restam === 0 ? ' · hoje'
    : apertando ? ` · ${restam}d`
    : '';

  const titulo = [
    dia ? `Entregar até o dia ${dia} de cada mês.` : 'Condomínio prioritário.',
    motivo || null,
  ].filter(Boolean).join(' ');

  const conteudo = (
    <>
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      {dia ? `Prazo dia ${dia}` : 'Prioritário'}{sufixo}
    </>
  );
  const base = `inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${tom} ${className}`;

  if (!onEditar) {
    return <span title={titulo} className={base}>{conteudo}</span>;
  }

  return (
    <button
      type="button"
      title={`${titulo} (clique para editar)`}
      // stopPropagation: a tag costuma ficar dentro de linha clicável — sem isto,
      // editar a prioridade também abriria a emissão por baixo.
      onClick={(e) => { e.stopPropagation(); e.preventDefault(); onEditar(condo); }}
      className={`${base} cursor-pointer hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300`}
    >
      {conteudo}
    </button>
  );
}

/** É prioritário? Uma regra só, para as telas não divergirem. */
export function ehPrioritario(condo) {
  return !!(condo?.prazo_expedicao_dia || (condo?.prioridade_motivo || '').trim());
}
