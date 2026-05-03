'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { CheckCircle, FileText, ExternalLink, Activity, Loader2, Trash2, Package, XCircle, User, ShieldCheck, Send, X, FileCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

export default function VisaoMaster() {
  const supabase = createClient();
  const { addToast } = useToast();
  const { profile, user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [orphans, setOrphans] = useState([]);
  const [confirmDeleteOrphanId, setConfirmDeleteOrphanId] = useState(null);
  const [showConcluirModal, setShowConcluirModal] = useState(false);
  const [activePacote, setActivePacote] = useState(null);
  const [nivelAprovacao, setNivelAprovacao] = useState(1);
  const [showRegistroModal, setShowRegistroModal] = useState(false);
  const [dataRegistro, setDataRegistro] = useState('');

  const stats = {
    gerente: pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s.includes('gerente') || s === 'pendente';
    }).length,
    supGerente: pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s.includes('chefe') || s.includes('sup. gerentes');
    }).length,
    supContabilidade: pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s.includes('supervisor');
    }).length,
    registro: pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s === 'aprovado';
    }).length,
    registrada: pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      return s === 'registrado';
    }).length,
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
      // Tenta buscar pacotes com join de condomínio. 
      // Removendo o join de profiles temporariamente para garantir que a lista volte a aparecer
      const { data, error } = await supabase
        .from('emissoes_pacotes')
        .select('*, condominios(name)')
        .order('criado_em', { ascending: false });
      
      if (error) {
        console.error("fetchPacotes erro:", error);
        addToast('Erro ao carregar pacotes: ' + error.message, 'error');
      }
      
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
      1: { 'default': 'aprovado' },
      2: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      4: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' }
    };

    const fluxoId = Number(pacote.nivel_aprovacao) || 1;
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

  async function handleConcluirRapido(pacote) {
    setActivePacote(pacote);
    setShowConcluirModal(true);
  }

  async function confirmarConclusao() {
    let initialStatus = 'Aguardando Gerente';
    if (nivelAprovacao === 1) initialStatus = 'Aguardando Supervisor';

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ 
        status: initialStatus, 
        nivel_aprovacao: String(nivelAprovacao),
        atualizado_em: new Date().toISOString() 
      })
      .eq('id', activePacote.id);

    if (error) {
      addToast('Erro ao enviar', 'error');
    } else {
      addToast('Emissão enviada para aprovação!', 'success');
      setShowConcluirModal(false);
      setActivePacote(null);
      fetchPacotes();
    }
  }

  async function handleRegistrar(pacote) {
    setActivePacote(pacote);
    const now = new Date();
    // Ajuste para fuso local no formato do datetime-local (YYYY-MM-DDTHH:mm)
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    setDataRegistro(localNow);
    setShowRegistroModal(true);
  }

  async function confirmarRegistro() {
    if (!dataRegistro) return addToast('Informe a data e hora', 'error');
    
    const selectedDate = new Date(dataRegistro);
    if (selectedDate < new Date(new Date().getTime() - 60000)) { // Tolerância de 1 min
      return addToast('Não é permitido registrar no passado', 'error');
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ 
        status: 'registrado', 
        atualizado_em: selectedDate.toISOString() 
      })
      .eq('id', activePacote.id);

    if (error) {
      addToast('Erro ao registrar', 'error');
    } else {
      addToast('Emissão registrada com sucesso!', 'success');
      setShowRegistroModal(false);
      setActivePacote(null);
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Com o Gerente', value: stats.gerente, icon: User, color: 'text-violet-400', bg: 'bg-violet-500/10' },
          { label: 'Com o Sup. Gerente', value: stats.supGerente, icon: Activity, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          { label: 'Com a Sup. Contabilidade', value: stats.supContabilidade, icon: ShieldCheck, color: 'text-orange-400', bg: 'bg-orange-500/10' },
          { label: 'Aguardando Registro', value: stats.registro, icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
          { label: 'Emissão Registrada', value: stats.registrada, icon: FileText, color: 'text-blue-400', bg: 'bg-blue-500/10' }
        ].map((stat, i) => (
          <div key={i} className={`p-6 border border-white/10 rounded-3xl bg-[#0a0a0f] flex flex-col justify-center gap-2 ${stat.bg}`}>
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mix-blend-lighten ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <p className="text-3xl font-black text-white leading-none">{stat.value}</p>
            </div>
            <p className="text-[9px] font-black uppercase tracking-widest text-gray-500 mt-1">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Tabela Master */}
      <div className="border border-white/10 rounded-3xl bg-white/5 overflow-hidden shadow-2xl">
        <div className="p-6 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Activity className="text-cyan-400 w-5 h-5"/>
            Fluxo Geral - Pacotes de Emissao
          </h3>
        </div>

        <div className="divide-y divide-white/5">
          {pacotes.map(pacote => {
            const numArq = pacote.arquivos?.length || 0;

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
                      <div className="flex gap-1">
                        {/* Botão de Registro com Lógica Reforçada (Sugestão IA) */}
                        {(() => {
                          const statusLower = (pacote.status || '').toLowerCase();
                          const podeRegistrar = 
                            statusLower.includes('aprovado') || 
                            statusLower.includes('aguardando_registro') ||
                            statusLower.includes('aguard');
                          
                          const roleAutorizado = 
                            profile?.role === 'master' || 
                            profile?.role === 'departamento' ||
                            profile?.role === 'emissor' ||
                            profile?.role === 'supervisora';
                          
                          if (!podeRegistrar || !roleAutorizado) return null;
                          
                          return (
                            <button 
                              onClick={() => handleRegistrar(pacote)} 
                              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/20 font-black text-[10px] uppercase tracking-widest border border-white/10"
                            >
                              <FileCheck className="w-4 h-4" />
                              <span>Registrar</span>
                            </button>
                          );
                        })()}

                        {((pacote.status || '').toLowerCase() !== 'registrado' && (pacote.status || '').toLowerCase() !== 'rascunho' && (pacote.status || '').toLowerCase() !== 'aprovado') && (
                          <button onClick={() => handleRejeitar(pacote)} className="p-2 rounded-lg bg-white/5 text-rose-400 hover:bg-rose-500/20 transition-all" title="Solicitar Correção">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                        {((pacote.status || '').toLowerCase() === 'rascunho' || (pacote.status || '').toLowerCase() === 'solicitar_correcao') && (
                          <button onClick={() => handleConcluirRapido(pacote)} className="p-2 rounded-lg bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 border border-emerald-500/30 transition-all" title="Enviar para Aprovação">
                            <Send className="w-4 h-4" />
                          </button>
                        )}
                        {((pacote.status || '').toLowerCase() !== 'registrado' && (pacote.status || '').toLowerCase() !== 'aprovado' && (pacote.status || '').toLowerCase() !== 'rascunho') && (
                          <button onClick={() => handleAprovar(pacote)} className="p-2 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 transition-all" title="Aprovação">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
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
      {/* ═══ MODAL DE CONCLUSÃO ═══ */}
      {showConcluirModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-2">Concluir Emissão</h3>
            <p className="text-sm text-gray-400 text-center mb-8">
              {activePacote?.arquivos?.length || 0} arquivos neste pacote.
            </p>

            <div className="space-y-3 mb-8">
              {[
                { id: 1, label: 'Nível 1 - Sem consumos', desc: 'Passa direto para a Supervisora' },
                { id: 2, label: 'Nível 2 - Alteração sem consumo', desc: 'Passa por Gerente ➔ Supervisora' },
                { id: 3, label: 'Nível 3 - Fração', desc: 'Passa por Gerente ➔ Supervisora' },
                { id: 4, label: 'Nível 4 - Com empresas terceirizadas', desc: 'Passa por Gerente ➔ Sup. Gerentes ➔ Supervisora' }
              ].map(n => (
                <button
                  key={n.id}
                  onClick={() => setNivelAprovacao(n.id)}
                  className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                    nivelAprovacao === n.id
                      ? 'border-violet-600 bg-violet-600/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                      : 'border-white/5 bg-white/5 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === n.id ? 'border-violet-500' : 'border-gray-600'}`}>
                      {nivelAprovacao === n.id && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                    </div>
                    <div>
                      <p className="font-bold text-white">{n.label}</p>
                      <p className="text-xs text-gray-400">{n.desc}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowConcluirModal(false)}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarConclusao}
                className="flex-[2] py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all"
              >
                Confirmar e Enviar
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ═══ MODAL DE REGISTRO ═══ */}
      {showRegistroModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileCheck className="w-8 h-8 text-blue-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-2">Registrar Emissão</h3>
            <p className="text-sm text-gray-400 text-center mb-8">
              Confirme a data e hora oficial do registro.
            </p>

            <div className="mb-8">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Data e Hora do Registro</label>
              <input
                type="datetime-local"
                value={dataRegistro}
                onChange={(e) => setDataRegistro(e.target.value)}
                min={new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 transition-all"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => { setShowRegistroModal(false); setActivePacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarRegistro}
                className="flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all"
              >
                Confirmar Registro
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
