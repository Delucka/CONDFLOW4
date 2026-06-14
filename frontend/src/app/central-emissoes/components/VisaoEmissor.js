'use client';
import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { UploadCloud, FileText, CheckCircle, Check, Clock, Loader2, Trash2, Package, ChevronDown, ChevronRight, Send, FolderOpen, Plus, X, FileCheck, Lock, Unlock, ClipboardCheck, StickyNote, AlertCircle, Sparkles, Paperclip, Ban, ShieldCheck, Search } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { useToast } from '@/components/Toast';
import FilePreviewDrawer from '@/components/FilePreviewDrawer';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';
import { apiPost } from '@/lib/api';
import { ocrFileToText, parseFaturaOcr, decodeBoletoValor } from '@/lib/ocrClient';
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

  // Persiste mês/ano: mantém ao sair/voltar; só muda quando o usuário troca
  useEffect(() => {
    const m = parseInt(localStorage.getItem('emissor_mes') || '', 10); if (m >= 1 && m <= 12) setMes(m);
    const a = parseInt(localStorage.getItem('emissor_ano') || '', 10); if (a > 2000) setAno(a);
  }, []);
  useEffect(() => { try { localStorage.setItem('emissor_mes', String(mes)); localStorage.setItem('emissor_ano', String(ano)); } catch {} }, [mes, ano]);
  
  // Modal de conclusão
  const [showConcluirModal, setShowConcluirModal] = useState(false);
  const [nivelAprovacao, setNivelAprovacao] = useState(1);
  const [confirmDeleteArqId, setConfirmDeleteArqId] = useState(null);
  const [showRegistroModal, setShowRegistroModal] = useState(false);
  const [dataRegistro, setDataRegistro] = useState('');
  // Resposta de correção (gerente reenviando)
  const [respostaCorrecaoFile, setRespostaCorrecaoFile] = useState(null);
  const [respostaCorrecaoComentario, setRespostaCorrecaoComentario] = useState('');
  const [enviandoResposta, setEnviandoResposta] = useState(false);

  // Carteiras expandidas
  const [expandedCarteiras, setExpandedCarteiras] = useState({});
  const [buscaCarteira, setBuscaCarteira] = useState('');

  // Mapa de status dos processos por condomínio { condoId: { id, status } }
  const [processosMap, setProcessosMap] = useState({});
  const [lockingCondo, setLockingCondo] = useState(null); // id do condo sendo alterado

  // Mapa de etapas de preparação { `${condoId}_${mes}_${ano}`: { etapa, data_fatura, data_relatorio, ... } }
  const [preparacaoMap, setPreparacaoMap] = useState({});
  const [modalPrepCondo, setModalPrepCondo] = useState(null);

  // Mapa de alterações prevista: { `${condoId}_${mes}_${ano}`: [alteracoes...] }
  const [alteracoesPrevMap, setAlteracoesPrevMap] = useState({});

  // Extração automática de PDF (concessionaria/relatorio)
  const [extraindo, setExtraindo] = useState(false);  // overlay "Lendo PDF..."
  const [ocrProg, setOcrProg] = useState(null);       // {p,n} progresso do OCR de scan
  // Modal de revisão (extração com baixa confiança ou empresa não identificada)
  const [revisaoInfo, setRevisaoInfo] = useState(null); // { extracao, categoria, alertas, file }
  // Modal de duplicata detectada
  const [duplicataInfo, setDuplicataInfo] = useState(null); // { alertas, anomalia, pendingFile, pendingMeta }
  const [sancionandoMotivo, setSancionandoMotivo] = useState('');
  const [sancionandoAnexo, setSancionandoAnexo] = useState(null); // File do documento de aprovação
  const [sancionando, setSancionando] = useState(false);
  const [pertencimentoInfo, setPertencimentoInfo] = useState(null); // { alerta, file, categoria } — bloqueio duro, sem sancionamento

  // Cadastro de Seguro Proteção por código de condomínio { "0020": [{cod,tipo,valor}, ...] }
  const [segurosMap, setSegurosMap] = useState({});
  useEffect(() => {
    fetch('/condominios_seguros.json', { cache: 'force-cache' })
      .then(r => (r.ok ? r.json() : {}))
      .then(setSegurosMap)
      .catch(() => {});
  }, []);

  // Referência do gerente (planilha do mês + cobranças extras) na tela de anexos
  const [confData, setConfData]       = useState(null);  // { planilha, cobrancas_extras }
  const [confLoading, setConfLoading] = useState(false);
  const [cobrancasSel, setCobrancasSel] = useState(null); // Set de ids selecionados (null = ainda carregando)

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

  // Carrega a referência do gerente (planilha do mês + cobranças extras) ao abrir um pacote
  useEffect(() => {
    if (!activePacote?.condominio_id) { setConfData(null); setCobrancasSel(null); return; }
    let cancel = false;
    (async () => {
      setConfLoading(true);
      try {
        const token = await getAccessToken();
        const resp = await fetch(
          `/api/condominio/${activePacote.condominio_id}/conferencia?mes=${activePacote.mes_referencia}&ano=${activePacote.ano_referencia}&retificacao=false`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!resp.ok || cancel) return;
        const d = await resp.json();
        if (cancel) return;
        setConfData(d);
        const ids = (d.cobrancas_extras || []).map(c => c.id);
        const salvas = activePacote.cobrancas_incluidas;
        // Seleção inicial: o que já foi salvo no pacote, senão todas marcadas
        setCobrancasSel(new Set(Array.isArray(salvas) ? salvas.filter(id => ids.includes(id)) : ids));
      } catch { /* referência é opcional, não bloqueia a emissão */ }
      finally { if (!cancel) setConfLoading(false); }
    })();
    return () => { cancel = true; };
  }, [activePacote?.id]);

  // Marca/desmarca uma cobrança e persiste a seleção no pacote
  async function toggleCobranca(id) {
    setCobrancasSel(prev => {
      const next = new Set(prev || []);
      if (next.has(id)) next.delete(id); else next.add(id);
      const arr = Array.from(next);
      supabase.from('emissoes_pacotes').update({ cobrancas_incluidas: arr }).eq('id', activePacote.id)
        .then(({ error }) => { if (error) addToast('Erro ao salvar seleção: ' + error.message, 'error'); });
      return next;
    });
  }

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

  async function sha256OfFile(file) {
    const buf = await file.arrayBuffer();
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function handleUploadArquivo(fileInput, opts = {}) {
    if (!fileInput || !activePacote) return;
    // categoria: 'emissao' | 'concessionaria' | 'outros' | 'relatorio_leitura'
    const categoria = opts.categoria || 'emissao';
    const subtipo   = opts.subtipo || null;
    const extras    = opts.extras || {};  // campos especificos (relatorio_*, etc)
    const skipDuplicataCheck = opts.skipDuplicataCheck || false;

    setIsUploading(true);
    try {
      // 1) Verifica duplicata ANTES de subir o arquivo (so para concessionaria e relatorio)
      let arquivoHash = null;
      if (!skipDuplicataCheck && (categoria === 'concessionaria' || categoria === 'relatorio_leitura')) {
        try {
          arquivoHash = await sha256OfFile(fileInput);
        } catch {}

        const checkBody = {
          tipo: categoria === 'relatorio_leitura' ? 'relatorio' : 'fatura',
          condominio_id: activePacote.condominio_id,
          mes_referencia: mes,
          ano_referencia: ano,
          arquivo_hash: arquivoHash,
        };
        if (categoria === 'concessionaria') {
          checkBody.concessionaria = (subtipo || '').toUpperCase();
          checkBody.leitura_atual = extras.leitura_atual_fatura || null;
          checkBody.proxima_leitura = extras.proxima_leitura_fatura || null;
          checkBody.vencimento = extras.vencimento_fatura || null;
          checkBody.valor = extras.valor_fatura ?? null;
        } else {
          checkBody.empresa = (extras.relatorio_empresa || '').toUpperCase();
          checkBody.tipo_servico = (extras.relatorio_tipo_servico || '').toLowerCase();
          checkBody.consumo_total = extras.relatorio_consumo_total;
          checkBody.numero_unidades = extras.relatorio_unidades;
          checkBody.valor_total = extras.relatorio_valor_total;
        }
        try {
          const check = await apiPost('/api/consumos/check-duplicata-completa', checkBody);
          if (check?.bloqueia) {
            // Abre modal de sancionamento
            setDuplicataInfo({
              alertas: check.alertas || [],
              anomalia: check.anomalia,
              pendingFile: fileInput,
              pendingMeta: { categoria, subtipo, extras, arquivoHash },
            });
            setIsUploading(false);
            return;
          }
          // Alertas amarelos so avisam, nao bloqueiam
          const avisos = (check?.alertas || []).filter(a => a.nivel === 'aviso');
          if (avisos.length > 0) {
            addToast(`⚠ ${avisos[0].mensagem}`, 'warning');
          }
        } catch (e) {
          console.warn('check-duplicata-completa falhou (ignorando):', e?.message);
        }
      }

      // 2) Upload do arquivo
      const extensao = fileInput.name.split('.').pop().toLowerCase();
      const displayName = opts.nomeArquivo || fileInput.name;  // nome padronizado quando houver
      const randomId = Math.random().toString(36).substring(7);
      const filePath = `${activePacote.condominio_id}/${ano}/${mes}/${categoria}/${randomId}_${displayName}`;
      const { error: uploadError } = await supabase.storage.from('emissoes').upload(filePath, fileInput);
      if (uploadError) throw uploadError;

      // 3) Insert na tabela emissoes_arquivos
      const insertPayload = {
        condominio_id: activePacote.condominio_id,
        pacote_id: activePacote.id,
        tipo: 'emissao',
        categoria,
        subtipo,
        arquivo_url: filePath,
        arquivo_nome: displayName,
        formato: extensao,
        mes_referencia: mes,
        ano_referencia: ano,
        status: 'pendente',
        uploaded_by: profile.id,
        ...extras,
      };
      if (arquivoHash && !insertPayload.arquivo_hash) insertPayload.arquivo_hash = arquivoHash;
      const { data: inserted, error: dbError } = await supabase
        .from('emissoes_arquivos')
        .insert(insertPayload)
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

  async function getAccessToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  }

  // Sobe o documento que comprova a APROVAÇÃO da repetição (anexo 'outros') e devolve {url, nome}
  async function uploadAnexoAprovacao(file) {
    const extensao = file.name.split('.').pop().toLowerCase();
    const randomId = Math.random().toString(36).substring(7);
    const displayName = `Aprovacao_repeticao_${file.name}`;
    const filePath = `${activePacote.condominio_id}/${ano}/${mes}/outros/${randomId}_${displayName}`;
    const { error: upErr } = await supabase.storage.from('emissoes').upload(filePath, file);
    if (upErr) throw upErr;
    await supabase.from('emissoes_arquivos').insert({
      condominio_id: activePacote.condominio_id,
      pacote_id: activePacote.id,
      tipo: 'emissao',
      categoria: 'outros',
      subtipo: 'Aprovação de repetição',
      arquivo_url: filePath,
      arquivo_nome: displayName,
      formato: extensao,
      mes_referencia: mes,
      ano_referencia: ano,
      status: 'pendente',
      uploaded_by: profile.id,
    });
    return { url: filePath, nome: displayName };
  }

  // Converte o dict da extração nos campos (colunas) de emissoes_arquivos
  function mapExtracaoToExtras(extracao, categoria) {
    const { texto_bruto, ...brutos } = extracao || {};
    const base = {
      arquivo_hash: extracao?.arquivo_hash || null,
      extracao_status: extracao?.status || (extracao?.erro ? 'falha' : ((extracao?.confianca || 0) >= 0.8 ? 'sucesso' : 'parcial')),
      extracao_confianca: extracao?.confianca ?? null,
      extracao_dados_brutos: brutos,
      extracao_em: new Date().toISOString(),
    };
    if (categoria === 'concessionaria') {
      return {
        ...base,
        nome_condominio_fatura: extracao?.cliente || null,
        vencimento_fatura: extracao?.vencimento || null,
        valor_fatura: extracao?.valor ?? null,
        leitura_atual_fatura: extracao?.leitura_atual || null,
        proxima_leitura_fatura: extracao?.proxima_leitura || null,
        dados_extraidos_em: new Date().toISOString(),
      };
    }
    // relatorio_leitura
    return {
      ...base,
      relatorio_empresa: extracao?.subtipo || null,
      relatorio_tipo_servico: extracao?.tipo_servico || 'agua',
      relatorio_data_leitura: extracao?.data_leitura || null,
      relatorio_unidades: extracao?.numero_unidades ?? null,
      relatorio_consumo_total: extracao?.consumo_total ?? null,
      relatorio_valor_total: extracao?.valor_total ?? null,
    };
  }

  // Detecta duplicata DENTRO do mesmo pacote (instantâneo, sem depender do banco/trigger).
  // Pega o caso "anexei a mesma conta 2x" mesmo antes da sincronização chegar em /consumos.
  function detectarDuplicataLocal(extracao, categoria) {
    const lista = pacoteArquivos || [];
    const hash = extracao?.arquivo_hash;
    // 1) Mesmo arquivo (hash idêntico)
    if (hash) {
      const igual = lista.find(a => a.arquivo_hash && a.arquivo_hash === hash);
      if (igual) return {
        nivel: 'bloqueio', tipo: 'hash_identico',
        mensagem: 'Este mesmo arquivo PDF já foi anexado nesta emissão.',
        detalhes: { arquivo_nome: igual.arquivo_nome },
      };
    }
    // 2) Mesma concessionária / mesma empresa de relatório no mesmo pacote (mesmo mês)
    if (categoria === 'concessionaria') {
      const sub = (extracao?.subtipo || '').toUpperCase();
      const igual = lista.find(a => a.categoria === 'concessionaria' && (a.subtipo || '').toUpperCase() === sub && sub);
      if (igual) return {
        nivel: 'bloqueio', tipo: 'fatura_ja_existe',
        mensagem: `Já existe uma fatura de ${sub} anexada nesta emissão.`,
        detalhes: { concessionaria: sub, arquivo_nome: igual.arquivo_nome },
      };
    } else if (categoria === 'relatorio_leitura') {
      const emp = (extracao?.subtipo || '').toUpperCase();
      const serv = (extracao?.tipo_servico || 'agua').toLowerCase();
      const igual = lista.find(a => a.categoria === 'relatorio_leitura'
        && (a.relatorio_empresa || '').toUpperCase() === emp && emp
        && (a.relatorio_tipo_servico || 'agua').toLowerCase() === serv);
      if (igual) return {
        nivel: 'bloqueio', tipo: 'relatorio_ja_existe',
        mensagem: `Já existe um relatório de ${emp} (${serv}) anexado nesta emissão.`,
        detalhes: { empresa_leitura: emp, tipo_servico: serv, arquivo_nome: igual.arquivo_nome },
      };
    }
    return null;
  }

  // Fluxo de upload com extração automática (concessionaria + relatorio_leitura).
  // 1) backend lê o PDF e já checa duplicata. 2) bloqueia -> modal sancionamento.
  // 3) confiança baixa / empresa não identificada -> modal de revisão pré-preenchido.
  // 4) confiança alta + sem bloqueio -> anexa direto.
  async function handleUploadComExtracao(file, categoria) {
    if (!file || !activePacote) return;
    setExtraindo(true);
    try {
      const token = await getAccessToken();
      const formData = new FormData();
      formData.append('file', file);
      const params = new URLSearchParams({
        condominio_id: activePacote.condominio_id,
        mes_referencia: String(mes),
        ano_referencia: String(ano),
      });
      const res = await fetch(`/api/consumos/extrair-pdf?${params}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      if (!res.ok) throw new Error(`Falha na leitura do PDF (HTTP ${res.status})`);
      const resp = await res.json();
      let extracao = resp.extracao;
      const { alertas, anomalia, bloqueia } = resp;

      // PDF escaneado (sem texto) -> OCR no navegador decifra a imagem e pré-preenche (você confere na revisão)
      const semCampos = !extracao || (extracao.valor == null && extracao.valor_total == null && !extracao.vencimento);
      if (semCampos && categoria === 'concessionaria') {
        try {
          setOcrProg({ p: 0, n: 1 });
          const bc = await decodeBoletoValor(file);                       // VALOR exato (código de barras)
          const texto = await ocrFileToText(file, (p, n) => setOcrProg({ p, n }));
          const parsed = parseFaturaOcr(texto);                            // vencimento + concessionária (OCR)
          extracao = {
            ...(extracao || {}), ...parsed,
            valor: (bc && bc.valor != null) ? bc.valor : parsed.valor,     // barcode tem prioridade sobre OCR
            subtipo: (extracao && extracao.subtipo) || parsed.subtipo,
            confianca: 0.5, ocr: true, barcode: bc ? bc.barcode : null, erro: null,
          };
        } catch (e) {
          addToast('Não consegui decifrar a imagem — preencha manualmente.', 'warning');
        } finally {
          setOcrProg(null);
        }
      }

      const extras = mapExtracaoToExtras(extracao, categoria);
      const subtipo = extracao?.subtipo
        || (categoria === 'relatorio_leitura' ? extras.relatorio_empresa : null);

      // 0) PERTENCIMENTO — bloqueio duro, sem sancionamento (conta de OUTRO condomínio)
      const alertaPert = (alertas || []).find(a => a.tipo === 'pertencimento');
      if (alertaPert) {
        setPertencimentoInfo({ alerta: alertaPert, file, categoria });
        return;
      }

      // 0.5) Duplicata LOCAL no mesmo pacote (instantânea)
      const localDup = detectarDuplicataLocal(extracao, categoria);
      if (localDup) {
        setDuplicataInfo({
          alertas: [localDup], anomalia: null,
          pendingFile: file, pendingMeta: { categoria, subtipo, extras },
        });
        return;
      }

      // 1) Duplicata bloqueante (banco) -> modal de sancionamento (reusa o existente)
      if (bloqueia) {
        setDuplicataInfo({
          alertas: (alertas || []).filter(a => a.tipo !== 'pertencimento'),
          anomalia,
          pendingFile: file,
          pendingMeta: { categoria, subtipo, extras },
        });
        return;
      }

      // 2) Baixa confiança / não identificou -> revisão manual pré-preenchida
      if (!extracao?.subtipo || (extracao?.confianca || 0) < 0.8) {
        setRevisaoInfo({ extracao: extracao || {}, categoria, alertas: alertas || [], file });
        return;
      }

      // 3) Confiança alta + sem bloqueio -> anexa direto
      const nomeArquivo = nomeArquivoPadrao(categoria, subtipo, extracao, file.name,
        condominios.find(c => c.id === activePacote.condominio_id)?.name);
      await handleUploadArquivo(file, { categoria, subtipo, extras, skipDuplicataCheck: true, nomeArquivo });
      if (extracao?.desbloqueado) addToast('🔓 PDF protegido foi desbloqueado automaticamente.', 'info');
      const avisos = (alertas || []).filter(a => a.nivel === 'aviso');
      if (avisos.length) addToast(`⚠ ${avisos[0].mensagem}`, 'warning');
    } catch (e) {
      addToast('Erro na leitura do PDF: ' + (e.message || e), 'error');
    } finally {
      setExtraindo(false);
    }
  }

  // Chamado pelo modal de revisão: usuário confirmou/corrigiu os dados.
  // Reroda a checagem de duplicata com os valores finais (skip = false).
  async function confirmarRevisao(categoria, subtipo, extras, file) {
    setRevisaoInfo(null);
    const nomeArquivo = nomeArquivoPadrao(categoria, subtipo, extras, file.name,
      condominios.find(c => c.id === activePacote?.condominio_id)?.name);
    await handleUploadArquivo(file, { categoria, subtipo, extras, skipDuplicataCheck: false, nomeArquivo });
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
    const ehRespostaCorrecao = (activePacote?.status || '').toLowerCase() === 'solicitar_correcao';
    // Quando reenvia apos correcao: exige arquivo + comentario
    if (ehRespostaCorrecao) {
      if (!respostaCorrecaoFile) return addToast('Anexe o arquivo corrigido.', 'warning');
      if (!respostaCorrecaoComentario.trim()) return addToast('Descreva o que foi corrigido.', 'warning');
    }

    setEnviandoResposta(true);

    let initialStatus = 'Aguardando Gerente';
    // Nível 1 passa direto para a supervisora
    if (nivelAprovacao === 1) {
      initialStatus = 'Aguardando Supervisor';
    }

    const updatePayload = {
      status: initialStatus,
      nivel_aprovacao: String(nivelAprovacao),
      atualizado_em: new Date().toISOString(),
    };

    // Upload da resposta de correcao se aplicavel
    if (ehRespostaCorrecao && respostaCorrecaoFile) {
      try {
        const path = `respostas-correcao/${activePacote.id}/${Date.now()}_${respostaCorrecaoFile.name}`;
        const { error: upErr } = await supabase.storage.from('emissoes').upload(path, respostaCorrecaoFile);
        if (upErr) throw upErr;
        updatePayload.resposta_correcao_arquivo_url = path;
        updatePayload.resposta_correcao_arquivo_nome = respostaCorrecaoFile.name;
        updatePayload.resposta_correcao_comentario = respostaCorrecaoComentario.trim();
        updatePayload.resposta_correcao_em = new Date().toISOString();
      } catch (e) {
        setEnviandoResposta(false);
        return addToast('Erro ao subir arquivo da correção: ' + e.message, 'error');
      }
    }

    const { error } = await supabase
      .from('emissoes_pacotes')
      .update(updatePayload)
      .eq('id', activePacote.id);

    setEnviandoResposta(false);

    if (error) {
      addToast('Erro ao concluir pacote: ' + error.message, 'error');
    } else {
      addToast(ehRespostaCorrecao ? 'Correção enviada para nova aprovação!' : 'Emissão concluída e enviada para aprovação!', 'success');
      setShowConcluirModal(false);
      setActivePacote(null);
      setPacoteArquivos([]);
      setRespostaCorrecaoFile(null);
      setRespostaCorrecaoComentario('');
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
        pacote_id: activePacote?.id || null,
        pacote_status: activePacote?.status || null,
        pacote_nivel: activePacote?.nivel_aprovacao || null,
        comentario_correcao: activePacote?.comentario_correcao || null,
        correcao_arquivo_url: activePacote?.correcao_arquivo_url || null,
        correcao_arquivo_nome: activePacote?.correcao_arquivo_nome || null,
        resposta_correcao_comentario: activePacote?.resposta_correcao_comentario || null,
        resposta_correcao_arquivo_url: activePacote?.resposta_correcao_arquivo_url || null,
        resposta_correcao_arquivo_nome: activePacote?.resposta_correcao_arquivo_nome || null,
        resposta_correcao_em: activePacote?.resposta_correcao_em || null,
        observacao_aprovacao: activePacote?.observacao_aprovacao || null,
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

  // Busca (ignora acentos/caixa): casa por nome/código do condomínio OU nome do gerente
  const carteirasFiltradas = useMemo(() => {
    const norm = (s) => (s || '').toString().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const q = norm(buscaCarteira).trim();
    if (!q) return carteiras;
    const out = {};
    Object.entries(carteiras).forEach(([gerente, condos]) => {
      if (norm(gerente).includes(q)) { out[gerente] = condos; return; }
      const m = condos.filter(c => norm(c.name).includes(q));
      if (m.length) out[gerente] = m;
    });
    return out;
  }, [carteiras, buscaCarteira]);
  const totalEncontrados = useMemo(
    () => Object.values(carteirasFiltradas).reduce((s, arr) => s + arr.length, 0),
    [carteirasFiltradas]
  );

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
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                  {condominios.find(c => c.id === activePacote.condominio_id)?.name || 'Condomínio'}
                </h3>
                <p className="text-xs font-bold text-violet-400 uppercase tracking-widest flex items-center gap-3">
                  Emissão {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia} • <StatusBadge status={activePacote.status} />
                  
                  {/* Botão de Registro Rápido no Painel Ativo */}
                  {(activePacote.status || '').toLowerCase() === 'aprovado' && (
                    <button 
                      onClick={() => handleRegistrar(activePacote)} 
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-600 text-white transition-all shadow-lg shadow-emerald-500/20 font-black text-[9px] uppercase tracking-widest border border-slate-200"
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
              className="p-2 bg-slate-50 hover:bg-slate-100 rounded-xl text-slate-500 hover:text-slate-900 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Referência do gerente: planilha do mês + cobranças extras a incluir */}
          <div className="mb-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-violet-500" />
              <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-600">
                Referência do gerente · {String(activePacote.mes_referencia).padStart(2,'0')}/{activePacote.ano_referencia}
              </h4>
              {confLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400 ml-auto" />}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-slate-200">
              {/* Planilha de rateios do mês */}
              <div className="p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" /> Planilha de rateios
                </p>
                {(() => {
                  const mesObj = (confData?.planilha?.meses || []).find(m => m.mes === activePacote.mes_referencia);
                  const colunas = (confData?.planilha?.colunas || []).filter(c => c !== 'Condomínio');
                  const valores = mesObj?.valores || {};
                  if (!colunas.length) return <p className="text-xs text-slate-400 py-2">{confLoading ? 'Carregando…' : 'Sem planilha para este mês.'}</p>;
                  return (
                    <div className="space-y-1">
                      {colunas.map(col => (
                        <div key={col} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                          <span className="text-slate-600 truncate pr-2">{col}</span>
                          <span className="font-mono font-bold text-slate-800 shrink-0">R$ {Number(valores[col] || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between text-xs pt-2 mt-1">
                        <span className="font-black uppercase tracking-widest text-[10px] text-slate-500">Total do mês</span>
                        <span className="font-mono font-black text-emerald-600">R$ {Number(mesObj?.total || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* Cobranças extras do mês — selecionáveis */}
              <div className="p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Cobranças extras · marque as que entram
                </p>
                {(() => {
                  const cobrancas = confData?.cobrancas_extras || [];
                  if (!cobrancas.length) return <p className="text-xs text-slate-400 py-2">{confLoading ? 'Carregando…' : 'Nenhuma cobrança extra lançada neste mês.'}</p>;
                  const sel = cobrancasSel || new Set();
                  return (
                    <div className="space-y-1.5">
                      {cobrancas.map(c => {
                        const checked = sel.has(c.id);
                        return (
                          <label key={c.id} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg border cursor-pointer transition-colors ${checked ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleCobranca(c.id)} className="w-4 h-4 accent-violet-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className={`text-xs font-bold truncate ${checked ? 'text-slate-800' : 'text-slate-500'}`}>{c.descricao}</p>
                              {c.unidades && (
                                <p className="text-[10px] text-violet-600 font-bold truncate">🏠 unid.: {c.unidades}</p>
                              )}
                              {c.attachments?.length > 0 && (
                                <a href={c.attachments[0]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
                                  className="text-[10px] text-violet-500 hover:underline inline-flex items-center gap-1">
                                  <Paperclip className="w-2.5 h-2.5" /> anexo
                                </a>
                              )}
                            </div>
                            <span className="font-mono text-xs font-bold text-slate-700 shrink-0">R$ {Number(c.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                          </label>
                        );
                      })}
                      <div className="flex items-center justify-between text-xs pt-2">
                        <span className="font-black uppercase tracking-widest text-[10px] text-slate-500">{sel.size} de {cobrancas.length} selecionadas</span>
                        <span className="font-mono font-black text-emerald-600">
                          R$ {cobrancas.filter(c => sel.has(c.id)).reduce((s,c)=>s+Number(c.valor||0),0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Seguro Proteção do condomínio (cadastro) */}
          {(() => {
            const ativoCond = condominios.find(c => c.id === activePacote.condominio_id);
            const codigo = (ativoCond?.name || '').match(/\d{1,5}/)?.[0]?.padStart(4, '0');
            const seguros = (codigo && segurosMap[codigo]) || [];
            if (!seguros.length) return null;
            return (
              <div className="mb-6 rounded-2xl border border-violet-500/25 bg-violet-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <ShieldCheck className="w-4 h-4 text-violet-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-violet-700">Seguro Proteção</span>
                  <span className="text-[10px] text-slate-400">· incluir na emissão</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {seguros.map((s, i) => (
                    <span key={i} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs">
                      <span className="font-bold text-slate-800">{s.tipo}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-500">cód <span className="font-mono font-bold text-slate-700">{s.cod}</span></span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-black text-emerald-600">R$ {Number(s.valor).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}</span>
                      <span className="text-[10px] text-slate-400">/unid.</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Lista de Arquivos do Pacote */}
          <div className="space-y-3 mb-6">
            {pacoteArquivos.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-slate-200 rounded-2xl">
                <FileText className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <p className="text-slate-500 text-sm">Nenhum arquivo adicionado ainda.</p>
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
                <div key={arq.id} className="p-4 bg-white border border-slate-200 rounded-2xl hover:bg-slate-100 transition-colors group">
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
                      <p className="text-sm font-bold text-slate-900 truncate max-w-[250px]">{arq.arquivo_nome}</p>
                      <p className="text-[10px] text-slate-500 uppercase tracking-widest">{arq.formato} • {new Date(arq.criado_em).toLocaleString('pt-BR')}</p>
                      {arq.categoria === 'concessionaria' && editandoFaturaId !== arq.id && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
                          {arq.nome_condominio_fatura ? (
                            <span className="text-amber-300/90"><span className="text-amber-500/60">cliente:</span> {arq.nome_condominio_fatura}</span>
                          ) : null}
                          {arq.vencimento_fatura ? (
                            <span className="text-amber-300/90"><span className="text-amber-500/60">venc:</span> {new Date(arq.vencimento_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                          ) : null}
                          {arq.valor_fatura != null ? (
                            <span className="text-amber-300/90 font-bold"><span className="text-amber-500/60 font-normal">total:</span> R$ {Number(arq.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          ) : null}
                          {['rascunho', 'solicitar_correcao'].includes(activePacote.status) && (
                            <button
                              onClick={() => setEditandoFaturaId(arq.id)}
                              className="text-[10px] text-amber-400/70 hover:text-amber-300 underline decoration-dotted"
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
                      className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-500 hover:text-violet-400 hover:border-violet-500/30 transition-all"
                      title="Visualizar"
                    >
                      <FileText className="w-4 h-4" />
                    </button>
                    {['rascunho', 'solicitar_correcao'].includes(activePacote.status) && (
                      <button 
                        onClick={(e) => handleDeleteArquivo(e, arq.id, arq.arquivo_url)}
                        className={`p-2 rounded-lg border transition-all ${
                          confirmDeleteArqId === arq.id 
                            ? 'bg-rose-500 border-rose-500 text-white animate-pulse' 
                            : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-rose-400 hover:border-rose-500/30'
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
          {['rascunho', 'solicitar_correcao'].includes((activePacote.status || '').toLowerCase()) && (
            <div className="space-y-3">
              {/* 4 zonas de upload por categoria */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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

                {/* CONCESSIONÁRIA (laranja) — extração automática do PDF */}
                <div className="relative border-2 border-dashed border-amber-500/20 hover:border-amber-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-amber-500/5 group">
                  <input type="file" disabled={isUploading || extraindo}
                    className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
                    accept=".pdf,.jpg,.jpeg,.png"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) await handleUploadComExtracao(f, 'concessionaria');
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-amber-400 group-hover:text-amber-300">
                    <Package className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Concessionária</span>
                    <span className="text-[9px] text-amber-500/70 flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> SABESP / COMGAS / ENEL</span>
                  </div>
                </div>

                {/* RELATÓRIO DE LEITURA (azul) — extração automática do PDF */}
                <div className="relative border-2 border-dashed border-violet-500/20 hover:border-violet-500/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-violet-500/5 group">
                  <input type="file" disabled={isUploading || extraindo}
                    className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-wait"
                    accept=".pdf"
                    onChange={async e => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) await handleUploadComExtracao(f, 'relatorio_leitura');
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-violet-400 group-hover:text-violet-300">
                    <ClipboardCheck className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Relatório</span>
                    <span className="text-[9px] text-violet-500/70 flex items-center gap-1"><Sparkles className="w-2.5 h-2.5" /> Leitura individualizada</span>
                  </div>
                </div>

                {/* OUTROS (cinza) */}
                <div className="relative border-2 border-dashed border-slate-500/20 hover:border-slate-400/60 rounded-2xl p-4 text-center cursor-pointer transition-all bg-slate-500/5 group">
                  <input type="file" multiple disabled={isUploading}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.doc,.docx"
                    onChange={async e => {
                      const files = Array.from(e.target.files || []);
                      const subtipo = window.prompt('Descreva este anexo (ex: Ata da reunião):', '');
                      for (const f of files) { await handleUploadArquivo(f, { categoria: 'outros', subtipo: subtipo || null }); }
                      e.target.value = '';
                    }}
                  />
                  <div className="flex flex-col items-center gap-1 text-slate-400 group-hover:text-slate-700">
                    <FolderOpen className="w-5 h-5" />
                    <span className="text-[10px] font-black uppercase tracking-widest">+ Outros</span>
                    <span className="text-[9px] text-slate-500/70">Atas e outros docs</span>
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
                  {activePacote.status === 'solicitar_correcao' ? 'Reenviar Correção' : 'Concluir e Enviar'}
                </button>
              </div>
            </div>
          )}

          {activePacote.status === 'solicitar_correcao' && activePacote.comentario_correcao && (
            <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-300 mt-4 space-y-2">
              <div>
                <span className="font-black text-rose-400 text-xs uppercase tracking-widest block mb-1">Correção Solicitada:</span>
                {activePacote.comentario_correcao}
              </div>
              {activePacote.correcao_arquivo_url && (
                <button
                  onClick={async () => {
                    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(activePacote.correcao_arquivo_url, 300);
                    if (error) return addToast('Erro ao abrir anexo', 'error');
                    window.open(data.signedUrl, '_blank');
                  }}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[11px] font-bold">
                  📎 {activePacote.correcao_arquivo_nome || 'Ver anexo da correção'}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ═══ FORMULÁRIO CRIAR/ABRIR PACOTE ═══ */
        <div className="border border-slate-200 rounded-3xl bg-slate-50 p-6 shadow-xl">
          <h3 className="font-black text-slate-900 text-lg mb-6 flex items-center gap-2">
            <UploadCloud className="text-violet-400 w-5 h-5"/>
            Nova Emissão / Abrir Existente
          </h3>
          <form onSubmit={handleCriarOuAbrirPacote} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Condomínio</label>
              <select
                value={condoId} onChange={e => setCondoId(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 outline-none focus:border-violet-500" required
              >
                <option value="">Selecione...</option>
                {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1.5">Mês / Ano</label>
              <div className="flex gap-2">
                <input type="number" min="1" max="12" value={mes} onChange={e => setMes(parseInt(e.target.value))}
                  className="w-1/2 bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-900" />
                <input type="number" value={ano} onChange={e => setAno(parseInt(e.target.value))}
                  className="w-1/2 bg-white border border-slate-200 rounded-xl px-3 py-3 text-sm text-slate-900" />
              </div>
            </div>
            <div>
              <button type="submit"
                title={periodoPassado ? 'Mês encerrado — só permite abrir pacote já existente' : 'Criar ou abrir pacote'}
                className={`w-full py-3 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg transition-all flex items-center justify-center gap-2 ${
                  periodoPassado
                    ? 'bg-slate-50 border border-slate-200 text-slate-500'
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
          <h3 className="font-black text-slate-900 text-lg flex items-center gap-2">
            <Clock className="text-violet-400 w-5 h-5"/>
            Emissões por Carteira — {String(mes).padStart(2,'0')}/{ano}
          </h3>
          {periodoPassado && (
            <span className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Período encerrado · só leitura
            </span>
          )}
        </div>

        {/* Busca por condomínio (nome/código) ou carteira/gerente */}
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={buscaCarteira}
            onChange={e => setBuscaCarteira(e.target.value)}
            placeholder="Buscar condomínio (nome ou código) ou gerente…"
            className="w-full bg-white border border-slate-200 rounded-xl pl-11 pr-10 py-3 text-sm text-slate-800 outline-none focus:border-violet-500 placeholder-slate-400 shadow-sm"
          />
          {buscaCarteira && (
            <button type="button" onClick={() => setBuscaCarteira('')} title="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {buscaCarteira && (
          <p className="text-[11px] text-slate-500 -mt-2 px-1">
            {totalEncontrados} {totalEncontrados === 1 ? 'condomínio encontrado' : 'condomínios encontrados'} em {Object.keys(carteirasFiltradas).length} {Object.keys(carteirasFiltradas).length === 1 ? 'carteira' : 'carteiras'}
          </p>
        )}

        {Object.keys(carteirasFiltradas).length === 0 && (
          <div className="text-center py-10 text-slate-500 text-sm border border-dashed border-slate-200 rounded-2xl">
            Nenhum condomínio ou carteira encontrado para “{buscaCarteira}”.
          </div>
        )}

        {Object.entries(carteirasFiltradas).map(([gerente, condos]) => {
          const isExpanded = buscaCarteira ? true : (expandedCarteiras[gerente] !== false); // busca força expandir
          return (
            <div key={gerente} className="border border-slate-200 rounded-2xl bg-white overflow-hidden">
              <button
                onClick={() => toggleCarteira(gerente)}
                className="w-full flex items-center justify-between p-4 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-violet-400" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
                  <span className="text-sm font-black text-slate-900 uppercase tracking-widest">{gerente}</span>
                  <span className="text-[10px] font-bold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-full">{condos.length} condos</span>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-200">
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
                      <div key={condo.id} className={`flex items-center justify-between px-6 py-3 border-b border-slate-200 last:border-b-0 transition-colors ${
                        temAltPrevista ? 'bg-amber-500/[0.05] hover:bg-amber-500/[0.08]'
                          : !pacote && isPronto ? 'bg-emerald-500/[0.04] hover:bg-emerald-500/[0.07]'
                          : 'hover:bg-slate-100'
                      }`}>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-sm font-bold text-slate-700 truncate max-w-[280px]">{condo.name}</span>
                          {condo.due_day && <span className="text-[10px] text-slate-400 font-medium">venc. dia {condo.due_day}{condo.due_day_2 ? ` e ${condo.due_day_2}` : ''}</span>}
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
                              <span className="text-[10px] font-bold text-slate-500">{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}</span>
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
                                    className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-600 text-white transition-all shadow-lg shadow-emerald-500/20 font-black text-[9px] uppercase tracking-widest border border-slate-200"
                                  >
                                    <FileCheck className="w-3.5 h-3.5" />
                                    <span>Registrar</span>
                                  </button>
                                );
                              })()}
                              <button
                                onClick={() => abrirPacote(pacote)}
                                className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-black text-violet-400 uppercase tracking-widest transition-all"
                              >
                                Abrir
                              </button>
                            </>
                          ) : periodoPassado ? (
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest italic">— sem pacote —</span>
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
                                        {dataStr && <span className="text-[10px] font-bold text-slate-500">{dataStr}</span>}
                                        {prep?.notas && (
                                          <span className="relative group/notas">
                                            <button
                                              type="button"
                                              className="w-5 h-5 flex items-center justify-center rounded bg-violet-500/10 border border-violet-500/20 text-violet-400 hover:bg-violet-500/20 transition-all"
                                              aria-label="Ver observações"
                                            >
                                              <StickyNote className="w-3 h-3" />
                                            </button>
                                            <span className="absolute right-0 top-full mt-1 z-50 hidden group-hover/notas:block w-64 p-3 bg-white border border-violet-500/30 rounded-xl shadow-2xl shadow-violet-500/10 pointer-events-none">
                                              <span className="block text-[9px] font-black text-violet-400 uppercase tracking-widest mb-1">Observações</span>
                                              <span className="block text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">{prep.notas}</span>
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
                                    : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed opacity-60'
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
      {showConcluirModal && (() => {
        const ehRespostaCorrecao = (activePacote?.status || '').toLowerCase() === 'solicitar_correcao';
        return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg p-8 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className={`w-16 h-16 ${ehRespostaCorrecao ? 'bg-amber-500/10 border-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20'} border rounded-full flex items-center justify-center mx-auto mb-6`}>
              {ehRespostaCorrecao ? <Send className="w-8 h-8 text-amber-400" /> : <CheckCircle className="w-8 h-8 text-emerald-400" />}
            </div>
            <h3 className="text-xl font-black text-slate-900 text-center mb-2">
              {ehRespostaCorrecao ? 'Reenviar com correção' : 'Concluir Emissão'}
            </h3>
            <p className="text-sm text-slate-500 text-center mb-6">
              {pacoteArquivos.length} arquivo{pacoteArquivos.length !== 1 ? 's' : ''} neste pacote.
            </p>

            {/* Bloco de resposta de correcao */}
            {ehRespostaCorrecao && (
              <div className="mb-6 p-4 rounded-2xl bg-amber-500/5 border border-amber-500/30 space-y-3">
                {/* Lembrete do que foi pedido */}
                {activePacote?.comentario_correcao && (
                  <div className="text-[11px] text-amber-300/80 italic border-l-2 border-amber-500/40 pl-3">
                    <span className="font-black text-amber-400 uppercase tracking-widest block mb-0.5 not-italic">Foi pedido:</span>
                    {activePacote.comentario_correcao}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 block mb-1.5">Arquivo da correção <span className="text-rose-400">*</span></label>
                  {respostaCorrecaoFile ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                      <span className="text-xs text-amber-200 truncate flex items-center gap-2">
                        <FileText className="w-4 h-4 shrink-0" />
                        {respostaCorrecaoFile.name}
                        <span className="text-[10px] text-amber-400/60">({(respostaCorrecaoFile.size/1024).toFixed(0)} KB)</span>
                      </span>
                      <button onClick={() => setRespostaCorrecaoFile(null)} className="text-amber-300 hover:text-slate-900 text-xs font-bold">Remover</button>
                    </div>
                  ) : (
                    <input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                      onChange={(e) => setRespostaCorrecaoFile(e.target.files?.[0] || null)}
                      className="block w-full text-xs text-amber-200 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-amber-500/15 file:text-amber-300 hover:file:bg-amber-500/25" />
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-amber-400 block mb-1.5">O que foi corrigido <span className="text-rose-400">*</span></label>
                  <textarea
                    value={respostaCorrecaoComentario}
                    onChange={(e) => setRespostaCorrecaoComentario(e.target.value)}
                    rows={3}
                    placeholder="Ex: Corrigi o valor do fundo de obras conforme solicitado e ajustei o rateio do mês de junho."
                    className="w-full bg-slate-100 border border-amber-500/30 rounded-lg px-3 py-2 text-sm text-amber-100 placeholder-amber-500/40 outline-none focus:border-amber-500/60 resize-y" />
                </div>
              </div>
            )}

            {!ehRespostaCorrecao && (
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">Escolha o nível de aprovação</p>
            )}

            {!ehRespostaCorrecao && (
            <div className="space-y-3 mb-8">
              <button
                onClick={() => setNivelAprovacao(1)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 1
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 1 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 1 - Sem consumos</p>
                    <p className="text-xs text-slate-500">Passa direto para a Supervisora</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(2)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 2
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 2 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 2 - Alteração sem consumo</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(3)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 3
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 3 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 3 - Fração</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setNivelAprovacao(4)}
                className={`w-full p-4 rounded-2xl border-2 text-left transition-all ${
                  nivelAprovacao === 4
                    ? 'border-violet-600 bg-violet-600/10 '
                    : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 4 ? 'border-violet-500' : 'border-gray-600'}`}>
                    {nivelAprovacao === 4 && <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900">Nível 4 - Com empresas terceirizadas</p>
                    <p className="text-xs text-slate-500">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                  </div>
                </div>
              </button>
            </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowConcluirModal(false); setRespostaCorrecaoFile(null); setRespostaCorrecaoComentario(''); }}
                disabled={enviandoResposta}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarConclusao}
                disabled={enviandoResposta}
                className={`flex-[2] py-3 rounded-xl text-slate-900 font-black uppercase tracking-widest text-xs shadow-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${
                  ehRespostaCorrecao ? 'bg-amber-600 hover:bg-amber-500' : 'bg-emerald-600 hover:bg-emerald-500'
                }`}
              >
                {enviandoResposta ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {ehRespostaCorrecao ? 'Reenviar para aprovação' : 'Confirmar e Enviar'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

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

      {/* ═══ OVERLAY: LENDO PDF ═══ */}
      {extraindo && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white border border-violet-500/30 rounded-2xl px-8 py-6 shadow-2xl flex flex-col items-center gap-3">
            <Sparkles className="w-8 h-8 text-violet-400 animate-pulse" />
            <p className="text-sm font-black text-slate-900 uppercase tracking-widest">{ocrProg ? 'Decifrando a imagem (OCR)…' : 'Lendo PDF…'}</p>
            <p className="text-[11px] text-slate-500">{ocrProg ? `Página ${ocrProg.p} de ${ocrProg.n} · no seu navegador, sem créditos` : 'Extraindo dados automaticamente'}</p>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE REVISÃO DE EXTRAÇÃO ═══ */}
      {revisaoInfo && (
        <RevisaoExtracaoModal
          info={revisaoInfo}
          onCancel={() => setRevisaoInfo(null)}
          onConfirm={confirmarRevisao}
        />
      )}

      {/* ═══ MODAL DE DUPLICATA / SANCIONAMENTO ═══ */}
      {duplicataInfo && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white border border-rose-500/30 rounded-3xl w-full max-w-2xl p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertCircle className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Possível duplicata detectada</h3>
                <p className="text-[11px] text-rose-300/80">Esta emissão não pode prosseguir sem confirmação.</p>
              </div>
            </div>

            {/* Lista de alertas */}
            <div className="space-y-2 mb-4">
              {(duplicataInfo.alertas || []).map((a, i) => (
                <div key={i} className={`px-3 py-2 rounded-lg border ${a.nivel === 'bloqueio' ? 'bg-rose-500/5 border-rose-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
                  <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${a.nivel === 'bloqueio' ? 'text-rose-400' : 'text-amber-400'}`}>{a.nivel === 'bloqueio' ? '🚫 Bloqueio' : '⚠ Aviso'} · {a.tipo.replace(/_/g, ' ')}</p>
                  <p className="text-xs text-slate-800">{a.mensagem}</p>
                  {a.detalhes && (
                    <p className="text-[10px] text-slate-500 mt-1 font-mono">
                      {a.detalhes.condominios?.name && `${a.detalhes.condominios.name} · `}
                      {a.detalhes.mes_referencia && `${String(a.detalhes.mes_referencia).padStart(2, '0')}/${a.detalhes.ano_referencia}`}
                      {a.detalhes.concessionaria && ` · ${a.detalhes.concessionaria}`}
                      {a.detalhes.empresa_leitura && ` · ${a.detalhes.empresa_leitura} (${a.detalhes.tipo_servico})`}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {/* Side-by-side se houver mes anterior */}
            {duplicataInfo.anomalia?.previous && (
              <div className="bg-white border border-slate-700 rounded-xl p-3 mb-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Comparação com mês anterior</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-slate-500">Mês anterior:</p>
                    <pre className="text-slate-700 font-mono text-[10px] whitespace-pre-wrap mt-1">{JSON.stringify(duplicataInfo.anomalia.previous, null, 2)}</pre>
                  </div>
                  <div>
                    <p className="text-slate-500">Campos iguais: <span className="text-rose-300 font-bold">{(duplicataInfo.anomalia.campos_iguais || []).join(', ') || '—'}</span></p>
                    {duplicataInfo.anomalia.variacao_pct !== null && duplicataInfo.anomalia.variacao_pct !== undefined && (
                      <p className="text-slate-500 mt-1">Variação valor: <span className={`font-bold ${Math.abs(duplicataInfo.anomalia.variacao_pct) < 5 ? 'text-rose-300' : 'text-emerald-300'}`}>{duplicataInfo.anomalia.variacao_pct.toFixed(1)}%</span></p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Sancionamento — exige MOTIVO + ANEXO de aprovação da repetição */}
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                Motivo da repetição <span className="text-rose-400">*</span>
              </label>
              <textarea value={sancionandoMotivo} onChange={e => setSancionandoMotivo(e.target.value)} rows={3}
                placeholder="Ex: A concessionária reemitiu a mesma fatura por erro deles. Confirmei por telefone."
                className="w-full bg-slate-100 border border-slate-300 rounded-lg p-3 text-sm text-slate-800 outline-none focus:border-rose-500/60 placeholder-slate-400 resize-y" />
            </div>
            <div className="mb-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1.5">
                Anexo da aprovação da repetição <span className="text-rose-400">*</span>
              </label>
              <label className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-slate-300 bg-slate-50 cursor-pointer hover:border-rose-400 transition-colors">
                <Paperclip className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-600 truncate flex-1">
                  {sancionandoAnexo ? sancionandoAnexo.name : 'Selecionar documento que comprova a aprovação…'}
                </span>
                {sancionandoAnexo && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                  onChange={e => setSancionandoAnexo(e.target.files?.[0] || null)} />
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setDuplicataInfo(null); setSancionandoMotivo(''); setSancionandoAnexo(null); }} disabled={sancionando}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50">
                Cancelar upload
              </button>
              <button disabled={!sancionandoMotivo.trim() || !sancionandoAnexo || sancionando}
                onClick={async () => {
                  if (!sancionandoMotivo.trim() || !sancionandoAnexo) return;
                  setSancionando(true);
                  try {
                    const meta = duplicataInfo.pendingMeta;
                    // 1) Sobe o documento que comprova a aprovação da repetição
                    const anexo = await uploadAnexoAprovacao(sancionandoAnexo);
                    // 2) Sobe a fatura/relatório repetido
                    await handleUploadArquivo(duplicataInfo.pendingFile, { ...meta, skipDuplicataCheck: true });
                    // 3) Sanciona o registro em consumos (motivo + anexo)
                    const ehRelatorio = meta.categoria === 'relatorio_leitura';
                    await apiPost('/api/consumos/sancionar-repeticao', {
                      tipo: ehRelatorio ? 'relatorio' : 'fatura',
                      condominio_id: activePacote.condominio_id,
                      mes_referencia: mes,
                      ano_referencia: ano,
                      concessionaria: !ehRelatorio ? (meta.subtipo || '').toUpperCase() : null,
                      empresa: ehRelatorio ? (meta.subtipo || '').toUpperCase() : null,
                      tipo_servico: ehRelatorio ? (meta.extras?.relatorio_tipo_servico || 'agua') : null,
                      motivo: sancionandoMotivo.trim(),
                      anexo_url: anexo.url,
                      anexo_nome: anexo.nome,
                    });
                    addToast('Repetição sancionada com anexo de aprovação.', 'success');
                    setDuplicataInfo(null); setSancionandoMotivo(''); setSancionandoAnexo(null);
                  } catch (e) {
                    addToast('Erro: ' + e.message, 'error');
                  } finally {
                    setSancionando(false);
                  }
                }}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 flex items-center gap-2">
                {sancionando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Confirmar repetição e prosseguir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE PERTENCIMENTO — BLOQUEIO DURO (conta de outro condomínio) ═══ */}
      {pertencimentoInfo && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white border border-rose-500/40 rounded-3xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center shrink-0">
                <Ban className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">Conta de outro condomínio</h3>
                <p className="text-[11px] text-rose-500/90 font-bold">Não é permitido anexar — retire esta conta.</p>
              </div>
            </div>

            <div className="bg-rose-500/5 border border-rose-500/30 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm text-slate-800">{pertencimentoInfo.alerta?.mensagem}</p>
              {pertencimentoInfo.alerta?.detalhes && (
                <div className="mt-2 flex flex-col gap-0.5 text-[11px] text-slate-500">
                  {pertencimentoInfo.alerta.detalhes.cliente && (
                    <span><span className="text-slate-400">cliente na conta:</span> <strong className="text-slate-700">{pertencimentoInfo.alerta.detalhes.cliente}</strong></span>
                  )}
                  {pertencimentoInfo.alerta.detalhes.condominio_correto && (
                    <span><span className="text-slate-400">pertence a:</span> <strong className="text-rose-600">{pertencimentoInfo.alerta.detalhes.condominio_correto}</strong></span>
                  )}
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 mb-4">
              A emissão <strong>não pode prosseguir</strong> com uma fatura de outro condomínio.
              Selecione o arquivo correto deste condomínio e tente novamente.
            </p>

            <div className="flex justify-end">
              <button onClick={() => setPertencimentoInfo(null)}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-rose-600 text-white hover:bg-rose-500 flex items-center gap-2">
                <X className="w-4 h-4" /> Entendi, vou retirar a conta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL DE REGISTRO ═══ */}
      {showRegistroModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-8 shadow-2xl">
            <div className="w-16 h-16 bg-violet-500/10 border border-violet-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileCheck className="w-8 h-8 text-violet-400" />
            </div>
            <h3 className="text-xl font-black text-slate-900 text-center mb-2">Registrar Emissão</h3>
            <p className="text-sm text-slate-500 text-center mb-8">
              Confirme a data e hora oficial do registro.
            </p>

            <div className="mb-8">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Data e Hora do Registro</label>
              <input
                type="datetime-local"
                value={dataRegistro}
                onChange={(e) => setDataRegistro(e.target.value)}
                min={new Date(new Date().getTime() - (new Date().getTimezoneOffset() * 60000)).toISOString().slice(0, 16)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-900 outline-none focus:border-violet-500 transition-all"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => { setShowRegistroModal(false); setActivePacote(null); }}
                className="flex-1 py-3 rounded-xl text-xs font-bold uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmarRegistro}
                className="flex-[2] py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-black uppercase tracking-widest text-xs shadow-lg transition-all"
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
    <form onSubmit={handleSubmit} className="mt-3 pt-3 border-t border-amber-500/20 grid grid-cols-1 md:grid-cols-12 gap-2">
      <div className="md:col-span-5">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Cliente na conta</label>
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Ex: EDIFICIO ANDREA"
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="md:col-span-3">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Vencimento</label>
        <input
          type="date"
          value={venc}
          onChange={(e) => setVenc(e.target.value)}
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none"
        />
      </div>
      <div className="md:col-span-2">
        <label className="text-[9px] font-bold uppercase tracking-wider text-amber-400/70">Valor (R$)</label>
        <input
          inputMode="numeric"
          value={valorMask}
          onChange={(e) => setValorMask(maskValor(e.target.value))}
          placeholder="0,00"
          className="w-full mt-0.5 bg-slate-100 border border-amber-500/20 focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 outline-none text-right font-mono"
        />
      </div>
      <div className="md:col-span-2 flex items-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-slate-400 bg-slate-50 hover:bg-slate-100 rounded-lg border border-slate-200 disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 px-2 py-1.5 text-xs font-bold text-white bg-amber-500 hover:bg-amber-400 rounded-lg disabled:opacity-50"
        >
          {saving ? '...' : 'Salvar'}
        </button>
      </div>
    </form>
  );
}


// Gera nome de arquivo padronizado a partir dos dados extraídos/revisados.
// Fatura:    "0066 - LUCRECIA - SABESP - 25-05-2026 - R$ 11.108,90.pdf"
// Relatório: "0374 - ROSSINI - PROSPER - agua - R$ 13.900,49.pdf"
// `src` pode ser o dict da extração OU o objeto de extras (lê chaves de ambos).
function nomeArquivoPadrao(categoria, subtipo, src, originalName, condoName) {
  try {
    const ext = (String(originalName || '').split('.').pop() || 'pdf').toLowerCase();
    const m = String(condoName || '').match(/^\s*(\d+)\s*[-–]?\s*(.*)$/);
    const numero = m ? m[1].padStart(4, '0') : '';
    const nome = (m ? m[2] : (condoName || '')).trim().toUpperCase();
    const venc = src?.vencimento || src?.vencimento_fatura || null;
    const valor = src?.valor ?? src?.valor_total ?? src?.valor_fatura ?? src?.relatorio_valor_total ?? null;
    const servico = src?.tipo_servico || src?.relatorio_tipo_servico || null;

    const partes = [numero, nome, String(subtipo || '').toUpperCase()].filter(Boolean);
    if (categoria === 'relatorio_leitura' && servico) partes.push(servico);
    let base = partes.join(' - ');
    if (venc) base += ` - ${String(venc).split('-').reverse().join('-')}`; // YYYY-MM-DD -> DD-MM-YYYY
    if (valor != null) base += ` - R$ ${Number(valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    base = base.replace(/[\\/*?:"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return base ? `${base}.${ext}` : (originalName || 'arquivo.pdf');
  } catch {
    return originalName || 'arquivo.pdf';
  }
}

// Converte "1.234,56" (pt-BR) ou "1234.56" em número; null se vazio/ inválido.
function parseNumBR(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
function fmtNumBR(n) {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (isNaN(num)) return '';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Modal de revisão: aparece quando a extração tem baixa confiança ou não
// identificou a empresa. Vem pré-preenchido com o que foi extraído; o usuário
// confirma/corrige e o arquivo é anexado (re-checando duplicata).
function RevisaoExtracaoModal({ info, onCancel, onConfirm }) {
  const { extracao, categoria, file } = info;
  const ehFatura = categoria === 'concessionaria';
  const { texto_bruto, ...brutos } = extracao || {};

  // Estado dos campos
  const detectado = extracao?.subtipo || '';
  const empresasFatura = ['SABESP', 'COMGAS', 'ENEL'];
  const empresasRelatorio = ['Prosper'];
  const lista = ehFatura ? empresasFatura : empresasRelatorio;
  const detectadoNaLista = lista.includes(detectado);

  const [empresa, setEmpresa] = useState(detectadoNaLista ? detectado : (detectado ? 'Outra' : lista[0]));
  const [empresaOutra, setEmpresaOutra] = useState(detectadoNaLista ? '' : detectado);
  const [cliente, setCliente] = useState(extracao?.cliente || '');
  const [vencimento, setVencimento] = useState(extracao?.vencimento || '');
  const [leituraAtual, setLeituraAtual] = useState(extracao?.leitura_atual || '');
  const [proximaLeitura, setProximaLeitura] = useState(extracao?.proxima_leitura || '');
  const [tipoServico, setTipoServico] = useState(extracao?.tipo_servico || 'agua');
  const [dataLeitura, setDataLeitura] = useState(extracao?.data_leitura || '');
  const [unidades, setUnidades] = useState(extracao?.numero_unidades ?? '');
  const [valor, setValor] = useState(fmtNumBR(ehFatura ? extracao?.valor : extracao?.valor_total));
  const [consumo, setConsumo] = useState(fmtNumBR(extracao?.consumo_total));
  const [salvando, setSalvando] = useState(false);

  const empresaFinal = empresa === 'Outra' ? empresaOutra.trim() : empresa;
  const confPct = Math.round((extracao?.confianca || 0) * 100);

  async function handleConfirm() {
    if (!empresaFinal) return;
    setSalvando(true);
    const baseExtras = {
      extracao_status: 'sucesso',
      extracao_confianca: extracao?.confianca ?? null,
      extracao_dados_brutos: brutos,
      extracao_em: new Date().toISOString(),
    };
    let extras, subtipo;
    if (ehFatura) {
      subtipo = empresaFinal.toUpperCase();
      extras = {
        ...baseExtras,
        nome_condominio_fatura: cliente.trim() || null,
        vencimento_fatura: vencimento || null,
        valor_fatura: parseNumBR(valor),
        leitura_atual_fatura: leituraAtual || null,
        proxima_leitura_fatura: proximaLeitura || null,
        dados_extraidos_em: new Date().toISOString(),
      };
    } else {
      subtipo = empresaFinal;
      extras = {
        ...baseExtras,
        relatorio_empresa: empresaFinal,
        relatorio_tipo_servico: tipoServico,
        relatorio_data_leitura: dataLeitura || null,
        relatorio_unidades: unidades ? parseInt(String(unidades), 10) : null,
        relatorio_consumo_total: parseNumBR(consumo),
        relatorio_valor_total: parseNumBR(valor),
      };
    }
    await onConfirm(categoria, subtipo, extras, file);
  }

  const inputCls = 'w-full mt-1 bg-slate-100 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-500';

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white border border-violet-500/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900">Confira os dados extraídos</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                {file?.name} · confiança {confPct}%
              </p>
            </div>
          </div>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        {extracao?.erro && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {extracao.erro}
          </div>
        )}
        {(extracao?.barcode || extracao?.ocr) ? (
          <div className="mb-3 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/30 text-[11px] text-violet-700 flex items-start gap-2">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {extracao?.barcode ? <><b>Valor lido do código de barras</b> (exato). </> : <>Imagem lida por OCR. </>}
              <b>Confira o vencimento</b> e os demais campos com o PDF antes de anexar.
            </span>
          </div>
        ) : !extracao?.erro && (
          <p className="mb-3 text-[11px] text-slate-400">
            A leitura automática não teve confiança suficiente. Revise os campos abaixo antes de anexar.
          </p>
        )}

        <div className="space-y-3">
          {/* Empresa / Concessionária */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {ehFatura ? 'Concessionária' : 'Empresa de leitura'}
            </label>
            <select value={empresa} onChange={e => setEmpresa(e.target.value)} className={inputCls}>
              {lista.map(op => <option key={op} value={op}>{op}</option>)}
              <option value="Outra">Outra (digitar)</option>
            </select>
            {empresa === 'Outra' && (
              <input value={empresaOutra} onChange={e => setEmpresaOutra(e.target.value)}
                placeholder="Nome da empresa" className={inputCls} />
            )}
          </div>

          {ehFatura ? (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Cliente na conta</label>
                <input value={cliente} onChange={e => setCliente(e.target.value)} placeholder="EDIFICIO ..." className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vencimento</label>
                  <input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor R$</label>
                  <input value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                    className={`${inputCls} text-right font-mono`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Leitura atual</label>
                  <input type="date" value={leituraAtual} onChange={e => setLeituraAtual(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Próxima leitura</label>
                  <input type="date" value={proximaLeitura} onChange={e => setProximaLeitura(e.target.value)} className={inputCls} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Tipo de serviço</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <button type="button" onClick={() => setTipoServico('agua')}
                    className={`py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-all ${tipoServico === 'agua' ? 'bg-violet-500/20 border-violet-500/50 text-violet-300' : 'bg-slate-100 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    💧 Água
                  </button>
                  <button type="button" onClick={() => setTipoServico('gas')}
                    className={`py-2 rounded-lg text-xs font-black uppercase tracking-widest border transition-all ${tipoServico === 'gas' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-100 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                    🔥 Gás
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Data da leitura</label>
                <input type="date" value={dataLeitura} onChange={e => setDataLeitura(e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Unidades</label>
                  <input type="number" value={unidades} onChange={e => setUnidades(e.target.value)} placeholder="52"
                    className={`${inputCls} text-right font-mono`} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Consumo m³</label>
                  <input value={consumo} onChange={e => setConsumo(e.target.value)} placeholder="1.188,70"
                    className={`${inputCls} text-right font-mono`} />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor R$</label>
                  <input value={valor} onChange={e => setValor(e.target.value)} placeholder="0,00"
                    className={`${inputCls} text-right font-mono`} />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancel} disabled={salvando}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-700 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={handleConfirm} disabled={salvando || !empresaFinal}
            className={`px-5 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-50 flex items-center gap-2 ${ehFatura ? 'bg-amber-600 hover:bg-amber-500' : 'bg-violet-600 hover:bg-violet-500'}`}>
            {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Anexar
          </button>
        </div>
      </div>
    </div>
  );
}
