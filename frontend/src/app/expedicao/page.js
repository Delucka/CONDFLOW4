'use client';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

/**
 * Expedição — porta própria no menu.
 *
 * A fila já existia como aba dentro da Central de Emissões, e continua lá: quem
 * emite trabalha nas duas telas e trocar de aba é mais rápido do que trocar de
 * página. O que faltava era a porta pelo menu, ao lado das outras — a expedição
 * é um departamento, não uma aba de outro.
 *
 * O componente é o mesmo, montado nos dois lugares. `ssr: false` porque ele lê
 * o Supabase direto do navegador, como as outras telas da Central.
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

export default function ExpedicaoPage() {
  return <Expedicao />;
}
