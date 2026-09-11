'use client';
import { useMemo } from 'react';
import { diasDeVencimento } from '@/lib/vencimento';

/**
 * Seletor "Vence dia …" — oferece só os dias que existem na lista que a tela
 * está mostrando. Um "dia 31" que não acha nada ensina que o filtro não funciona.
 *
 * O visual vem de quem chama (`className`): cada tela já tem o seu tamanho de
 * controle, e este seletor precisa parecer irmão do filtro de gerente ao lado.
 */
export default function FiltroVencimento({ itens, value, onChange, pegar, className = '' }) {
  const { dias, temSem } = useMemo(() => diasDeVencimento(itens, pegar), [itens, pegar]);

  // Nenhum vencimento na lista: não há o que filtrar. Mas se já havia um
  // filtro escolhido, o seletor fica — senão ele some e ninguém desfaz.
  if (!dias.length && !temSem && !value) return null;

  // O dia escolhido pode sumir da lista quando outro filtro muda (troca de
  // gerente, de mês). Ele continua como opção para o seletor não mentir.
  const orfao = value && value !== 'sem' && !dias.includes(Number(value));

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filtrar por vencimento"
      className={className}
    >
      <option value="">Todos os vencimentos</option>
      {dias.map((d) => (
        <option key={d} value={String(d)}>Vence dia {d}</option>
      ))}
      {orfao && <option value={value}>Vence dia {value}</option>}
      {temSem && <option value="sem">Sem vencimento</option>}
    </select>
  );
}
