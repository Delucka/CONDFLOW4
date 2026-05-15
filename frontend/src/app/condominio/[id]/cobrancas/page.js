'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import StatusBadge from '@/components/StatusBadge';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { Receipt, FileText, UploadCloud, Trash2, ArrowLeft, Lock, Timer } from 'lucide-react';
import Link from 'next/link';
import { usePipelineConfig } from '@/lib/usePipelineConfig';

export default function CobrancasPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { addToast } = useToast();

  const condoId = params.id;
  const [data, setData] = useState({ condo: null, cobrancas: [], arquivos: [], processo: null });
  const [loading, setLoading] = useState(true);
  
  // Form estado
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function carregar() {
      try {
        setLoading(true);
        const supabase = createClient();
        
        // Fetch Condo, Cobrancas, and Processo in parallel
        const [ { data: condo }, { data: cobrancas }, { data: processo } ] = await Promise.all([
          supabase.from('condominios').select('*').eq('id', condoId).single(),
          supabase.from('cobrancas_extras').select('*').eq('condominio_id', condoId).order('created_at', { ascending: false }),
          supabase.from('processos').select('*').eq('condominio_id', condoId).order('year', { ascending: false }).limit(1).maybeSingle()
        ]);

        setData({ condo, cobrancas: cobrancas || [], arquivos: [], processo });
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [condoId, addToast]);

  // Pipeline config — auto-bloqueio por prazo
  const anoProcesso = data.processo?.year || new Date().getFullYear();
  const { config: pipelineConfig } = usePipelineConfig(anoProcesso);
  const agora = new Date();
  const prazoFim = pipelineConfig?.prazo_edicao ? new Date(pipelineConfig.prazo_edicao) : null;
  const prazoIni = pipelineConfig?.data_inicio  ? new Date(pipelineConfig.data_inicio)  : null;
  const periodoAtivo = !prazoFim || ((!prazoIni || agora >= prazoIni) && agora <= prazoFim);
  const prazoExpirado = prazoFim && agora > prazoFim;

  // Edição em nível de página — fluxo semestral.
  // O lock por MÊS é aplicado individualmente no modal de lançamento (carteiras/cobrancas)
  // e na própria planilha (arrecadações), via useLockedMonths.
  const canEdit = user?.role === 'master' || (
    periodoAtivo &&
    ['Em edição', 'Solicitar alteração', 'Edição finalizada'].includes(data.processo?.status)
  );

  async function handleAdd(e) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { data: newCob, error } = await supabase.from('cobrancas_extras').insert([{
        condominio_id: condoId,
        description: descricao,
        amount: parseFloat(valor.replace(',', '.')) || 0,
        month_ref: new Date().toISOString().substring(0, 7) // Default to current month
      }]).select().single();

      if (error) throw error;

      addToast('Cobrança extra adicionada!');
      setDescricao('');
      setValor('');
      
      setData(prev => ({ ...prev, cobrancas: [newCob, ...prev.cobrancas] }));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id) {
    if(!confirm('Remover cobrança?')) return;
    try {
      const supabase = createClient();
      const { error } = await supabase.from('cobrancas_extras').delete().eq('id', id);
      if (error) throw error;

      addToast('Cobrança removida!');
      setData(prev => ({ ...prev, cobrancas: prev.cobrancas.filter(c => c.id !== id) }));
    } catch(err) {
      addToast(err.message, 'error');
    }
  }

  if (loading) return <div className="flex w-full justify-center p-20"><div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div></div>;

  return (
    <div className="animate-fade-in w-full h-full relative">
      <div className="flex gap-4 items-center mb-6">
        <Link href={`/condominio/${condoId}/arrecadacoes`} className="bg-slate-800 p-2 rounded-lg hover:bg-slate-700 transition">
          <ArrowLeft className="w-5 h-5 text-slate-400" />
        </Link>
        <StatusBadge status={data.processo?.status} flow="processo" />
      </div>

      {/* Banner bloqueio (prazo expirado OU edição finalizada) */}
      {!canEdit && (
        <div className="mb-6 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
          <Lock className="w-4 h-4 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-black uppercase tracking-widest">Cobranças extras bloqueadas</p>
            <p className="text-[11px] text-rose-400/80">
              {prazoExpirado
                ? `Prazo encerrado em ${prazoFim?.toLocaleString('pt-BR')}.`
                : user?.role === 'master'
                  ? 'A planilha foi bloqueada para a emissão. Para destravar, abra o cadeado na Central de Emissões.'
                  : 'Nenhuma cobrança pode ser adicionada ou removida durante a emissão.'}
            </p>
          </div>
        </div>
      )}

      {/* Banner prazo ativo (informativo) */}
      {periodoAtivo && prazoFim && user?.role !== 'master' && (
        <div className="mb-4 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-amber-300">
          <Timer className="w-4 h-4 shrink-0" />
          <p className="text-[11px]">
            Prazo para devolução: <span className="font-black">{prazoFim.toLocaleString('pt-BR')}</span>
          </p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Formulário */}
        {canEdit && (
          <form onSubmit={handleAdd} className="bg-slate-900 border border-slate-800 shadow-xl rounded-xl p-6 relative overflow-hidden">
            <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <PlusCircle className="w-4 h-4 text-orange-500" /> Adicionar Cobrança
            </h4>
            
            <div className="space-y-4">
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Descrição</label>
                <input required value={descricao} onChange={e => setDescricao(e.target.value)}
                       className="w-full bg-slate-800 rounded-lg p-2 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-orange-500" />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase">Valor (R$)</label>
                <input required value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                       className="w-full bg-slate-800 rounded-lg p-2 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-orange-500" />
              </div>
              <button disabled={submitting} type="submit"
                      className="w-full py-2 bg-orange-500 text-slate-900 font-bold text-sm rounded-lg hover:bg-orange-400 transition-colors">
                {submitting ? 'Adicionando...' : 'Adicionar'}
              </button>
            </div>
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-bl-[100px] pointer-events-none" />
          </form>
        )}

        {/* Lista */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="p-4 bg-slate-800/50 border-b border-slate-800">
            <h3 className="text-sm font-bold text-slate-200">Lista de Cobranças</h3>
          </div>
          <div className="divide-y divide-slate-800/50 max-h-[400px] overflow-y-auto">
            {data.cobrancas.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Nenhuma cobrança inserida.</div>
            ) : (
              data.cobrancas.map(cb => (
                <div key={cb.id} className="p-4 flex justify-between items-center hover:bg-slate-800/30">
                  <div>
                    <h4 className="text-sm font-bold text-slate-300">{cb.description}</h4>
                    <span className="text-[10px] text-slate-500">{new Date(cb.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-4 items-center">
                    <span className="text-sm font-black text-orange-400">R$ {cb.amount}</span>
                    {canEdit && (
                      <button onClick={() => handleRemove(cb.id)} className="text-slate-500 hover:text-red-400">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// Dummy icon for import that missed above
function PlusCircle({className}) { return <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
