'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { UploadCloud, FileText, CheckCircle, Clock, Loader2, Trash2, Package, ChevronDown, ChevronRight, Send, FolderOpen, Plus, X } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';

export default function VisaoEmissor({ profile }) {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();
  const [arquivoAberto, setArquivoAberto] = useState(null);
  
  const [condominios, setCondominios] = useState([]);
  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  
  // Pacote ativo (aberto para edição)
  const [activePacote, setActivePacote] = useState(null);
  const [pacoteArquivos, setPacoteArquivos] = useState([]);
  
  // Form para novo pacote
  const [condoId, setCondoId] = useState('');
  const [mes, setMes] = useState(new Date().getMonth() + 1);
  const [ano, setAno] = useState(new Date().getFullYear());
  
  // Modal de conclusão
  const [showConcluirModal, setShowConcluirModal] = useState(false);
  const [nivelAprovacao, setNivelAprovacao] = useState(1);
  const [confirmDeleteArqId, setConfirmDeleteArqId] = useState(null);

  // Carteiras expandidas
  const [expandedCarteiras, setExpandedCarteiras] = useState({});

  useEffect(() => {
    fetchDados();
    
    const channel = supabase.channel('emissor_pacotes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => { fetchPacotes(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, () => { 
        if (activePacote) fetchArquivosDoPacote(activePacote.id); 
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchDados() {
    setLoading(true);
    try {
      await Promise.all([fetchCondominios(), fetchPacotes()]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchCondominios() {
    const { data } = await supabase
      .from('condominios')
      .select('*, gerentes:gerente_id(id, profiles!gerentes_profile_id_fkey(full_name))')
      .order('name');
    if (data) setCondominios(data);
  }

  async function fetchPacotes() {
    const { data } = await supabase
      .from('emissoes_pacotes')
      .select('*, condominios(name, gerente_id, gerentes:gerente_id(profiles!gerentes_profile_id_fkey(full_name)))')
      .order('criado_em', { ascending: false });
    
    if (data) {
      // Buscar contagem de arquivos por pacote
      const { data: arquivos } = await supabase
        .from('emissoes_arquivos')
        .select('id, pacote_id')
        .not('pacote_id', 'is', null);
      
      const countMap = {};
      (arquivos || []).forEach(a => {
        countMap[a.pacote_id] = (countMap[a.pacote_id] || 0) + 1;
      });
      
      setPacotes(data.map(p => ({ ...p, numArquivos: countMap[p.id] || 0 })));
    }
  }

  async function fetchArquivosDoPacote(pacoteId) {
    const { data } = await supabase
      .from('emissoes_arquivos')
      .select('*')
      .eq('pacote_id', pacoteId)
      .order('criado_em', { ascending: true });
    if (data) setPacoteArquivos(data);
  }

  // --- AÇÕES ---

  async function handleCriarOuAbrirPacote(e) {
    e?.preventDefault?.();
    if (!condoId) return addToast('Selecione um condomínio', 'error');

    // Tentar buscar pacote existente
    const { data: existing } = await supabase
      .from('emissoes_pacotes')
      .select('*')
      .eq('condominio_id', condoId)
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano)
      .maybeSingle();

    if (existing) {
      setActivePacote(existing);
      await fetchArquivosDoPacote(existing.id);
      addToast('Pacote existente aberto para edição.', 'info');
    } else {
      const { data: novo, error } = await supabase
        .from('emissoes_pacotes')
        .insert({
          condominio_id: condoId,
          mes_referencia: mes,
          ano_referencia: ano,
          status: 'rascunho',
          uploaded_by: profile.id
        })
        .select()
        .single();

      if (error) {
        addToast('Erro ao criar pacote: ' + error.message, 'error');
      } else {
        setActivePacote(novo);
        setPacoteArquivos([]);
        addToast('Novo pacote criado! Adicione os arquivos.', 'success');
        fetchPacotes();
      }
    }
  }

  async function handleUploadArquivo(fileInput) {
    if (!fileInput || !activePacote) return;
    
    setIsUploading(true);
    try {
      const extensao = fileInput.name.split('.').pop().toLowerCase();
      const randomId = Math.random().toString(36).substring(7);
      const filePath = `${activePacote.condominio_id}/${ano}/${mes}/${randomId}_${fileInput.name}`;
      
      const { error: uploadError } = await supabase.storage.from('emissoes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('emissoes_arquivos')
        .insert({
          condominio_id: activePacote.condominio_id,
          pacote_id: activePacote.id,
          tipo: 'emissao',
          arquivo_url: filePath,
          arquivo_nome: fileInput.name,
          formato: extensao,
          mes_referencia: mes,
          ano_referencia: ano,
          status: 'pendente',
          uploaded_by: profile.id
        });

      if (dbError) throw dbError;

      addToast(`${fileInput.name} adicionado!`, 'success');
      await fetchArquivosDoPacote(activePacote.id);
      fetchPacotes();
    } catch (err) {
      addToast(`Erro no upload: ${err.message}`, 'error');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteArquivo(e, id, path) {
    e.stopPropagation();
    if (confirmDeleteArqId !== id) {
      setConfirmDeleteArqId(id);
      addToast('Clique novamente para confirmar a remoção', 'warning');
      setTimeout(() => setConfirmDeleteArqId(null), 3000);
      return;
    }
    try {
      await supabase.storage.from('emissoes').remove([path]);
      const { error } = await supabase.from('emissoes_arquivos').delete().eq('id', id);
      if (error) {
        addToast('Erro ao excluir: ' + error.message, 'error');
        return;
      }
      setConfirmDeleteArqId(null);
      addToast('Arquivo removido.', 'success');
      await fetchArquivosDoPacote(activePacote.id);
      fetchPacotes();
    } catch (err) {
      addToast('Erro: ' + err.message, 'error');
    }
  }

  async function handleConcluirPacote() {
    if (pacoteArquivos.length === 0) return addToast('Adicione pelo menos 1 arquivo antes de concluir.', 'warning');
    setShowConcluirModal(true);
  }


  async function confirmarConclusao() {
    let initialStatus = 'Aguardando Gerente';
    if (nivelAprovacao === 2) {
      initialStatus = 'Aguardando Supervisora';
    }

    // Salvar o fluxo escolhido no condomínio para que o backend saiba a rota correta
    await supabase.from('condominios').update({ fluxo: nivelAprovacao }).eq('id', activePacote.condominio_id);

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ status: initialStatus, nivel_aprovacao: initialStatus, atualizado_em: new Date().toISOString() })
      .eq('id', activePacote.id);

    if (error) {
      addToast('Erro ao concluir pacote: ' + error.message, 'error');
    } else {
      addToast('Emissão concluída e enviada para aprovação!', 'success');
      setShowConcluirModal(false);
      setActivePacote(null);
      setPacoteArquivos([]);
      fetchPacotes();
    }
  }

  async function openFileUrl(arq) {
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arq.arquivo_url, 300);
    if (error) return addToast('Erro ao gerar link.', 'error');
    if (data?.signedUrl) {
      setArquivoAberto({
        id: arq.id,
        nome: arq.arquivo_nome,
        url: data.signedUrl,
        processo_id: activePacote?.processo_id || null,
        condominio_id: activePacote?.condominio_id || condoId,
        emitido_por: profile?.id,
        arquivos: pacoteArquivos || []
      });
    }
  }

  function abrirPacote(pacote) {
    setActivePacote(pacote);
    setCondoId(pacote.condominio_id);
    setMes(pacote.mes_referencia);
    setAno(pacote.ano_referencia);
    fetchArquivosDoPacote(pacote.id);
  }

  // Agrupar condomínios por carteira
  const carteiras = useMemo(() => {
    const groups = {};
    condominios.forEach(c => {
      const gerente = c.gerentes?.profiles?.full_name || 'Sem Carteira';
      if (!groups[gerente]) groups[gerente] = [];
      groups[gerente].push(c);
    });
    return groups;
  }, [condominios]);

  // Mapa de pacotes por condomínio (mês/ano atual)
  const pacotesPorCondo = useMemo(() => {
    const map = {};
    pacotes.forEach(p => {
      const key = `${p.condominio_id}_${p.mes_referencia}_${p.ano_referencia}`;
      map[key] = p;
    });
    return map;
  }, [pacotes]);

  const toggleCarteira = (name) => {
    setExpandedCarteiras(prev => ({ ...prev, [name]: !prev[name] }));
  };

  if (loading) return <div className="flex justify-center p-12"><Loader2 className="animate-spin w-8 h-8 text-violet-500"/></div>;

  // --- RENDER ---
  return (
    <div className="space-y-8">
      
      {/* ═══ PAINEL DO PACOTE ATIVO ═══ */}
      {activePacote ? (
        <div className="border border-violet-500/30 rounded-3xl bg-violet-500/5 p-6 shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-violet-500/20 rounded-2xl flex items-center justify-center border border-violet-500/30">
                <Package className="w-6 h-6 text-violet-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-tight">
                  {condominios.find(c => c.id === activePacote.condominio_id)?.name || 'Condomínio'}
                </h3>
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest">
                  Emissão {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia} • <StatusBadge status={activePacote.status} />
                </p>
              </div>
            </div>
            <button 
              onClick={() => { setActivePacote(null); setPacoteArquivos([]); }}
              className="p-2 bg-white/5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Lista de Arquivos do Pacote */}
          <div className="space-y-3 mb-6">
            {pacoteArquivos.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl">
                <FileText className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                <p className="text-gray-500 text-sm">Nenhum arquivo adicionado ainda.</p>
              </div>
            ) : (
              pacoteArquivos.map(arq => (
                <div key={arq.id} className="flex items-center justify-between p-4 bg-[#0a0a0f] border border-white/10 rounded-2xl hover:bg-white/5 transition-colors group">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center">
                      <FileText className="w-5 h-5 text-gray-400 group-hover:text-violet-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white truncate max-w-[250px]">{arq.arquivo_nome}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest">{arq.formato} • {new Date(arq.criado_em).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => openFileUrl(arq)}
                      className="p-2 bg-white/5 border border-white/10 rounded-lg text-gray-400 hover:text-cyan-400 hover:border-cyan-500/30 transition-all"
                      title="Visualizar"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    {activePacote.status === 'rascunho' && (
                      <button 
                        onClick={(e) => handleDeleteArquivo(e, arq.id, arq.arquivo_url)}
                        className={`p-2 rounded-lg border transition-all ${
                          confirmDeleteArqId === arq.id 
                            ? 'bg-rose-500 border-rose-500 text-white animate-pulse' 
                            : 'bg-white/5 border-white/10 text-gray-400 hover:text-rose-400 hover:border-rose-500/30'
                        }`}
                        title={confirmDeleteArqId === arq.id ? 'Clique novamente para confirmar' : 'Remover'}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Ações do Pacote */}
          {activePacote.status === 'rascunho' && (
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Upload de mais arquivos */}
              <div className="flex-1 relative">
                <div className="border-2 border-dashed border-white/10 hover:border-violet-500/50 rounded-2xl p-4 text-center cursor-pointer transition-all bg-[#0a0a0f] group">
                  <input
                    type="file"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    multiple
                    onChange={async e => { 
                      const files = Array.from(e.target.files || []);
                      for (const f of files) { await handleUploadArquivo(f); }
                      e.target.value = ''; 
                    }}
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    disabled={isUploading}
                  />
                  {isUploading ? (
                    <Loader2 className="w-6 h-6 text-violet-400 animate-spin mx-auto" />
                  ) : (
                    <div className="flex items-center justify-center gap-2 text-gray-500 group-hover:text-violet-400 transition-colors">
                      <Plus className="w-5 h-5" />
                      <span className="text-xs font-black uppercase tracking-widest">Adicionar Arquivo</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Botão Concluir */}
              <button
                onClick={handleConcluirPacote}
                className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Concluir e Enviar
              </button>
            </div>
          )}

          {activePacote.status === 'solicitar_correcao' && activePacote.comentario_correcao && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-300 mt-4">
              <span className="font-black text-rose-400 text-xs uppercase tracking-widest block mb-1">Correção Solicitada:</span>
              {activePacote.comentario_correcao}
            </div>
          )}
        </div>
      ) : (
        /* ═══ FORMULÁRIO CRIAR/ABRIR PACOTE ═══ */
        <div className="border border-white/10 rounded-3xl bg-white/5 p-6 shadow-xl">
          <h3 className="font-black text-white text-lg mb-6 flex items-center gap-2">
            <UploadCloud className="text-violet-400 w-5 h-5"/>
            Nova Emissão / Abrir Existente
          </h3>
          <form onSubmit={handleCriarOuAbrirPacote} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Condomínio</label>
              <select
                value={condoId} onChange={e => setCondoId(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-white/10 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-violet-500" required
              >
                <option value="">Selecione...</option>
                {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-widest mb-1.5">Mês / Ano</label>
              <div className="flex gap-2">
                <input type="number" min="1" max="12" value={mes} onChange={e => setMes(parseInt(e.target.value))}
                  className="w-1/2 bg-[#0a0a0f] border border-white/10 rounded-xl px-3 py-3 text-sm text-white" />
                <input type="number" value={ano} onChange={e => setAno(parseInt(e.target.value))}
                  className="w-1/2 bg-[#0a0a0f] border border-white/10 rounded-xl px-3 py-3 text-sm text-white" />
              </div>
            </div>
            <div>
              <button type="submit" className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2">
                <FolderOpen className="w-4 h-4" />
                Abrir Pacote
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ═══ VISÃO POR CARTEIRA ═══ */}
      <div className="space-y-4">
        <h3 className="font-black text-white text-lg flex items-center gap-2">
          <Clock className="text-cyan-400 w-5 h-5"/>
          Emissões por Carteira — {String(mes).padStart(2,'0')}/{ano}
        </h3>

        {Object.entries(carteiras).map(([gerente, condos]) => {
          const isExpanded = expandedCarteiras[gerente] !== false; // default aberto
          return (
            <div key={gerente} className="border border-white/10 rounded-2xl bg-[#0a0a0f] overflow-hidden">
              <button
                onClick={() => toggleCarteira(gerente)}
                className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-violet-400" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                  <span className="text-sm font-black text-white uppercase tracking-widest">{gerente}</span>
                  <span className="text-[10px] font-bold text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{condos.length} condos</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-white/5">
                  {condos.map(condo => {
                    const key = `${condo.id}_${mes}_${ano}`;
                    const pacote = pacotesPorCondo[key];
                    const numArquivos = pacote?.numArquivos || 0;

                    return (
                      <div key={condo.id} className="flex items-center justify-between px-6 py-3 border-b border-white/5 last:border-b-0 hover:bg-white/[0.02] transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-gray-600 shrink-0" />
                          <span className="text-sm font-bold text-gray-300 truncate max-w-[250px]">{condo.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {pacote ? (
                            <>
                              <span className="text-[10px] font-bold text-gray-500">{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}</span>
                              <StatusBadge status={pacote.status} />
                              <button
                                onClick={() => abrirPacote(pacote)}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-black text-cyan-400 uppercase tracking-widest transition-all"
                              >
                                Abrir
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setCondoId(condo.id); handleCriarOuAbrirPacote(); }}
                              className="px-3 py-1.5 bg-white/5 hover:bg-violet-500/20 border border-white/10 hover:border-violet-500/30 rounded-lg text-[10px] font-black text-gray-500 hover:text-violet-400 uppercase tracking-widest transition-all"
                            >
                              + Criar
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ═══ MODAL DE CONCLUSÃO ═══ */}
      {showConcluirModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h3 className="text-xl font-black text-white text-center mb-2">Concluir Emissão</h3>
            <p className="text-sm text-gray-400 text-center mb-8">
              {pacoteArquivos.length} arquivo{pacoteArquivos.length !== 1 ? 's' : ''} neste pacote.
            </p>

            <div className="space-y-3 mb-8">
              <button
                onClick={() => setNivelAprovacao(1)}
                className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                  nivelAprovacao === 1 
                    ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10' 
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                  {nivelAprovacao === 1 && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                </div>
                <div>
                  <p className="text-sm font-black text-white">Nível 1 - Fração</p>
                  <p className="text-[10px] text-gray-400">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(2)}
                className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                  nivelAprovacao === 2 
                    ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/10' 
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-cyan-500' : 'border-gray-600'}`}>
                  {nivelAprovacao === 2 && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
                </div>
                <div>
                  <p className="text-sm font-black text-white">Nível 2 - Sem consumos</p>
                  <p className="text-[10px] text-gray-400">Passa direto para a Supervisora</p>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(3)}
                className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                  nivelAprovacao === 3 
                    ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' 
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-emerald-500' : 'border-gray-600'}`}>
                  {nivelAprovacao === 3 && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                </div>
                <div>
                  <p className="text-sm font-black text-white">Nível 3 - Com empresas terceirizadas</p>
                  <p className="text-[10px] text-gray-400">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                </div>
              </button>
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
