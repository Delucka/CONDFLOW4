'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  CheckCircle2, AlertCircle, Clock, Search, 
  MessageSquare, Building2, 
  Loader2, Send, FileText, History, Inbox
} from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';

export default function AprovacoesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  // SWR para Fila de Aprovações e Histórico
  const { data, error, isLoading, mutate } = useSWR('/api/aprovacoes', apiFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 30000 // 30s
  });

  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      
      addToast(action === 'approve' ? 'Processo aprovado com sucesso!' : 'Solicitação de correção enviada.', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      
      // Revalida os dados do SWR instantaneamente
      mutate();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (error) return (
    <div className="p-20 text-center glass-panel rounded-3xl">
      <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
      <p className="text-white font-bold">Erro ao carregar fila de aprovações</p>
    </div>
  );

  const pendentes = data?.pendentes || [];
  const historico = data?.historico || [];

  return (
    <div className="animate-fade-in space-y-8 pb-20">
      
      {/* Header Informativo */}
      <div className="glass-panel p-10 rounded-[2.5rem] border-white/5 relative overflow-hidden shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full -mr-48 -mt-48 blur-[100px]"></div>
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
                <h1 className="text-4xl font-black text-white uppercase tracking-tighter italic">Central de Validação</h1>
                <p className="text-cyan-400/80 text-sm font-bold tracking-widest mt-2 uppercase">Fila de Aprovações — Alto Fluxo</p>
            </div>
            <div className="flex gap-4">
                <div className="bg-white/5 border border-white/10 px-6 py-3 rounded-2xl text-center shadow-inner">
                    <p className="text-2xl font-black text-white leading-none">{pendentes.length}</p>
                    <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Pendentes</p>
                </div>
            </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* Coluna Principal: Lista de Pendentes */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center gap-2 px-2">
            <Clock className="w-5 h-5 text-cyan-400" />
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Processos Aguardando Ação</h2>
          </div>

          {isLoading ? (
            <div className="p-24 text-center glass-panel rounded-[2rem]">
              <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">Sincronizando Fila...</p>
            </div>
          ) : pendentes.length === 0 ? (
            <div className="text-center py-24 glass-panel rounded-[2.5rem] border-dashed border-white/5">
                <CheckCircle2 className="w-16 h-16 text-slate-800 mx-auto mb-6" />
                <h3 className="text-xl font-black text-slate-400 uppercase tracking-tighter">Fila Vazia</h3>
                <p className="text-slate-600 text-sm font-medium">Todos os processos foram validados com sucesso.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {pendentes.map((item) => (
                <div key={item.id} className="glass-panel p-6 rounded-[2rem] border-white/5 group hover:border-cyan-500/30 transition-all flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden shadow-xl">
                    <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-cyan-700/30 group-hover:bg-cyan-500 transition-colors"></div>
                    
                    <div className="flex items-center gap-6 flex-1">
                        <div className="w-16 h-16 bg-slate-950 rounded-2xl flex items-center justify-center border border-white/5 shrink-0 group-hover:scale-105 transition-transform">
                            <Building2 className="w-7 h-7 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                        </div>
                        <div>
                            <div className="flex flex-wrap items-center gap-3 mb-2">
                                <h3 className="text-xl font-black text-white uppercase tracking-tight">{item.condominios?.name}</h3>
                                <StatusBadge status={item.status} />
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Comp: {item.year}/{item.semester === 1 ? '1º' : '2º'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <Link 
                            href={`/condominio/${item.condominio_id}/arrecadacoes?ano=${item.year}`}
                            className="p-3.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-slate-400 hover:text-white transition-all group/btn shadow-lg"
                            title="Revisar"
                        >
                            <Search className="w-5 h-5 group-hover/btn:scale-110 transition-transform" />
                        </Link>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => setShowRejectModal(item)}
                            className="px-6 py-3.5 bg-transparent hover:bg-red-500/10 text-red-500/70 hover:text-red-500 border border-red-500/10 hover:border-red-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 active:scale-95"
                        >
                            CORRIGIR
                        </button>
                        
                        <button 
                            disabled={processing === item.id}
                            onClick={() => handleAction(item.id, 'approve')}
                            className="px-8 py-3.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-cyan-500/20 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-50"
                        >
                            {processing === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            APROVAR
                        </button>
                    </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coluna Lateral: Histórico Recente */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 px-2">
            <History className="w-5 h-5 text-violet-400" />
            <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">Logs de Atividade</h2>
          </div>

          <div className="glass-panel rounded-[2rem] border-white/5 overflow-hidden">
             <div className="p-6 space-y-6">
                {isLoading ? (
                  <div className="py-10 text-center text-slate-700 font-bold text-[10px] uppercase tracking-widest">Sincronizando Histórico...</div>
                ) : historico.length === 0 ? (
                  <div className="py-10 text-center opacity-30">
                     <Inbox className="w-8 h-8 mx-auto mb-2" />
                     <p className="text-[10px] font-black uppercase">Sem registros</p>
                  </div>
                ) : (
                  historico.map((log) => (
                    <div key={log.id} className="relative pl-6 border-l border-white/5 pb-2 last:pb-0 group">
                        <div className={`absolute -left-[5px] top-0 w-2 h-2 rounded-full shadow-[0_0_10px_rgba(255,255,255,0.2)] 
                           ${log.action === 'Aprovado' ? 'bg-cyan-500 shadow-cyan-500/50' : 'bg-red-500 shadow-red-500/50'}`}></div>
                        <p className="text-[10px] font-black text-white/90 leading-tight uppercase tracking-tight">
                           {log.profiles?.full_name} {log.action.toLowerCase()} o condomínio {log.processos?.condominios?.name}
                        </p>
                        <p className="text-[9px] text-slate-500 font-bold mt-1">
                           {new Date(log.created_at).toLocaleString('pt-BR')}
                        </p>
                        {log.comment && (
                           <div className="mt-2 p-3 bg-white/[0.02] border border-white/5 rounded-xl text-[11px] text-slate-400 italic">
                             &quot;{log.comment}&quot;
                           </div>
                        )}
                    </div>
                  ))
                )}
             </div>
          </div>
        </div>

      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowRejectModal(null)}></div>
            <div className="glass-panel max-w-lg w-full p-10 rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl">
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-14 h-14 bg-red-500/20 border border-red-500/30 rounded-2xl flex items-center justify-center">
                        <MessageSquare className="w-7 h-7 text-red-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Solicitar Ajuste</h3>
                        <p className="text-[10px] text-red-400 font-black uppercase tracking-widest mt-1">Devolução p/ Emissor</p>
                    </div>
                </div>
                
                <p className="text-slate-400 text-sm font-medium mb-6">
                    Descreva o motivo da devolução para <strong>{showRejectModal.condominios?.name}</strong>. Isso ajudará o gerente a realizar o conserto.
                </p>

                <textarea 
                    autoFocus
                    value={rejectReason}
                    onChange={e => setRejectReason(e.target.value)}
                    rows={4}
                    className="w-full bg-slate-950 border border-white/10 rounded-2xl p-5 text-sm text-slate-200 focus:border-red-500 outline-none transition-all placeholder:text-slate-700 mb-8 shadow-inner"
                    placeholder="Ex: Valor da taxa condominial não condiz com a ata..."
                />

                <div className="flex gap-4">
                    <button onClick={() => setShowRejectModal(null)} className="flex-1 py-4 text-xs font-black text-slate-600 uppercase tracking-widest hover:text-white transition-colors">Cancelar</button>
                    <button 
                        disabled={!rejectReason || processing}
                        onClick={() => handleAction(showRejectModal.id, 'reject', rejectReason)}
                        className="flex-2 py-4 bg-red-500 hover:bg-red-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all shadow-2xl shadow-red-500/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
                    >
                        <Send className="w-4 h-4" /> ENVIAR CORREÇÃO
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}
