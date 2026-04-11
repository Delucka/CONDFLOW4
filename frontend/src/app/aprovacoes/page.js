'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  CheckCircle2, AlertCircle, Clock, Search, 
  ArrowRight, MessageSquare, Building2, 
  ChevronRight, Filter, Loader2, X, Send, FileText
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';

export default function AprovacoesPage() {
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // Mapping current user role to the status they should see
  const roleToStatus = {
    'gerente': 'Aguardando Gerente',
    'chefe_gerentes': 'Aguardando Chefe',
    'supervisor': 'Aguardando Supervisor',
    'master': 'all' // Master sees everything that is not 'Em edição' or 'Aprovado'
  };

  const fetchData = async () => {
    if (!profile) return;
    try {
      setLoading(true);
      let query = supabase
        .from('processos')
        .select('*, condominios(name, due_day, gerentes:gerente_id(profiles(full_name)))');
      
      const targetStatus = roleToStatus[profile.role];
      if (targetStatus && targetStatus !== 'all') {
        query = query.eq('status', targetStatus);
      } else if (targetStatus === 'all') {
        query = query.in('status', ['Aguardando Gerente', 'Aguardando Chefe', 'Aguardando Supervisor']);
      } else {
        // If role not recognized, don't show anything sensitive
        setItems([]);
        setLoading(false);
        return;
      }

      const { data } = await query.order('updated_at', { ascending: false });
      setItems(data || []);
    } catch (err) {
      addToast('Erro ao carregar aprovações', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profile]);

  const handleAction = async (processo, action) => {
    try {
      setProcessing(processo.id);
      let nextStatus = '';

      if (action === 'approve') {
        if (processo.status === 'Aguardando Gerente') {
          nextStatus = 'Aguardando Supervisor';
        } else if (processo.status === 'Aguardando Chefe') {
          nextStatus = 'Aguardando Supervisor';
        } else if (processo.status === 'Aguardando Supervisor') {
          nextStatus = 'Aprovado';
        }
      } else {
        // Reject - always goes back to emissor
        nextStatus = 'Solicitar alteração';
      }

      const { error } = await supabase
        .from('processos')
        .update({ 
          status: nextStatus,
          issue_notes: action === 'reject' ? rejectReason : processo.issue_notes 
        })
        .eq('id', processo.id);

      if (error) throw error;

      addToast(action === 'approve' ? 'Processo aprovado!' : 'Solicitação de alteração enviada.', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      fetchData();
    } catch (err) {
      addToast('Erro ao processar ação: ' + err.message, 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 animate-fade-in">
        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin mb-4" />
        <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Carregando fila de aprovações...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-20">
      
      {/* Header */}
      <div className="glass-panel p-8 mb-8 rounded-3xl border-white/5 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
        <div>
            <h1 className="text-3xl font-black text-white uppercase tracking-tight mb-2 italic">Fila de Aprovações</h1>
            <p className="text-slate-400 text-sm font-medium">Validando as emissões por nível de competência.</p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-3xl border-dashed border-white/10">
            <CheckCircle2 className="w-12 h-12 text-slate-800 mx-auto mb-4" />
            <h3 className="text-lg font-black text-slate-400 uppercase tracking-tighter">Tudo em dia por aqui!</h3>
            <p className="text-slate-500 text-xs font-bold mt-1">Não há processos aguardando sua validação no momento.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {items.map((item) => (
            <div key={item.id} className="glass-panel p-6 rounded-3xl border-white/5 group hover:border-cyan-500/30 transition-all flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                <div className="absolute left-0 top-0 bottom-0 w-1 bg-cyan-500/20 group-hover:bg-cyan-500 transition-colors"></div>
                
                <div className="flex items-center gap-6 flex-1">
                    <div className="w-14 h-14 bg-slate-900 rounded-2xl flex items-center justify-center border border-white/5 shrink-0 group-hover:scale-110 transition-transform">
                        <Building2 className="w-6 h-6 text-slate-500 group-hover:text-cyan-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-xl font-black text-white uppercase tracking-tight">{item.condominios?.name}</h3>
                            <StatusBadge status={item.status} />
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5 text-orange-400" />
                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.year}/{item.semester === 1 ? '1º' : '2º'} Semestre</span>
                            </div>
                            <div className="w-[1px] h-3 bg-white/10"></div>
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                Gerente: <span className="text-white">{item.condominios?.gerentes?.profiles?.full_name || '—'}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="text-center md:text-right hidden sm:block">
                        <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Status Atual</p>
                        <StatusBadge status={item.status} />
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <Link 
                            href={`/condominio/${item.condominio_id}/emissoes`}
                            className="p-3 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/10 rounded-xl text-blue-400 hover:text-blue-300 transition-all flex gap-2 items-center"
                            title="Ver Anexos & Emissões"
                        >
                            <FileText className="w-5 h-5" />
                        </Link>
                        
                        <Link 
                            href={`/condominio/${item.condominio_id}/arrecadacoes?ano=${item.year}`}
                            className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all flex gap-2 items-center"
                            title="Revisar Planilha"
                        >
                            <Search className="w-5 h-5" />
                        </Link>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => setShowRejectModal(item)}
                            className="px-6 py-3 bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                        >
                            Corrigir
                        </button>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => handleAction(item, 'approve')}
                            className="px-8 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
                        >
                            {processing === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            Aprovar
                        </button>
                    </div>
                </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setShowRejectModal(null)}></div>
            <div className="glass-panel max-w-lg w-full p-8 rounded-3xl relative animate-fade-up border border-white/5 shadow-2xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center justify-center">
                        <MessageSquare className="w-6 h-6 text-red-400" />
                    </div>
                    <h3 className="text-xl font-black text-white uppercase tracking-tight">Solicitar Correção</h3>
                </div>
                <p className="text-slate-400 text-sm font-medium mb-4">
                    Explique brevemente o que precisa ser ajustado na planilha de <strong>{showRejectModal.condominios?.name}</strong>.
                </p>
                <textarea 
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={4}
                    className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm text-slate-300 focus:border-red-500/50 outline-none transition-all placeholder:text-slate-700 mb-6"
                    placeholder="Ex: Valor do fundo de reserva incorreto no mês de Maio..."
                />
                <div className="flex gap-4">
                    <button onClick={() => setShowRejectModal(null)} className="flex-1 py-4 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors">Voltar</button>
                    <button 
                        onClick={() => handleAction(showRejectModal, 'reject')}
                        className="flex-1 py-4 bg-red-500 hover:bg-red-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all shadow-xl shadow-red-500/20 flex items-center justify-center gap-2 active:scale-95"
                    >
                        <Send className="w-4 h-4" /> Enviar p/ Emissor
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}
