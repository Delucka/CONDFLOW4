'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { UploadCloud, FileText, CheckCircle, Clock, Loader2, Trash2, Package, ChevronDown, ChevronRight, Send, FolderOpen, Plus, X, FileCheck, Lock, Unlock, ClipboardCheck, StickyNote } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import ModalPreparacao from './ModalPreparacao';
import { FileWarning } from 'lucide-react';

export default function VisaoEmissor({ profile }) {
  // VERSÃO 4.1 - BOTÃO REGISTRAR ESTABILIZADO
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
  const [showRegistroModal, setShowRegistroModal] = useState(false);
  const [dataRegistro, setDataRegistro] = useState('');

  // Carteiras expandidas
  const [expandedCarteiras, setExpandedCarteiras] = useState({});

  // Mapa de status dos processos por condomínio { condoId: { id, status } }
  const [processosMap, setProcessosMap] = useState({});
  const [lockingCondo, setLockingCondo] = useState(null); // id do condo sendo alterado

  // Mapa de etapas de preparação { `${condoId}_${mes}_${ano}`: { etapa, data_fatura, data_relatorio, ... } }
  const [preparacaoMap, setPreparacaoMap] = useState({});
  const [modalPrepCondo, setModalPrepCondo] = useState(null);

  // Mapa de alterações prevista: { `${condoId}_${mes}_${ano}`: [alteracoes...] }
  const [alteracoesPrevMap, setAlteracoesPrevMap] = useState({});

  // Picker de concessionaria (dropdown que abre antes do file picker)
  const [showConcessionariaPicker, setShowConcessionariaPicker] = useState(false);
  const [pendingCategoria, setPendingCategoria] = useState(null); // categoria escolhida, esperando arquivo
  const [pendingSubtipo, setPendingSubtipo]     = useState(null);

  // Form inline para dados manuais da fatura de concessionaria
  const [editandoFaturaId, setEditandoFaturaId] = useState(null);
  const [savingFaturaId, setSavingFaturaId]     = useState(null);

  // Formata valor digitado como R$ (mascara progressiva por centavos)
  function maskValor(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (!digits) return '';
    const cents = parseInt(digits, 10);
    return (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function parseValor(masked) {
    const s = String(masked || '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async function salvarDadosFatura(arq, payload) {
    setSavingFaturaId(arq.id);
    try {
      const { error } = await supabase.from('emissoes_arquivos').update({
        nome_condominio_fatura: payload.nome_condominio_fatura || null,
        vencimento_fatura: payload.vencimento_fatura || null,
        valor_fatura: payload.valor_fatura,
        dados_extraidos_em: new Date().toISOString(),
      }).eq('id', arq.id);
      if (error) throw error;
      addToast('Dados salvos!', 'success');
      setEditandoFaturaId(null);
      await fetchArquivosDoPacote(activePacote.id);
    } catch (e) {
      addToast('Erro ao salvar: ' + e.message, 'error');
    } finally {
      setSavingFaturaId(null);
    }
  }

  useEffect(() => {
    fetchDados();
    
    const channel = supabase.channel(`emissor_pacotes_${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => { fetchPacotes(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_arquivos' }, () => {
        if (activePacote) fetchArquivosDoPacote(activePacote.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'processos' }, fetchProcessos)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_preparacao' }, () => fetchPreparacao())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alteracoes_rateio' }, () => fetchAlteracoes())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Refaz a busca de preparacao quando mes/ano mudam
  useEffect(() => { fetchPreparacao(); fetchAlteracoes(); }, [mes, ano]);

  async function fetchAlteracoes() {
    const { data } = await supabase
      .from('alteracoes_rateio')
      .select('id, condominio_id, mes_referencia, ano_referencia, tipo, data_evento, descricao, status')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano)
      .eq('status', 'prevista');
    if (data) {
      const map = {};
      data.forEach(a => {
        const k = `${a.condominio_id}_${a.mes_referencia}_${a.ano_referencia}`;
        if (!map[k]) map[k] = [];
        map[k].push(a);
      });
      setAlteracoesPrevMap(map);
    }
  }

  async function fetchDados() {
    setLoading(true);
    try {
      await Promise.all([fetchCondominios(), fetchPacotes(), fetchProcessos(), fetchPreparacao()]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPreparacao() {
    const { data } = await supabase
      .from('emissoes_preparacao')
      .select('*')
      .eq('mes_referencia', mes)
      .eq('ano_referencia', ano);
    if (data) {
      const map = {};
      data.forEach(p => { map[`${p.condominio_id}_${p.mes_referencia}_${p.ano_referencia}`] = p; });
      setPreparacaoMap(map);
    }
  }

  async function fetchProcessos() {
    const anoAtual = new Date().getFullYear();
    const semAtual = new Date().getMonth() < 6 ? 1 : 2;
    const { data } = await supabase
      .from('processos')
      .select('id, condominio_id, status')
      .eq('year', anoAtual)
      .eq('semester', semAtual);
    if (data) {
      const map = {};
      data.forEach(p => { map[p.condominio_id] = { id: p.id, status: p.status }; });
      setProcessosMap(map);
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

  // Toggle cadeado planilha por condomínio
  async function handleToggleLock(condo) {
    const proc = processosMap[condo.id];
    const isLocked = proc?.status === 'Edição finalizada';
    const novoStatus = isLocked ? 'Em edição' : 'Edição finalizada';

    // Optimistic
    setLockingCondo(condo.id);
    setProcessosMap(prev => ({
      ...prev,
      [condo.id]: { ...prev[condo.id], status: novoStatus }
    }));

    try {
      await apiPost(`/api/condominio/${condo.id}/processo/force`, {
        status: novoStatus,
        year: new Date().getFullYear()
      });
      addToast(
        isLocked ? `Planilha de ${condo.name} reaberta` : `Planilha de ${condo.name} bloqueada`,
        isLocked ? 'success' : 'info'
      );
    } catch (err) {
      // Rollback
      setProcessosMap(prev => ({
        ...prev,
        [condo.id]: proc
      }));
      addToast('Erro ao alterar status: ' + err.message, 'error');
    } finally {
      setLockingCondo(null);
    }
  }

  // --- AÇÕES ---

  // Helper: mes/ano selecionado está no passado (já encerrou)?
  function mesAnoNoPassado(m, a) {
    const lastDay = new Date(a, m, 0, 23, 59, 59);
    return new Date() > lastDay;
  }
  const periodoPassado = mesAnoNoPassado(mes, ano);

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
    } else if (periodoPassado) {
      addToast(`Não é possível criar emissão para ${String(mes).padStart(2,'0')}/${ano} — mês já encerrado.`, 'error');
      return;
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

  async function handleUploadArquivo(fileInput, opts = {}) {
    if (!fileInput || !activePacote) return;
    // categoria: 'emissao' (default) | 'concessionaria' | 'outros'
    // subtipo:   string livre (ex: SABESP, COMGAS, ENEL)
    const categoria = opts.categoria || 'emissao';
    const subtipo   = opts.subtipo || null;

    setIsUploading(true);
    try {
      const extensao = fileInput.name.split('.').pop().toLowerCase();
      const randomId = Math.random().toString(36).substring(7);
      const filePath = `${activePacote.condominio_id}/${ano}/${mes}/${categoria}/${randomId}_${fileInput.name}`;

      const { error: uploadError } = await supabase.storage.from('emissoes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;

      const { data: inserted, error: dbError } = await supabase
        .from('emissoes_arquivos')
        .insert({
          condominio_id: activePacote.condominio_id,
          pacote_id: activePacote.id,
          tipo: 'emissao',
          categoria,
          subtipo,
          arquivo_url: filePath,
          arquivo_nome: fileInput.name,
          formato: extensao,
          mes_referencia: mes,
          ano_referencia: ano,
          status: 'pendente',
          uploaded_by: profile.id
        })
        .select('id')
        .single();

      if (dbError) throw dbError;

      addToast(`${fileInput.name} adicionado!`, 'success');
      await fetchArquivosDoPacote(activePacote.id);
      fetchPacotes();

      // Para concessionaria: ja deixa o form de dados aberto pra preencher
      if (categoria === 'concessionaria' && inserted?.id) {
        setEditandoFaturaId(inserted.id);
      }
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

  async function handleRegistrar(pacote) {
    setActivePacote(pacote);
    const now = new Date();
    const localNow = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    setDataRegistro(localNow);
    setShowRegistroModal(true);
  }

  async function confirmarRegistro() {
    if (!dataRegistro) return addToast('Informe a data e hora', 'error');

    const selectedDate = new Date(dataRegistro);
    if (selectedDate < new Date(new Date().getTime() - 60000)) {
      return addToast('Não é permitido registrar no passado', 'error');
    }

    // Capturar snapshot da planilha para congelar os valores no momento da emissão
    const { data: { session } } = await supabase.auth.getSession();
    let planilha_snapshot = null;
    if (session?.access_token && activePacote.condominio_id) {
      try {
        const resp = await fetch(
          `/api/condominio/${activePacote.condominio_id}/conferencia?mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}&retificacao=false`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        if (resp.ok) {
          const conf = await resp.json();
          if (conf.planilha) {
            planilha_snapshot = {
              ...conf.planilha,
              meses: (conf.planilha.meses || []).filter(m => m.mes === activePacote.mes_referencia),
            };
          }
        }
      } catch { /* snapshot é opcional — não bloqueia o registro */ }
    }

    const semestre = activePacote.mes_referencia <= 6 ? 1 : 2;
    const { data: processo } = await supabase
      .from('processos')
      .select('id')
      .eq('condominio_id', activePacote.condominio_id)
      .eq('year', activePacote.ano_referencia)
      .eq('semester', semestre)
      .maybeSingle();

    // status = 'registrado' | NÃO lacra (fica visível no painel até ser expedida)
    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({
        status: 'registrado',
        atualizado_em: selectedDate.toISOString(),
        ...(processo?.id ? { processo_id: processo.id } : {}),
        ...(planilha_snapshot ? { planilha_snapshot } : {}),
      })
      .eq('id', activePacote.id);

    if (error) {
      addToast('Erro ao registrar: ' + error.message, 'error');
    } else {
      addToast('Emissão registrada! Aguardando expedição.', 'success');
      setShowRegistroModal(false);
      setActivePacote(null);
      fetchPacotes();
    }
  }

  async function handleCancelarRascunho() {
    if (!activePacote || activePacote.status !== 'rascunho') return;
    const confirma = window.confirm(
      `Tem certeza que deseja CANCELAR o rascunho de ${activePacote.condominios?.name || 'este condomínio'}?\n\n` +
      `Esta ação:\n` +
      `• Apaga o pacote (rascunho)\n` +
      `• Apaga todos os ${pacoteArquivos.length} arquivo${pacoteArquivos.length !== 1 ? 's' : ''} enviado${pacoteArquivos.length !== 1 ? 's' : ''}\n` +
      `• NÃO pode ser desfeita`
    );
    if (!confirma) return;

    try {
      // 1. Apaga arquivos do storage + tabela
      const paths = (pacoteArquivos || []).map(a => a.arquivo_url).filter(Boolean);
      if (paths.length) {
        try { await supabase.storage.from('emissoes').remove(paths); } catch {}
      }
      const { error: errArq } = await supabase
        .from('emissoes_arquivos').delete().eq('pacote_id', activePacote.id);
      if (errArq) throw errArq;

      // 2. Apaga o pacote
      const { error: errPac } = await supabase
        .from('emissoes_pacotes').delete().eq('id', activePacote.id);
      if (errPac) throw errPac;

      addToast('Rascunho cancelado e arquivos removidos.', 'success');
      setActivePacote(null);
      setPacoteArquivos([]);
      fetchPacotes();
    } catch (err) {
      addToast('Erro ao cancelar: ' + (err.message || err), 'error');
    }
  }

  async function handleConcluirPacote() {
    if (pacoteArquivos.length === 0) return addToast('Adicione pelo menos 1 arquivo antes de concluir.', 'warning');
    setShowConcluirModal(true);
  }

  async function handleConcluirRapido(pacote) {
    if (pacote.numArquivos === 0) return addToast('Este pacote está vazio.', 'warning');
    
    // Buscar arquivos do pacote para garantir que o modal tenha a contagem correta
    const { data } = await supabase.from('emissoes_arquivos').select('id').eq('pacote_id', pacote.id);
    setPacoteArquivos(data || []);
    setActivePacote(pacote);
    setShowConcluirModal(true);
  }


  async function confirmarConclusao() {
    let initialStatus = 'Aguardando Gerente';
    // Nível 1 passa direto para a supervisora
    if (nivelAprovacao === 1) {
      initialStatus = 'Aguardando Supervisor';
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update({ 
        status: initialStatus, 
        nivel_aprovacao: String(nivelAprovacao),
        atualizado_em: new Date().toISOString() 
      })
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
        mes: arq.mes_referencia || activePacote?.mes_referencia,
        ano: arq.ano_referencia || activePacote?.ano_referencia,
        eh_retificacao: activePacote?.eh_retificacao || false,
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
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest flex items-center gap-3">
                  Emissão {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia} • <StatusBadge status={activePacote.status} />
                  
                  {/* Botão de Registro Rápido no Painel Ativo */}
                  {(activePacote.status || '').toLowerCase() === 'aprovado' && (
                    <button 
                      onClick={() => handleRegistrar(activePacote)} 
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/20 font-black text-[9px] uppercase tracking-widest border border-white/10"
                    >
                      <FileCheck className="w-3.5 h-3.5" />
                      <span>Registrar Agora</span>
                    </button>
                  )}
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
              pacoteArquivos.map(arq => {
                const catColor = arq.categoria === 'concessionaria' ? 'orange'
                              : arq.categoria === 'outros'          ? 'slate'
                              : 'violet';
                const catLabel = arq.categoria === 'concessionaria' ? (arq.subtipo || 'Concessionária')
                              : arq.categoria === 'outros'          ? (arq.subtipo || 'Outros')
                              : 'Emissão';
                return (
                <div key={arq.id} className="p-4 bg-[#0a0a0f] border border-white/10 rounded-2xl hover:bg-white/5 transition-colors group">
                  <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 bg-${catColor}-500/10 rounded-xl flex items-center justify-center border border-${catColor}-500/20`}>
                      <FileText className={`w-5 h-5 text-${catColor}-400`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-${catColor}-500/10 text-${catColor}-300 border border-${catColor}-500/30`}>
                          {catLabel}
                        </span>
                      </div>
                      <p className="text-sm font-bold text-white truncate max-w-[250px]">{arq.arquivo_nome}</p>
                      <p className="text-[10px] text-gray-500 uppercase tracking-widest">{arq.formato} • {new Date(arq.criado_em).toLocaleString('pt-BR')}</p>
                      {arq.categoria === 'concessionaria' && editandoFaturaId !== arq.id && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                          {arq.nome_condominio_fatura ? (
                            <span className="text-orange-300/90"><span className="text-orange-500/60">cliente:</span> {arq.nome_condominio_fatura}</span>
                          ) : null}
                          {arq.vencimento_fatura ? (
                            <span className="text-orange-300/90"><span className="text-orange-500/60">venc:</span> {new Date(arq.vencimento_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                          ) : null}
                          {arq.valor_fatura != null ? (
                            <span className="text-orange-300/90 font-bold"><span className="text-orange-500/60 font-normal">total:</span> R$ {Number(arq.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          ) : null}
                          {activePacote.status === 'rascunho' && (
                            <button
                              onClick={() => setEditandoFaturaId(arq.id)}
                              className="text-[10px] text-orange-400/70 hover:text-orange-300 underline decoration-dotted"
                            >
                              {arq.valor_fatura != null ? 'editar dados' : '+ preencher dados'}
                            </button>
                          )}
                        </div>
                      )}
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

                  {/* Form inline de dados manuais da fatura */}
                  {arq.categoria === 'concessionaria' && editandoFaturaId === arq.id && (
                    <FaturaInlineForm
                      arq={arq}
                      condoNome={activePacote.condominio_nome || activePacote.nome_condominio || ''}
                      maskValor={maskValor}
                      parseValor={parseValor}
                      saving={savingFaturaId === arq.id}
                      onCancel={() => setEditandoFaturaId(null)}
                      onSave={(payload) => salvarDadosFatura(arq, payload)}
                    />
                  )}
                </div>
                );
              })
            )}
          </div>

          {/* Ações do Pacote */}
          {activePacote.status === 'rascunho' && (
            <div className="space-y-3">
              {/* 3 zonas de upload por categoria */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* EMISSÃO (violeta) */}
                <div className="relative border-2 border-dashed border-violet-500/20 hover:border-violet-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-violet-500/5 group">
                  <input type="file" multiple disabled={isUploading}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      for (const f of files) { await handleUploadArquivo(f, { categoria: 'emissao' }); }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-violet-400 group-hover:text-violet-300">
                    <FileText className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Emissão</span>
                    <span className="text-[9px] text-violet-500/70">Boleto/PDF principal</span>
                  </div>
                </div>

                {/* CONCESSIONÁRIA (laranja) — abre menu antes do file picker */}
                <div className="relative border-2 border-dashed border-orange-500/20 hover:border-orange-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-orange-500/5 group"
                  onClick={() => !isUploading && setShowConcessionariaPicker(true)}>
                  <div className="flex flex-col items-center gap-1 text-orange-400 group-hover:text-orange-300">
                    <Package className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Concessionária</span>
                    <span className="text-[9px] text-orange-500/70">SABESP / COMGAS / ENEL</span>
                  </div>
                </div>

                {/* OUTROS (cinza) */}
                <div className="relative border-2 border-dashed border-slate-500/20 hover:border-slate-400/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-slate-500/5 group">
                  <input type="file" multiple disabled={isUploading}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      const subtipo = window.prompt('Descreva este anexo (ex: Ata da reunião, relatório de leitura):', '');
                      for (const f of files) { await handleUploadArquivo(f, { categoria: 'outros', subtipo: subtipo || null }); }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-slate-300">
                    <FolderOpen className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Outros</span>
                    <span className="text-[9px] text-slate-500/70">Atas, relatórios, etc</span>
                  </div>
                </div>
              </div>

              {/* Botões de ação do rascunho */}
              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                <button
                  onClick={handleCancelarRascunho}
                  className="px-6 py-3 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 hover:text-rose-300 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-2"
                  title="Apaga o rascunho e todos os arquivos enviados"
                >
                  <Trash2 className="w-4 h-4" />
                  Cancelar Rascunho
                </button>
                <button
                  onClick={handleConcluirPacote}
                  className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-xl shadow-emerald-600/20 active:scale-95 flex items-center justify-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Concluir e Enviar
                </button>
              </div>
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
              <button type="submit"
                title={periodoPassado ? 'Mês encerrado — só permite abrir pacote já existente' : 'Criar ou abrir pacote'}
                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2 ${
                  periodoPassado
                    ? 'bg-white/5 border border-white/10 text-gray-500'
                    : 'bg-violet-600 hover:bg-violet-500 text-white'
                }`}>
                <FolderOpen className="w-4 h-4" />
                {periodoPassado ? 'Apenas Abrir' : 'Abrir Pacote'}
              </button>
            </div>
          </form>
          {periodoPassado && (
            <div className="mt-4 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span><strong>{String(mes).padStart(2,'0')}/{ano}</strong> já passou — só é possível abrir pacotes existentes. Novas emissões só podem ser criadas para o mês atual ou meses futuros.</span>
            </div>
          )}
        </div>
      )}

      {/* ═══ VISÃO POR CARTEIRA ═══ */}
      <div className="space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h3 className="font-black text-white text-lg flex items-center gap-2">
            <Clock className="text-cyan-400 w-5 h-5"/>
            Emissões por Carteira — {String(mes).padStart(2,'0')}/{ano}
          </h3>
          {periodoPassado && (
            <span className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Período encerrado · só leitura
            </span>
          )}
        </div>

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
                    const prep = preparacaoMap[`${condo.id}_${mes}_${ano}`];
                    const isPronto = prep?.etapa === 'pronto_para_emitir';
                    // Alterações previstas (AGO/AGE/Reunião) BLOQUEIAM criação do pacote
                    const altsPrevistas = alteracoesPrevMap[`${condo.id}_${mes}_${ano}`] || [];
                    const temAltPrevista = altsPrevistas.length > 0;
                    // Gate: só pode criar pacote depois de marcar como pronto p/ emitir E sem alteração pendente
                    const canCreate = !temAltPrevista && (isPronto || !!pacote);

                    return (
                      <div key={condo.id} className={`flex items-center justify-between px-6 py-3 border-b border-white/5 last:border-b-0 transition-colors ${
                        temAltPrevista ? 'bg-amber-500/[0.05] hover:bg-amber-500/[0.08]'
                          : !pacote && isPronto ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'
                          : 'hover:bg-white/[0.02]'
                      }`}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-bold text-gray-300 truncate max-w-[280px]">{condo.name}</span>
                          {temAltPrevista && (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-black uppercase tracking-widest animate-pulse"
                                  title={altsPrevistas.map(a => `${a.tipo} em ${new Date(a.data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}${a.descricao ? ' — ' + a.descricao : ''}`).join('\n')}>
                              <FileWarning className="w-3 h-3" />
                              {altsPrevistas.length === 1
                                ? `${altsPrevistas[0].tipo} em ${new Date(altsPrevistas[0].data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}`
                                : `${altsPrevistas.length} alterações previstas`}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          {pacote ? (
                            <>
                              <span className="text-[10px] font-bold text-gray-500">{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}</span>
                              <StatusBadge status={pacote.status} />
                              {((pacote.status || '').toLowerCase() === 'rascunho' || (pacote.status || '').toLowerCase() === 'solicitar_correcao') && (
                                <button
                                  onClick={() => handleConcluirRapido(pacote)}
                                  className="p-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 rounded-lg text-emerald-400 transition-all"
                                  title="Enviar para Aprovação"
                                >
                                  <Send className="w-3 h-3" />
                                </button>
                              )}
                              {(() => {
                                const statusLower = (pacote.status || '').toLowerCase();
                                const podeRegistrar = statusLower === 'aprovado';
                                const roleAutorizado = profile?.role === 'master' || profile?.role === 'departamento';
                                
                                if (!podeRegistrar || !roleAutorizado) return null;

                                return (
                                  <button
                                    onClick={() => handleRegistrar(pacote)}
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 transition-all shadow-lg shadow-emerald-500/20 font-black text-[9px] uppercase tracking-widest border border-white/10"
                                  >
                                    <FileCheck className="w-3.5 h-3.5" />
                                    <span>Registrar</span>
                                  </button>
                                );
                              })()}
                              <button
                                onClick={() => abrirPacote(pacote)}
                                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-black text-cyan-400 uppercase tracking-widest transition-all"
                              >
                                Abrir
                              </button>
                            </>
                          ) : periodoPassado ? (
                            <span className="text-[10px] font-bold text-gray-600 uppercase tracking-widest italic">— sem pacote —</span>
                          ) : (
                            <>
                              {/* Etapa de preparação pré-emissão */}
                              {(() => {
                                const prep = preparacaoMap[`${condo.id}_${mes}_${ano}`];
                                const etapa = prep?.etapa;
                                const dataStr = etapa === 'aguardando_fatura' && prep?.data_fatura
                                  ? new Date(prep.data_fatura + 'T00:00:00').toLocaleDateString('pt-BR')
                                  : etapa === 'aguardando_relatorio' && prep?.data_relatorio
                                    ? new Date(prep.data_relatorio + 'T00:00:00').toLocaleDateString('pt-BR')
                                    : null;
                                return (
                                  <>
                                    {etapa && (
                                      <span className="hidden md:inline-flex items-center gap-1.5">
                                        <StatusBadge status={etapa} />
                                        {dataStr && <span className="text-[10px] font-bold text-gray-500">{dataStr}</span>}
                                        {prep?.notas && (
                                          <span className="relative group/notas">
                                            <button
                                              type="button"
                                              className="w-5 h-5 flex items-center justify-center rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-all"
                                              aria-label="Ver observações"
                                            >
                                              <StickyNote className="w-3 h-3" />
                                            </button>
                                            <span className="absolute right-0 top-full mt-1 z-50 hidden group-hover/notas:block w-64 p-3 bg-slate-950 border border-cyan-500/30 rounded-xl shadow-2xl shadow-cyan-500/10 pointer-events-none">
                                              <span className="block text-[9px] font-black text-cyan-400 uppercase tracking-widest mb-1">Observações</span>
                                              <span className="block text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">{prep.notas}</span>
                                            </span>
                                          </span>
                                        )}
                                      </span>
                                    )}
                                    <button
                                      onClick={() => setModalPrepCondo(condo)}
                                      title={etapa ? 'Editar etapa de preparação' : 'Definir etapa de preparação'}
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-[10px] font-black text-amber-400 uppercase tracking-widest transition-all"
                                    >
                                      <ClipboardCheck className="w-3 h-3" />
                                      {etapa ? 'Etapa' : 'Definir etapa'}
                                    </button>
                                  </>
                                );
                              })()}
                              <button
                                onClick={() => {
                                  if (temAltPrevista) {
                                    addToast(
                                      `Alteração prevista (${altsPrevistas[0].tipo}). Confirme com o gerente se já ocorreu antes de emitir.`,
                                      'warning'
                                    );
                                    return;
                                  }
                                  if (!canCreate) {
                                    addToast('Marque a etapa como "Pronto p/ emitir" antes de criar o pacote.', 'warning');
                                    setModalPrepCondo(condo);
                                    return;
                                  }
                                  setCondoId(condo.id);
                                  handleCriarOuAbrirPacote();
                                }}
                                title={
                                  temAltPrevista
                                    ? `BLOQUEADO: alteração prevista (${altsPrevistas[0].tipo}). Gerente precisa marcar como realizada/cancelada.`
                                    : !canCreate ? 'Conclua a preparação antes de criar o pacote' : 'Criar pacote de emissão'
                                }
                                className={`px-3 py-1.5 border rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                                  canCreate
                                    ? 'bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400'
                                    : 'bg-white/5 border-white/10 text-gray-600 cursor-not-allowed opacity-60'
                                }`}
                              >
                                + Criar
                              </button>
                            </>
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
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 1
                    ? 'border-violet-600 bg-violet-600/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                    : 'border-white/5 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 1 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-white">Nível 1 - Sem consumos</p>
                    <p className="text-xs text-gray-400">Passa direto para a Supervisora</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(2)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 2
                    ? 'border-violet-600 bg-violet-600/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                    : 'border-white/5 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 2 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-white">Nível 2 - Alteração sem consumo</p>
                    <p className="text-xs text-gray-400">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(3)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 3
                    ? 'border-violet-600 bg-violet-600/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                    : 'border-white/5 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 3 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-white">Nível 3 - Fração</p>
                    <p className="text-xs text-gray-400">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(4)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 4
                    ? 'border-violet-600 bg-violet-600/10 shadow-[0_0_15px_rgba(139,92,246,0.2)]'
                    : 'border-white/5 bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 4 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 4 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-white">Nível 4 - Com empresas terceirizadas</p>
                    <p className="text-xs text-gray-400">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                  </div>
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

      {modalPrepCondo && (
        <ModalPreparacao
          condo={modalPrepCondo}
          mes={mes}
          ano={ano}
          onClose={() => setModalPrepCondo(null)}
          onSaved={() => { fetchPreparacao(); fetchProcessos(); }}
        />
      )}

      {/* ═══ MODAL ESCOLHER CONCESSIONÁRIA ═══ */}
      {showConcessionariaPicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-[#0a0a0f] border border-orange-500/30 rounded-3xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
                <Package className="w-5 h-5 text-orange-400" /> Anexar Concessionária
              </h3>
              <button onClick={() => setShowConcessionariaPicker(false)} className="text-slate-500 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-400 mb-4">Qual concessionária?</p>
            <div className="grid grid-cols-2 gap-3">
              {['SABESP', 'COMGAS', 'ENEL', 'Outra'].map(sub => (
                <label key={sub}
                  className="cursor-pointer border-2 border-dashed border-orange-500/20 hover:border-orange-500/60 rounded-2xl p-4 text-center transition-all bg-orange-500/5 group relative">
                  <input type="file" multiple
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls"
                    onChange={async e => {
                      let finalSub = sub;
                      if (sub === 'Outra') {
                        finalSub = window.prompt('Nome da concessionária:', '') || 'Outra';
                      }
                      const files = Array.from(e.target.files || []);
                      setShowConcessionariaPicker(false);
                      for (const f of files) {
                        await handleUploadArquivo(f, { categoria: 'concessionaria', subtipo: finalSub });
                      }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-orange-300 group-hover:text-orange-200">
                    <Package className="w-6 h-6" />
                    <span className="text-sm font-black uppercase tracking-widest">{sub}</span>
                  </div>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-slate-600 mt-4 text-center">
              Clique em uma opção pra selecionar o arquivo
            </p>
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


// Form inline para dados manuais da fatura de concessionaria
function FaturaInlineForm({ arq, condoNome, maskValor, parseValor, saving, onCancel, onSave }) {
  const [nome, setNome]   = useState(arq.nome_condominio_fatura || condoNome || '');
  const [venc, setVenc]   = useState(arq.vencimento_fatura || '');
  const [valorMask, setValorMask] = useState(
    arq.valor_fatura != null
      ? Number(arq.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : ''
  );

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      nome_condominio_fatura: nome.trim() || null,
      vencimento_fatura: venc || null,
      valor_fatura: parseValor(valorMask),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-orange-500/20 grid grid-cols-1 md:grid-cols-12 gap-2">
      <div className="md:col-span-5">
        <label className="text-[9px] font-bold uppercase tracking-wider text-orange-400/70">Cliente na conta</label>
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: EDIFICIO ANDREA"
          className="w-full mt-0.5 bg-black/40 border border-orange-500/20 focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/40 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none"
        />
      </div>
      <div className="md:col-span-3">
        <label className="text-[9px] font-bold uppercase tracking-wider text-orange-400/70">Vencimento</label>
        <input
          type="date"
          value={venc}
          onChange={(e) => setVenc(e.target.value)}
          className="w-full mt-0.5 bg-black/40 border border-orange-500/20 focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/40 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none"
        />
      </div>
      <div className="md:col-span-2">
        <label className="text-[9px] font-bold uppercase tracking-wider text-orange-400/70">Valor (R$)</label>
        <input
          inputMode="numeric"
          value={valorMask}
          onChange={(e) => setValorMask(maskValor(e.target.value))}
          placeholder="0,00"
          className="w-full mt-0.5 bg-black/40 border border-orange-500/20 focus:border-orange-500/60 focus:ring-1 focus:ring-orange-500/40 rounded-lg px-2.5 py-1.5 text-sm text-white outline-none text-right font-mono"
        />
      </div>
      <div className="md:col-span-2 flex items-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 rounded-lg border border-white/10 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-white bg-orange-500 hover:bg-orange-400 rounded-lg disabled:opacity-50"
        >
          {saving ? '...' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}
