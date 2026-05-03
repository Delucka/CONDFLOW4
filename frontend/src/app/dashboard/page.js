'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt, AlertCircle, Eye, ShieldCheck, MessageSquare, Send, Loader2, FileCheck, User, Users, Activity } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';

export default function DashboardPage() {
  const [filtroGerente, setFiltroGerente] = useState('');
  const { user } = useAuth();
  const supabase = createClient();
  const { addToast } = useToast();
  
  const [arquivoConferencia, setArquivoConferencia] = useState(null);

  // States de aprovação no Dashboard
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  
  // Métricas da Central de Emissões
  const [emissaoStats, setEmissaoStats] = useState({
    gerente: 0,
    supGerente: 0,
    supContabilidade: 0,
    aguardando: 0,
    registrada: 0
  });
  const [loadingEmissoes, setLoadingEmissoes] = useState(true);

  // ALTO FLUXO: SWR gerencia cache e revalidação automática
  const query = filtroGerente ? `?gerente_id=${filtroGerente}` : '';
  const { data, error, isLoading, mutate } = useSWR(`/api/dashboard${query}`, apiFetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 5000
  });

  // Fetch das métricas de emissão via Supabase
  useEffect(() => {
    async function fetchEmissaoStats() {
      setLoadingEmissoes(true);
      try {
        const { data: pacotes } = await supabase
          .from('emissoes_pacotes')
          .select('status');
        
        if (pacotes) {
          const stats = {
            gerente: 0,
            supGerente: 0,
            supContabilidade: 0,
            aguardando: 0,
            registrada: 0
          };
          
          pacotes.forEach(p => {
            const s = (p.status || '').toLowerCase();
            if (s.includes('gerente') || s === 'pendente') stats.gerente++;
            else if (s.includes('chefe') || s.includes('sup. gerentes')) stats.supGerente++;
            else if (s.includes('supervisor')) stats.supContabilidade++;
            else if (s === 'aprovado') stats.aguardando++;
            else if (s === 'registrado') stats.registrada++;
          });
          setEmissaoStats(stats);
        }
      } catch (err) {
        console.error("Erro ao carregar métricas de emissão:", err);
      } finally {
        setLoadingEmissoes(false);
      }
    }
    
    fetchEmissaoStats();
    
    // Inscrição em tempo real para atualizações
    const channel = supabase
      .channel('schema-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => {
        fetchEmissaoStats();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;

      let allFiles = [];
      let signedUrl = null;

      if (fileData) {
        // Buscar todos os arquivos do mesmo pacote
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('*')
          .eq('pacote_id', fileData.pacote_id);
        
        allFiles = arquivos || [];

        const { data: urlData } = await supabase.storage
          .from('emissoes')
          .createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }

      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: fileData?.processo_id || null,
        arquivos: allFiles
      });
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      
      addToast(action === 'approve' ? 'Processo aprovado!' : 'Correção solicitada!', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      
      mutate();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-white mb-2">Erro de Conexão</h3>
        <p className="text-slate-400 mb-6">Não foi possível carregar os dados do painel.</p>
        <button onClick={() => window.location.reload()} className="px-6 py-2 bg-slate-800 rounded-xl font-bold border border-slate-700">TENTAR NOVAMENTE</button>
      </div>
    );
  }

  // Extrair processos pendentes
  const stats = data?.stats || { total: 0, em_edicao: 0, pendentes: 0, aprovados: 0 };
  const condos = data?.condos || [];
  const gerentes = data?.gerentes || [];
  
  const pendingProcesses = [];
  if (data?.processos) {
      Object.keys(data.processos).forEach(condoId => {
          const proc = data.processos[condoId];
          const condo = condos.find(c => c.id === condoId);
          // Gerente e Master aprovam. Emissor só visualiza status de andamento.
          if (["Enviado", "Em aprovação"].includes(proc.status)) {
              pendingProcesses.push({ ...proc, condo });
          }
      });
  }

  return (
    <div className="animate-fade-in w-full h-full relative space-y-6 pb-20">
      {/* Etiqueta de Versão (Prova Real) */}
      <div className="flex items-center gap-2 px-6 py-2 bg-violet-600/20 border border-violet-500/30 rounded-full w-fit">
        <Zap className="w-4 h-4 text-violet-400 fill-violet-400" />
        <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Dashboard V2 — Monitoramento Ativo</span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Condomínios" value={stats.total} icon={Building} color="cyan" loading={isLoading} />
        <StatsCard title="Em Edição" value={stats.em_edicao} icon={FileEdit} color="orange" loading={isLoading} />
        <StatsCard title="Pendentes" value={stats.pendentes} icon={Clock} color="indigo" loading={isLoading} />
        <StatsCard title="Aprovados" value={stats.aprovados} icon={CheckCircle2} color="emerald" loading={isLoading} />
      </div>

      {/* Fluxo de Emissões (Nova Seção) */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-cyan-400">Fluxo de Emissões (Sincronizado)</h4>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatsCard title="Com o Gerente" value={emissaoStats.gerente} icon={User} color="indigo" loading={loadingEmissoes} />
          <StatsCard title="Com Sup. Gerentes" value={emissaoStats.supGerente} icon={Activity} color="cyan" loading={loadingEmissoes} />
          <StatsCard title="Com Sup. Contab." value={emissaoStats.supContabilidade} icon={ShieldCheck} color="orange" loading={loadingEmissoes} />
          <StatsCard title="Aguard. Registro" value={emissaoStats.aguardando} icon={Clock} color="emerald" loading={loadingEmissoes} />
          <StatsCard title="Registradas" value={emissaoStats.registrada} icon={FileCheck} color="blue" loading={loadingEmissoes} />
        </div>
      </div>

      {/* Painel Duplo */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* Tabela de Condomínios (Esquerda - 2/3) */}
        <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-md rounded-[2rem] border border-white/5 shadow-2xl overflow-hidden flex flex-col h-full">
          <div className="px-6 py-5 border-b border-white/5 flex flex-wrap items-center justify-between gap-4 bg-white/5">
            <div>
              <h3 className="text-lg font-black text-white leading-none">Informativo Semestral</h3>
              <p className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold mt-1">
                PERÍODO: {data?.year || '—'} / {data?.semester === 1 ? '1º' : '2º'} SEMESTRE
              </p>
            </div>
            
            {user?.role !== 'gerente' && (
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter">Filtrar:</label>
                <select
                  value={filtroGerente}
                  onChange={(e) => setFiltroGerente(e.target.value)}
                  className="text-xs bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-slate-200 outline-none focus:border-cyan-500 transition-all cursor-pointer"
                >
                  <option value="">TODOS</option>
                  {gerentes.map((g) => (
                    <option key={g.id} value={g.id}>{g.profiles?.full_name || '—'}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {isLoading ? (
            <div className="p-24 text-center">
              <div className="w-12 h-12 border-4 border-cyan-500/30 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-sm font-bold text-slate-500 tracking-widest uppercase">Processando Dados...</p>
            </div>
          ) : condos.length > 0 ? (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-white/5 border-b border-white/5 text-[10px] uppercase tracking-[0.2em] font-black text-slate-500">
                    <th className="px-6 py-4">Condomínio</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-white/5">
                  {condos.map((c) => {
                    const status = data?.processos?.[c.id]?.status || 'Sem processo';
                    
                    return (
                      <tr key={c.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                           <p className="font-bold text-gray-100 group-hover:text-cyan-400 transition-colors uppercase tracking-tight">{c.name}</p>
                           <p className="text-[10px] text-gray-500 font-medium">Dia {c.due_day} • {c.gerente_name || c.assistente || '—'}</p>
                        </td>
                        <td className="px-6 py-4">
                          <StatusBadge status={status} />
                        </td>
                        <td className="px-6 py-4 text-right flex gap-2 justify-end">
                          <Link href={`/condominio/${c.id}/arrecadacoes`} className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-cyan-500/20" title="Arrecadações"><Layers className="w-4 h-4" /></Link>
                          <Link href={`/condominio/${c.id}/cobrancas`} className="p-2.5 rounded-xl bg-orange-500/10 text-orange-400 border border-orange-500/20 hover:bg-orange-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-orange-500/20" title="Cobranças"><Receipt className="w-4 h-4" /></Link>
                          <button onClick={() => handleQuickView(c.id)} className="p-2.5 rounded-xl bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500 hover:text-slate-950 transition-all shadow-lg hover:shadow-violet-500/20" title="Ver Info"><Eye className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-20 text-center flex-1">
              <Inbox className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-300 font-bold">Nenhum condomínio encontrado</p>
            </div>
          )}
        </div>

        {/* Quadro Lateral Diretório de Pendências (Fila de Aprovação) */}
        <div className="bg-slate-900/80 backdrop-blur-xl rounded-[2rem] border border-cyan-500/20 shadow-[0_0_40px_rgba(6,182,212,0.1)] overflow-hidden flex flex-col relative h-full">
           <div className="px-6 py-5 border-b border-cyan-500/20 bg-cyan-500/5">
              <div className="flex items-center gap-3">
                 <ShieldCheck className="w-5 h-5 text-cyan-400" />
                 <div>
                    <h3 className="text-lg font-black text-white leading-none tracking-tight">Fila de Conferência</h3>
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mt-1">Pendentes de Ação</p>
                 </div>
              </div>
           </div>

           <div className="p-4 space-y-3 flex-1 overflow-y-auto">
              {isLoading ? (
                 <div className="py-20 text-center text-[10px] text-slate-500 font-black uppercase tracking-widest">Calculando pendências...</div>
              ) : pendingProcesses.length > 0 ? (
                 pendingProcesses.map(proc => (
                   <div key={proc.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 hover:border-cyan-500/40 transition-colors shadow-lg">
                      <div className="flex items-center justify-between mb-3">
                         <h4 className="text-sm font-black text-white uppercase tracking-tight truncate">{proc.condo?.name || '—'}</h4>
                         <span className="text-[9px] font-black uppercase bg-white/10 text-slate-300 px-2 py-1 rounded-md">{proc.status}</span>
                      </div>
                      
                      <div className="flex items-center gap-2 mt-4">
                         <button onClick={() => handleQuickView(proc.condominio_id)} className="p-2.5 bg-slate-800 hover:bg-cyan-500 text-slate-400 hover:text-slate-900 rounded-xl transition-all border border-transparent shadow" title="Visualizar Prévia"><Eye className="w-4 h-4" /></button>
                         <button 
                            disabled={processing === proc.id}
                            onClick={() => setShowRejectModal(proc)}
                            className="flex-1 py-2.5 bg-transparent hover:bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl text-[9px] font-black uppercase transition-all disabled:opacity-50"
                         >
                            Corrigir
                         </button>
                         <button 
                            disabled={processing === proc.id}
                            onClick={() => handleAction(proc.id, 'approve')}
                            className="flex-1 py-2.5 bg-cyan-500/10 hover:bg-cyan-500 text-cyan-500 hover:text-slate-950 border border-cyan-500/30 rounded-xl text-[9px] font-black uppercase transition-all shadow-lg shadow-cyan-500/10 disabled:opacity-50 flex justify-center items-center gap-1"
                         >
                            {processing === proc.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Aprovar
                         </button>
                      </div>
                   </div>
                 ))
              ) : (
                 <div className="py-20 text-center">
                    <CheckCircle2 className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Tudo limpo!</p>
                    <p className="text-[10px] text-slate-600 mt-1">Nenhuma pendência na fila.</p>
                 </div>
              )}
           </div>
        </div>

      </div>

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          arquivos={arquivoConferencia.arquivos}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutate(); setArquivoConferencia(null); }}
        />
      )}

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
                    Descreva o motivo da devolução para <strong>{showRejectModal.condo?.name || 'o condomínio'}</strong>. Isso ajudará o emissor a realizar o conserto.
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
                        {processing === showRejectModal.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} ENVIAR CORREÇÃO
                    </button>
                </div>
            </div>
        </div>
      )}

    </div>
  );
}
