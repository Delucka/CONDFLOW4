'use client';
import { useState, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { combina } from '@/lib/busca';
import Modal from '@/components/Modal';
import { AlertTriangle, Search, Loader2, X, Check } from 'lucide-react';
import { ehPrioritario } from '@/components/TagPrioritario';

/**
 * Marca prioridade em vários condomínios de uma vez.
 *
 * O cadastro um a um serve para corrigir um caso; não serve para dizer "estes
 * 40 têm prazo dia 20". Com 300 condomínios, abrir cada ficha é o tipo de
 * trabalho que ninguém faz — e a informação continua na cabeça das pessoas,
 * que é justamente o que a tag veio resolver.
 *
 * Escreve direto no Supabase, não pelo endpoint de salvar condomínio: aquele
 * grava a ficha INTEIRA, e mandar 40 fichas completas para mudar dois campos
 * arrisca sobrescrever o que outra pessoa acabou de editar.
 */
export default function PainelPrioridades({ open, onClose, condominios, onSalvo }) {
  const supabase = useMemo(() => createClient(), []);
  const { addToast } = useToast();

  const [busca, setBusca] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [dia, setDia] = useState('');
  const [motivo, setMotivo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [soPrioritarios, setSoPrioritarios] = useState(false);

  const lista = useMemo(() => {
    const q = busca.trim();
    return (condominios || [])
      .filter(c => !soPrioritarios || ehPrioritario(c))
      .filter(c => !q || combina(q, c.name))
      .slice(0, 400);
  }, [condominios, busca, soPrioritarios]);

  const marcados = sel.size;

  function alternar(id) {
    setSel(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  // Marca/desmarca o que está VISÍVEL, não a base inteira: com a busca ativa,
  // "todos" tem que significar o que a pessoa está vendo.
  function alternarVisiveis() {
    const ids = lista.map(c => c.id);
    const todosMarcados = ids.every(id => sel.has(id));
    setSel(prev => {
      const n = new Set(prev);
      ids.forEach(id => (todosMarcados ? n.delete(id) : n.add(id)));
      return n;
    });
  }

  async function aplicar(limpar) {
    if (!marcados) return;
    const d = dia === '' ? null : parseInt(dia, 10);
    if (!limpar) {
      if (d !== null && (Number.isNaN(d) || d < 1 || d > 31)) {
        addToast('O dia precisa ser entre 1 e 31.', 'error'); return;
      }
      if (d === null && !motivo.trim()) {
        addToast('Informe o dia, o motivo, ou os dois.', 'error'); return;
      }
    }

    setSalvando(true);
    try {
      const payload = limpar
        ? { prazo_expedicao_dia: null, prioridade_motivo: null }
        : { prazo_expedicao_dia: d, prioridade_motivo: motivo.trim() || null };

      // Confere o erro: supabase-js DEVOLVE {error}, não lança.
      const { error } = await supabase.from('condominios')
        .update(payload).in('id', [...sel]);
      if (error) throw error;

      addToast(limpar
        ? `Prioridade removida de ${marcados} condomínio${marcados > 1 ? 's' : ''}.`
        : `${marcados} condomínio${marcados > 1 ? 's' : ''} marcado${marcados > 1 ? 's' : ''} como prioritário.`, 'success');
      setSel(new Set());
      onSalvo?.();
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('PGRST204')) {
        addToast('O banco ainda não tem as colunas de prioridade. Rode a migration 0096.', 'error');
      } else {
        addToast('Não consegui salvar: ' + msg, 'error');
      }
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Prioridade dos condomínios" maxWidth="max-w-3xl">
      <div className="space-y-4">
        <p className="text-xs text-slate-500 leading-relaxed">
          Escolha os condomínios, escreva o prazo de entrega e o motivo, e aplique a todos de uma vez.
          O motivo aparece ao passar o mouse na tag, no painel e na emissão — é ele que faz a tag valer
          alguma coisa para quem não estava na conversa.
        </p>

        {/* Campos primeiro: é o que a pessoa veio fazer. */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <label htmlFor="pri-dia" className="text-sm text-slate-600 shrink-0">Entregar até o dia</label>
            <input id="pri-dia" type="number" min="1" max="31" inputMode="numeric" placeholder="—"
              value={dia} onChange={e => setDia(e.target.value)}
              className="w-20 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500" />
            <span className="text-xs text-slate-400">deixe vazio se a prioridade não tem data</span>
          </div>
          <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)}
            aria-label="Por que é prioritário"
            placeholder="Por que é prioritário. Ex.: síndico cobra a entrega no dia 18"
            className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500 resize-y" />
        </div>

        {/* Seleção */}
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input value={busca} onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome ou código" aria-label="Buscar condomínio"
              className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500" />
          </div>
          <button type="button" onClick={() => setSoPrioritarios(v => !v)} aria-pressed={soPrioritarios}
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
              soPrioritarios ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
            Só prioritários
          </button>
          <button type="button" onClick={alternarVisiveis}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors">
            Marcar visíveis
          </button>
        </div>

        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
          {lista.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">Nenhum condomínio encontrado.</p>
          ) : lista.map(c => {
            const marcado = sel.has(c.id);
            const jaTem = ehPrioritario(c);
            return (
              <label key={c.id}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${marcado ? 'bg-violet-50' : 'hover:bg-slate-50'}`}>
                <input type="checkbox" checked={marcado} onChange={() => alternar(c.id)}
                  className="w-4 h-4 accent-violet-600 shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">{c.name}</span>
                {jaTem && (
                  <span className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                        title={c.prioridade_motivo || undefined}>
                    {c.prazo_expedicao_dia ? `dia ${c.prazo_expedicao_dia}` : 'prioritário'}
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
          <span className="text-xs text-slate-500">
            {marcados ? `${marcados} selecionado${marcados > 1 ? 's' : ''}` : 'Nenhum selecionado'}
            {marcados > 0 && (
              <button type="button" onClick={() => setSel(new Set())}
                className="ml-2 text-slate-400 hover:text-slate-700 underline decoration-dotted">
                limpar
              </button>
            )}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => aplicar(true)} disabled={!marcados || salvando}
              title="Tira a prioridade dos selecionados"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40">
              <X className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />Remover prioridade
            </button>
            <button type="button" onClick={() => aplicar(false)} disabled={!marcados || salvando}
              className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white hover:bg-violet-700 transition-colors disabled:opacity-40">
              {salvando ? <Loader2 className="w-3.5 h-3.5 inline animate-spin mr-1" /> : <Check className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />}
              Aplicar a {marcados || 0}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
