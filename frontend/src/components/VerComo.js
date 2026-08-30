'use client';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/roles';
import { Eye, X } from 'lucide-react';

/**
 * "Ver como" — o master olha o app pelos olhos de outro papel.
 *
 * Existe porque a alternativa é pior. Para conferir a tela da expedição alguém
 * precisava VIRAR expedição, e criar esse login por cima do e-mail do master
 * trocou o papel do único master do sistema — que então não tinha mais como
 * desfazer. Aqui é um clique, reversível, sem tocar em cadastro.
 *
 * O que este modo é, e o que NÃO é:
 *
 *   É   — a tela que aquele papel vê: menus, abas, botões, guardas de rota.
 *   NÃO — a permissão daquele papel. O servidor continua vendo um master, então
 *         uma escrita feita aqui passa, e as consultas voltam com tudo.
 *
 * Por isso a tarja fica na tela o tempo todo enquanto está ligado: um master
 * que esquecesse o modo poderia jurar que perdeu acesso.
 */

// Ordem de quem trabalha com o quê, não alfabética. `outros` fica de fora: é o
// papel de quem não tem permissão nenhuma, e não há tela para prever ali.
const PAPEIS = ['gerente', 'assistente', 'departamento', 'expedicao',
                'supervisora', 'supervisora_contabilidade', 'supervisor_gerentes', 'sindico'];

export default function VerComo() {
  const { papelReal, verComo, setVerComo } = useAuth();
  if (papelReal !== 'master') return null;

  return (
    <>
      <label className="hidden md:flex items-center gap-1.5 shrink-0" title="Ver o app como outro papel vê">
        <Eye className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <span className="sr-only">Ver como</span>
        <select
          value={verComo || ''}
          onChange={e => setVerComo(e.target.value || null)}
          className={`rounded-lg border px-2 py-1 text-xs outline-none transition-colors cursor-pointer ${
            verComo
              ? 'border-amber-400 bg-amber-50 text-amber-900 font-bold'
              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}
        >
          <option value="">Ver como: Master (você)</option>
          {PAPEIS.map(p => (
            <option key={p} value={p}>Ver como: {ROLE_LABELS[p] || p}</option>
          ))}
        </select>
      </label>

      {verComo && (
        <div className="fixed inset-x-0 bottom-0 z-[200] flex justify-center px-3 pb-3 pointer-events-none">
          <div className="pointer-events-auto flex items-center gap-3 rounded-xl border border-amber-400 bg-amber-50 px-4 py-2.5 shadow-lg max-w-[min(100%,640px)]">
            <Eye className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-900 leading-snug">
              <strong>Vendo como {ROLE_LABELS[verComo] || verComo}.</strong>{' '}
              <span className="text-amber-800">
                É a tela desse papel — as permissões continuam as suas de master.
              </span>
            </p>
            <button
              type="button"
              onClick={() => setVerComo(null)}
              className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" /> Voltar ao master
            </button>
          </div>
        </div>
      )}
    </>
  );
}
