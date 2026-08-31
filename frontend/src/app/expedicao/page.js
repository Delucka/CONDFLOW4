'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Printer, BarChart3 } from 'lucide-react';
import RelatorioExpedicao from '@/components/RelatorioExpedicao';

/**
 * Expedição — porta própria no menu, com duas visões.
 *
 * A FILA é a tela de trabalho e abre primeiro: o que imprimir hoje. O RELATÓRIO
 * é consulta — quando cada remessa chegou e quando saiu impressa — e fica atrás
 * de um clique para não empurrar a fila para baixo da dobra.
 *
 * A fila também vive como aba da Central de Emissões, para quem emite: são duas
 * portas para a mesma sala. O relatório é o mesmo componente que a gestão vê na
 * Central de Relatórios; muda só o recorte, que vem do papel de quem entrou.
 */

const Expedicao = dynamic(
  () => import('@/app/central-emissoes/components/Expedicao'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    ),
  },
);

const VISOES = [
  { id: 'fila', rotulo: 'Fila', icone: Printer },
  { id: 'relatorio', rotulo: 'Relatório', icone: BarChart3 },
];

export default function ExpedicaoPage() {
  const [visao, setVisao] = useState('fila');

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="tablist" aria-label="Visões da expedição">
        {VISOES.map(({ id, rotulo, icone: Icone }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={visao === id}
            onClick={() => setVisao(id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-colors ${
              visao === id
                ? 'bg-violet-600 text-white'
                : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100'}`}
          >
            <Icone className="w-4 h-4" aria-hidden="true" />
            {rotulo}
          </button>
        ))}
      </div>

      {visao === 'fila' ? <Expedicao /> : <RelatorioExpedicao />}
    </div>
  );
}
