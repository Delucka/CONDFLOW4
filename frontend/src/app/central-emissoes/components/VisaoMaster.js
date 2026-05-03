'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { Layers, CheckCircle, Clock, FileText, ExternalLink, Activity, Loader2, Trash2, Package, XCircle, User, ShieldCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

export default function VisaoMaster() {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [confirmDeleteOrphanId, setConfirmDeleteOrphanId] = useState(null);

  const stats = {
    gerente: pacotes.filter(p => p.status === 'Aguardando Gerente' || p.status === 'pendente').length,
    supGerente: pacotes.filter(p => p.status === 'Aguardando Chefe').length,
    supContabilidade: pacotes.filter(p => p.status === 'Aguardando Supervisor').length,
    registro: pacotes.filter(p => p.status === 'aprovado').length,
  };

  useEffect(() => {
    fetchPacotes();
    
    const channel = supabase.channel('master_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => { fetchPacotes(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPacotes() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name, fluxo), profiles:uploaded_by(full_name)')
        .order('criado_em', { ascending: false });
      
      if (error) console.error("fetchPacotes erro:", error);
      
      if (data) {
        // Buscar contagem de arquivos por pacote separadamente
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato')
          .not('pacote_id', 'is', null);
        
        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        const enriched = data.map(p => ({ ...p, arquivos: arqMap[p.id] || [] }));
        setPacotes(enriched);

        // Buscar arquivos órfãos (sem pacote)
        const { data: orphanData } = await supabase
          .from('emissoes_arquivos')
          .select('*, condominios(name)')
          .is('pacote_id', null);
        
        setOrphans(orphanData || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleAprovar(pacote) {
    const fluxos = {
      1: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      2: { 'default': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' }
    };

    const fluxoId = pacote.condominios?.fluxo || 1;
    const currentStatus = pacote.status;
    let nextStatus = 'aprovado';

    if (fluxos[fluxoId]) {
      nextStatus = fluxos[fluxoId][currentStatus] || fluxos[fluxoId]['default'] || 'aprovado';
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: nextStatus, atualizado_em: new Date().toISOString() })
      .eq('id', pacote.id);

    if (error) {
      addToast('Erro ao processar aprovação', 'error');
    } else {
      addToast(nextStatus === 'aprovado' ? 'Pacote Finalizado!' : `Enviado para: ${nextStatus}`, 'success');
      setIsDrawerOpen(false);
      fetchPacotes();
    }
  }

  async function handleRejeitar(pacote) {
    const reason = prompt("Motivo da correção:");
    if (!reason) return;
    await supabase.from('emissoes_pacotes').update({ 
      status: 'solicitar_correcao', 
      comentario_correcao: reason, 
      atualizado_em: new Date().toISOString() 
    }).eq('id', pacote.id);
    setIsDrawerOpen(false);
    fetchPacotes();
    addToast('Correção solicitada.', 'info');
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      addToast('Clique novamente para confirmar a exclusão', 'warning');
      setTimeout(() => setConfirmDeleteId(null), 3000);
      return;
    }
    try {
      // Deletar arquivos do storage primeiro
      const pacote = pacotes.find(p => p.id === id);
      if (pacote?.arquivos?.length) {
        await supabase.storage.from('emissoes').remove(pacote.arquivos.map(a => a.arquivo_url));
      }
      // Deletar arquivos do banco
      await supabase.from('emissoes_arquivos').delete().eq('pacote_id', id);
      // Deletar o pacote
      const { error } = await supabase.from('emissoes_pacotes').delete().eq('id', id);
      if (error) throw error;
      setPacotes(prev => prev.filter(p => p.id !== id));
      setConfirmDeleteId(null);
      addToast('Pacote excluído com sucesso', 'success');
    } catch (err) {
      addToast('Falha: ' + err.message, 'error');
    }
  };

  const handleDeleteOrphan = async (e, arqId, path) => {
    e.stopPropagation();
    if (confirmDeleteOrphanId !== arqId) {
      setConfirmDeleteOrphanId(arqId);
      addToast('Clique novamente para excluir o arquivo legado', 'warning');
      setTimeout(() => setConfirmDeleteOrphanId(null), 3000);
      return;
    }
    try {
      if (path) await supabase.storage.from('emissoes').remove([path]);
      const { error } = await supabase.from('emissoes_arquivos').delete().eq('id', arqId);
      if (error) throw error;
      setOrphans(prev => prev.filter(o => o.id !== arqId));
      setConfirmDeleteOrphanId(null);
      addToast('Arquivo legado removido', 'success');
      fetchPacotes(); // Recarregar para garantir sincronia com badge
    } catch (err) {
      addToast('Falha: ' + err.message, 'error');
    }
  };

  async function openFileUrl(arq, pacote) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
    if (error) return addToast('Erro ao abrir arquivo.', 'error');
    
    if (data?.signedUrl) {
      setArquivoAberto({
        id: arq.id,
        nome: arq.arquivo_nome,
        url: data.signedUrl,
        processo_id: pacote.processo_id || null,
        condominio_id: pacote.condominio_id,
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || []
      });
    }
  }

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  return (
    <div className="space-y-8">
      
      {/* Cards de Métricas */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Com o Gerente', value: stats.gerente, icon: User, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Com o Sup. Gerente', value: stats.supGerente, icon: Activity, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Com a Sup. Contabilidade', value: stats.supContabilidade, icon: ShieldCheck, color: 'text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Aguardando Registro', value: stats.registro, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
        ].map((stat, i) => (
          <div key={i} className={`p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex items-center gap-4 ${stat.bg}`}>
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 mix-blend-lighten ${stat.bg} shadow-[inset_0_0_20px_rgba(255,255,255,0.05)]`}>
              <stat.icon className={`w-6 h-6 ${stat.color}`} />
            </div>
            <div>
              <p className="text-3xl font-black text-white leading-none">{stat.value}</p>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500 mt-2">{stat.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Tabela Master */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Activity className="text-cyan-400 w-5 h-5"/>
            Fluxo Geral — Pacotes de Emissão
          </h3>
        </div>

        <div className="divide-y divide-white/5">
          {pacotes.map(pacote => {
            const numArq = pacote.arquivos?.length || 0;
            const needsAction = pacote.status === 'Aguardando Supervisor' || pacote.status === 'Aguardando Gerente' || pacote.status === 'Aguardando Chefe' || pacote.status === 'pendente';

            return (
              <div key={pacote.id} className="hover:bg-white/[0.02] transition-colors">
                <div className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                      <Package className="w-5 h-5 text-violet-400" />
                    </div>
                    <div>
                      <p className="font-bold text-white text-sm">{pacote.condominios?.name}</p>
                      <p className="text-[10px] text-gray-500">
                        {String(pacote.mes_referencia).padStart(2,'0')}/{pacote.ano_referencia} • {numArq} arquivo{numArq !== 1 ? 's' : ''} • {pacote.profiles?.full_name}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <StatusBadge status={pacote.status} />
                    {needsAction && (
                      <div className="flex gap-1">
                        <button onClick={() => handleRejeitar(pacote)} className="p-2 rounded-lg bg-white/5 text-rose-400 hover:bg-rose-500/20 transition-all" title="Solicitar Correção">
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleAprovar(pacote)} className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-all" title="Aprovação">
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button onClick={(e) => handleDelete(e, pacote.id)} className={`p-2 rounded-lg transition-all ${confirmDeleteId === pacote.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`} title={confirmDeleteId === pacote.id ? 'Clique para confirmar' : 'Excluir'}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Arquivos inline */}
                {numArq > 0 && (
                  <div className="px-6 pb-4 flex flex-wrap gap-2">
                    {pacote.arquivos.map(arq => (
                      <button
                        key={arq.id}
                        onClick={() => openFileUrl(arq, pacote)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-[#0a0a0f] border border-white/10 rounded-lg hover:border-cyan-500/30 hover:bg-cyan-500/5 transition-all group text-xs"
                      >
                        <FileText className="w-3 h-3 text-gray-500 group-hover:text-cyan-400" />
                        <span className="font-bold text-gray-400 group-hover:text-white truncate max-w-[120px]">{arq.arquivo_nome}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {pacotes.length === 0 && (
            <div className="px-6 py-12 text-center text-gray-500 text-sm">
              Nenhum pacote enviado para aprovação.
            </div>
          )}
        </div>
      </div>

      {/* Seção de Arquivos Órfãos (Legados ou Sem Pacote) */}
      {orphans.length > 0 && (
        <div className="border border-rose-500/20 rounded-3xl bg-rose-500/5 overflow-hidden shadow-xl">
          <div className="p-6 border-b border-rose-500/10 flex items-center justify-between">
            <h3 className="font-black text-white text-lg flex items-center gap-2">
              <FileText className="text-rose-400 w-5 h-5"/>
              Arquivos Órfãos / Legados
            </h3>
            <span className="text-[10px] font-bold text-rose-400/60 uppercase tracking-widest bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
              Estes arquivos estão gerando notificações mas não pertencem a pacotes
            </span>
          </div>

          <div className="divide-y divide-rose-500/5">
            {orphans.map(arq => (
              <div key={arq.id} className="px-6 py-4 flex items-center justify-between hover:bg-rose-500/[0.02] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center">
                    <FileText className="w-5 h-5 text-rose-400" />
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">{arq.arquivo_nome}</p>
                    <p className="text-[10px] text-gray-500 uppercase tracking-widest">
                      {arq.condominios?.name || 'Condomínio não identificado'} • {new Date(arq.criado_em).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <StatusBadge status={arq.status} />
                  <button
                    onClick={() => openFileUrl(arq, { status: 'none' })}
                    className="p-2 rounded-lg bg-white/5 text-gray-400 hover:text-white"
                    title="Visualizar"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={(e) => handleDeleteOrphan(e, arq.id, arq.arquivo_url)} 
                    className={`p-2 rounded-lg transition-all ${confirmDeleteOrphanId === arq.id ? 'bg-rose-500 text-white animate-pulse' : 'bg-white/5 text-rose-400/50 hover:text-rose-400 hover:bg-rose-500/10'}`} 
                    title="Excluir Permanentemente"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FilePreviewDrawer 
        isOpen={isDrawerOpen} 
        onClose={() => setIsDrawerOpen(false)} 
        file={selectedFile} 
      />

      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}
    </div>
  );
}
