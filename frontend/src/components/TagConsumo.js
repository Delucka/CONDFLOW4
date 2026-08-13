'use client';
import { Droplet } from 'lucide-react';

/**
 * Tag "tem consumo" — água, gás ou energia.
 *
 * Quem emite precisa saber, ANTES de montar, se aquele condomínio depende de
 * fatura e relatório de concessionária. Sem a tag, isso vivia na cabeça de quem
 * faz — e quem entrava novo descobria errando.
 *
 * Navy de contorno, como todo RÓTULO do app: diz o que a coisa é, não pede
 * ação. O vermelho fica reservado para prazo — dois matizes na linha, e o que
 * pede ação é o único que destoa.
 *
 * A decisão de SE tem vem de `condominios.tem_consumo` (0091), a relação que a
 * operação usa. As siglas vêm de `condominios_concessionarias` (0036), que veio
 * de uma planilha de 2025 e nem sempre tem todas — por isso o título degrada
 * para o genérico em vez de mentir uma lista incompleta.
 */
export default function TagConsumo({ concessionarias, className = '' }) {
  const lista = concessionarias || [];
  const titulo = lista.length
    ? `Tem consumo: ${lista.join(', ')}. Precisa de fatura e relatório de leitura.`
    : 'Tem consumo. Precisa de fatura e relatório de leitura.';

  return (
    <span
      title={titulo}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ${className}`}
    >
      <Droplet className="h-3 w-3 shrink-0" aria-hidden="true" />
      Consumo
    </span>
  );
}
