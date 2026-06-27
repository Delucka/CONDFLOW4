'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { apiFetcher } from '@/lib/api';
import { abrirArquivoSeguro, getArquivoUrlSeguro } from '@/lib/arquivo';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import { proximoStatusAprovacao } from '@/lib/aprovacaoFluxo';
import { safeStorageName } from '@/lib/storage';
import { FileText, Building2, Receipt, Loader2, X, Check, AlertCircle, ExternalLink, PenTool, ChevronLeft, ChevronRight, Package, FolderOpen, Droplet, AlertTriangle, ClipboardList } from 'lucide-react';

const MESES_LONG_VC = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];



function fmt(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VisualizadorConferencia({ arquivo, arquivos = [], currentUser, onClose, onAction }) {
  const { addToast } = useToast();
  const supabase = createClient();

  const [currentFile, setCurrentFile] = useState(arquivo);
  const [loadingFile, setLoadingFile] = useState(false);
  const [docList, setDocList] = useState(arquivos);   // lista de navegação (troca quando abrimos outro mês)
  
  // Se o arquivo tiver snapshot congelado (emissão registrada), não busca dados ao vivo
  const isSnapshot = !!arquivo?.planilha_snapshot;

  const { data, isLoading: loadingLive } = useSWR(
    !isSnapshot && currentFile?.condominio_id
      ? `/api/condominio/${currentFile.condominio_id}/conferencia?mes=${currentFile.mes}&ano=${currentFile.ano}&retificacao=${currentFile.eh_retificacao}`
      : null,
    apiFetcher,
    { refreshInterval: 30000, revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  const loading = isSnapshot ? false : loadingLive;

  const [modoCorrecao, setModoCorrecao] = useState(false);
  const [comentario, setComentario]   = useState('');
  const [executando, setExecutando]   = useState(false);
  const [correcaoFile, setCorrecaoFile] = useState(null);
  const [observacaoAprovacao, setObservacaoAprovacao] = useState('');
  const [leituraModal, setLeituraModal] = useState(null); // { arq } — leitura por unidade do relatório

  // Snapshot congela os valores; dados ao vivo são mutáveis
  const planilha = isSnapshot ? arquivo.planilha_snapshot : data?.planilha;
  const cobrancas = isSnapshot ? [] : (data?.cobrancas_extras || []);

  useEffect(() => {
    if (arquivo) setCurrentFile(arquivo);
    setDocList(arquivos);   // nova conferência -> volta a navegar a lista do pacote atual
  }, [arquivo, arquivos]);

  const podeAprovar = can(currentUser?.role, 'approve_document');
  const podeAssinar = can(currentUser?.role, 'sign_document');

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function handleAprovar() {
    const procId = currentFile?.processo_id || arquivo?.processo_id;
    if (!procId) { addToast('Processo não vinculado.', 'error'); return; }
    setExecutando(true);
    try {
      const res = await fetch(`/api/processo/${procId}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getToken()}` },
        body: JSON.stringify({ action: 'approve', comment: observacaoAprovacao.trim(), sign: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao aprovar');
      addToast('Aprovado e assinado!', 'success');
      onAction?.(); onClose?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setExecutando(false); }
  }

  async function handleCorrecao() {
    if (!comentario.trim()) { addToast('Descreva o motivo.', 'warning'); return; }
    const procId = currentFile?.processo_id || arquivo?.processo_id;
    if (!procId) { addToast('Processo não vinculado.', 'error'); return; }
    setExecutando(true);
    try {
      const res = await fetch(`/api/processo/${procId}/acao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getToken()}` },
        body: JSON.stringify({ action: 'reject', comment: comentario.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro');
      addToast('Correção solicitada. Documento retornado.', 'success');
      onAction?.(); onClose?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setExecutando(false); }
  }

  // ===== Acoes de PACOTE (emissao mensal) =====
  async function handleAprovarPacote() {
    const pacoteId = arquivo?.pacote_id;
    const pacoteStatus = arquivo?.pacote_status;
    const pacoteNivel = arquivo?.pacote_nivel;
    if (!pacoteId) { addToast('Pacote não vinculado.', 'error'); return; }
    setExecutando(true);
    try {
      // Só vira 'aprovado' quando TODOS os cargos do nível assinaram (via trilha)
      const nextStatus = await proximoStatusAprovacao(supabase, pacoteId, pacoteNivel, currentUser?.role);
      const agora = new Date().toISOString();
      const payload = { status: nextStatus, atualizado_em: agora };
      if (nextStatus === 'aprovado') {
        payload.aprovado_por_nome = currentUser?.full_name || currentUser?.email || null;
        payload.aprovado_por_role = currentUser?.role || null;
        payload.aprovado_em = agora;
      }
      if (observacaoAprovacao.trim()) {
        payload.observacao_aprovacao = observacaoAprovacao.trim();
      }
      const { error, data } = await supabase
        .from('emissoes_pacotes')
        .update(payload)
        .eq('id', pacoteId)
        .select('id');
      if (error || !data || data.length === 0) throw new Error(error?.message || 'Sem permissão para aprovar');
      await supabase.from('emissoes_pacotes_aprovacoes').insert({
        pacote_id: pacoteId, acao: 'aprovacao', role: currentUser?.role || null,
        usuario_nome: currentUser?.full_name || null, usuario_email: currentUser?.email || null,
      });
      addToast(nextStatus === 'aprovado' ? 'Pacote aprovado!' : `Enviado para: ${nextStatus}`, 'success');
      onAction?.(); onClose?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setExecutando(false); }
  }

  async function handleCorrecaoPacote() {
    if (!comentario.trim()) { addToast('Descreva o motivo.', 'warning'); return; }
    const pacoteId = arquivo?.pacote_id;
    if (!pacoteId) { addToast('Pacote não vinculado.', 'error'); return; }
    setExecutando(true);
    try {
      // Sobe anexo (se houver)
      let correcaoUrl = null;
      let correcaoNome = null;
      if (correcaoFile) {
        const path = `correcoes/${pacoteId}/${Date.now()}_${safeStorageName(correcaoFile.name)}`;
        const { error: upErr } = await supabase.storage.from('emissoes').upload(path, correcaoFile);
        if (upErr) throw upErr;
        correcaoUrl = path;
        correcaoNome = correcaoFile.name;
      }
      const { error } = await supabase
        .from('emissoes_pacotes')
        .update({
          status: 'solicitar_correcao',
          comentario_correcao: comentario.trim(),
          correcao_arquivo_url: correcaoUrl,
          correcao_arquivo_nome: correcaoNome,
          atualizado_em: new Date().toISOString(),
          correcao_por_nome: currentUser?.full_name || currentUser?.email || null,
          correcao_em: new Date().toISOString(),
        })
        .eq('id', pacoteId);
      if (error) throw error;
      // Marca o ciclo: aprovações anteriores deixam de valer (re-conferência do zero)
      await supabase.from('emissoes_pacotes_aprovacoes').insert({
        pacote_id: pacoteId, acao: 'correcao', role: currentUser?.role || null,
        usuario_nome: currentUser?.full_name || null, usuario_email: currentUser?.email || null,
      });
      addToast('Correção solicitada. As aprovações anteriores foram retiradas.', 'success');
      onAction?.(); onClose?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setExecutando(false); }
  }

  // Navegação entre arquivos
  const currentIndex = docList.findIndex(a => String(a.id) === String(currentFile?.id));
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < docList.length - 1;

  async function openArquivo(a) {
    setLoadingFile(true);
    try {
      const path = a.arquivo_url || a.path;
      let url = a.url;
      if (!url && path) {
        url = await getArquivoUrlSeguro(path);
        if (!url) throw new Error('Sem acesso ao arquivo.');
      }
      setCurrentFile({
        id: a.id,
        nome: a.arquivo_nome || a.nome,
        url,
        condominio_id: a.condominio_id,
        mes: a.mes_referencia ?? a.mes,
        ano: a.ano_referencia ?? a.ano,
        eh_retificacao: a.eh_retificacao || false,
      });
    } catch (e) {
      addToast('Erro ao carregar arquivo', 'error');
    } finally {
      setLoadingFile(false);
    }
  }

  // Abre o anexo da cobrança extra ao clicar em qualquer lugar da linha
  function abrirCobranca(c) {
    if (!c?.attachments?.length) { addToast('Esta cobrança não tem anexo.', 'info'); return; }
    setCurrentFile({ ...currentFile, id: `att_${c.id}`, nome: `Anexo: ${c.descricao}`, url: c.attachments[0] });
  }

  // Volta pra emissão que está sendo conferida (restaura a lista do pacote atual)
  function voltarEmissaoAtual() {
    setDocList(arquivos);
    if (arquivo) openArquivo(arquivo);
  }

  // Abre a emissão de um mês (clicar na linha do mês na planilha) — pra conferir meses anteriores.
  // Troca a LISTA de navegação pra os documentos daquele mês (assim as setas transitam dentro dele).
  async function abrirMesEmissao(m) {
    if (isSnapshot) return;
    const condoId = currentFile?.condominio_id || arquivo?.condominio_id;
    const ano = currentFile?.ano || arquivo?.ano;
    if (!condoId || !ano) return;
    // mês do pacote atual -> restaura a lista original
    if (String(m.mes) === String(arquivo?.mes) && String(ano) === String(arquivo?.ano)) {
      voltarEmissaoAtual();
      return;
    }
    setLoadingFile(true);
    try {
      const { data: arqs, error } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId).eq('mes_referencia', m.mes).eq('ano_referencia', ano);
      if (error) throw error;
      const lista = arqs || [];
      if (!lista.length) { addToast(`Sem emissão registrada em ${m.mes_nome}.`, 'info'); return; }
      setDocList(lista);   // agora as setas/seletor navegam os documentos DESTE mês
      const principal = lista.find(a => a.categoria !== 'concessionaria' && a.categoria !== 'relatorio_leitura') || lista[0];
      await openArquivo(principal);
    } catch (e) {
      addToast('Erro ao abrir a emissão do mês.', 'error');
    } finally {
      setLoadingFile(false);
    }
  }

  // Setas ←/→ do teclado transitam entre os documentos da lista
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || loadingFile) return;
      if (e.key === 'ArrowRight' && hasNext) { e.preventDefault(); handleNavigate(1); }
      else if (e.key === 'ArrowLeft' && hasPrev) { e.preventDefault(); handleNavigate(-1); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasNext, hasPrev, currentIndex, docList, loadingFile]);

  async function handleNavigate(direction) {
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= docList.length) return;

    setLoadingFile(true);
    const nextDoc = docList[nextIndex];
    
    try {
      const nurl = await getArquivoUrlSeguro(nextDoc.arquivo_url);
      if (!nurl) throw new Error('Sem acesso ao arquivo.');

      setCurrentFile({
        ...currentFile,
        id: nextDoc.id,
        nome: nextDoc.arquivo_nome,
        url: nurl
      });
    } catch (e) {
      addToast('Erro ao carregar próximo arquivo', 'error');
    } finally {
      setLoadingFile(false);
    }
  }

  // Snapshot: exibe somente o mês emitido (congelado). Ao vivo: exibe todos.
  const mesesParaExibir = planilha?.meses || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex flex-col">

      {/* Header */}
      <div className="px-4 h-[52px] border-b border-slate-800 bg-white flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FileText className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm text-slate-900 font-bold truncate leading-tight">{currentFile?.nome || 'Documento'}</h3>
            <p className="text-[9px] uppercase tracking-widest text-slate-500">Conferência{currentFile?.mes ? ` · ${MESES_LONG_VC[currentFile.mes]}/${currentFile.ano || ''}` : ''}{docList.length > 1 ? ` · doc ${currentIndex + 1} de ${docList.length}` : ''}</p>
          </div>
        </div>

        {/* Voltar à emissão conferida (quando espiando outro mês na planilha) */}
        {!isSnapshot && arquivo?.mes != null && currentFile?.mes != null &&
          (String(currentFile.mes) !== String(arquivo.mes) || String(currentFile.ano) !== String(arquivo.ano)) && (
          <button onClick={voltarEmissaoAtual} disabled={loadingFile}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-100 text-violet-700 border border-violet-200 hover:bg-violet-200 text-[10px] font-bold uppercase tracking-wider disabled:opacity-50 transition-colors"
            title="Voltar à emissão que você está conferindo">
            <ChevronLeft className="w-3.5 h-3.5" /> Emissão de {MESES_LONG_VC[arquivo.mes]}
          </button>
        )}

        {/* Navegação entre documentos */}
        {docList.length > 1 && (
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 border border-slate-200 shrink-0">
            <button
              onClick={() => handleNavigate(-1)}
              disabled={!hasPrev || loadingFile}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-white disabled:opacity-20 transition-colors"
              title="Anterior (seta ←)"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={currentFile?.id || ''}
              onChange={(e) => {
                const idx = docList.findIndex(a => String(a.id) === e.target.value);
                if (idx >= 0) handleNavigate(idx - currentIndex);
              }}
              className="bg-transparent text-[10px] font-bold text-slate-900 outline-none px-1.5 py-1 max-w-[160px] truncate cursor-pointer"
            >
              {docList.map((a, i) => (
                <option key={a.id} value={a.id} className="bg-white">
                  {i + 1}/{docList.length} · {a.arquivo_nome || a.nome}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleNavigate(1)}
              disabled={!hasNext || loadingFile}
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-white disabled:opacity-20 transition-colors"
              title="Próximo (seta →)"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {arquivo.url && (
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors" title="Abrir em nova aba">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Banner de correção solicitada (se houver) */}
      {arquivo?.pacote_id && (arquivo?.comentario_correcao || arquivo?.correcao_arquivo_url) && (
        <div className="shrink-0 px-4 py-3 bg-rose-500/10 border-b border-rose-500/30 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-rose-400 mb-0.5">Correção solicitada</p>
            {arquivo.comentario_correcao && (
              <p className="text-xs text-rose-200/90 leading-snug whitespace-pre-wrap">{arquivo.comentario_correcao}</p>
            )}
          </div>
          {arquivo.correcao_arquivo_url && (
            <button
              onClick={async () => {
                const ok = await abrirArquivoSeguro(arquivo.correcao_arquivo_url);
                if (!ok) addToast('Erro ao abrir anexo', 'error');
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[10px] font-bold uppercase tracking-widest">
              <FileText className="w-3 h-3" />
              {arquivo.correcao_arquivo_nome || 'Anexo'}
            </button>
          )}
        </div>
      )}

      {/* Banner de RESPOSTA de correção (gerente reenviou) */}
      {arquivo?.pacote_id && (arquivo?.resposta_correcao_comentario || arquivo?.resposta_correcao_arquivo_url) && (
        <div className="shrink-0 px-4 py-3 bg-emerald-500/10 border-b border-emerald-500/30 flex items-start gap-3">
          <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400 mb-0.5">
              Correção feita pelo gerente
              {arquivo.resposta_correcao_em && (
                <span className="ml-2 text-emerald-500/60 font-normal normal-case tracking-normal">
                  · {new Date(arquivo.resposta_correcao_em).toLocaleDateString('pt-BR')} {new Date(arquivo.resposta_correcao_em).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}
                </span>
              )}
            </p>
            {arquivo.resposta_correcao_comentario && (
              <p className="text-xs text-emerald-200/90 leading-snug whitespace-pre-wrap">{arquivo.resposta_correcao_comentario}</p>
            )}
          </div>
          {arquivo.resposta_correcao_arquivo_url && (
            <button
              onClick={async () => {
                const ok = await abrirArquivoSeguro(arquivo.resposta_correcao_arquivo_url);
                if (!ok) addToast('Erro ao abrir anexo', 'error');
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[10px] font-bold uppercase tracking-widest">
              <FileText className="w-3 h-3" />
              {arquivo.resposta_correcao_arquivo_nome || 'Anexo da correção'}
            </button>
          )}
        </div>
      )}

      {/* Banner de Observação de Aprovação */}
      {arquivo?.observacao_aprovacao && (
        <div className="shrink-0 px-4 py-3 bg-violet-500/10 border-b border-violet-500/30 flex items-start gap-3">
          <Check className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-violet-400 mb-0.5">
              Observação na Aprovação
            </p>
            <p className="text-xs text-violet-200/90 leading-snug whitespace-pre-wrap">{arquivo.observacao_aprovacao}</p>
          </div>
        </div>
      )}

      {/* Split view */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-3 p-3 overflow-auto lg:overflow-hidden">

        {/* PDF */}
        <div className="bg-white border border-slate-800 rounded-xl overflow-hidden flex flex-col relative min-h-[60vh] lg:min-h-0">
          {loadingFile && (
            <div className="absolute inset-0 z-10 bg-white backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-violet-500 animate-spin" />
            </div>
          )}
          {currentFile?.url
            ? <iframe src={currentFile.url} title={currentFile.nome} className="w-full h-full bg-white" />
            : <div className="flex-1 flex items-center justify-center text-slate-500 text-center">
                <div><FileText className="w-12 h-12 mx-auto mb-2 opacity-30" /><p className="text-sm">Sem URL disponível</p></div>
              </div>
          }
        </div>

        {/* Painel lateral - usa flex height, nao calc() */}
        <div className="flex flex-col gap-3 pr-2 conf-scroll min-h-0 lg:h-full lg:overflow-y-auto overflow-x-hidden">

          {/* Planilha Anual */}
          <div className="bg-white border border-slate-800 rounded-xl overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className={`w-4 h-4 ${isSnapshot ? 'text-amber-400' : 'text-violet-400'}`} />
                <div>
                  <h4 className="text-sm font-bold text-slate-800">
                    Planilha {isSnapshot ? `· Mês ${String(arquivo.mes).padStart(2,'0')}/${arquivo.ano}` : (planilha?.ano ? `Anual · ${planilha.ano}` : 'Anual')}
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    {isSnapshot ? 'Valores congelados no momento da emissão' : 'Espelho em tempo real'}
                  </p>
                </div>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${isSnapshot ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-violet-500/10 text-violet-400 border-violet-500/20'}`}>
                {isSnapshot ? '🔒 Congelado' : 'Só leitura'}
              </span>
            </div>

            {loading
              ? <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-violet-500" /></div>
              : mesesParaExibir.length === 0
                ? <div className="p-6 text-center text-slate-500 text-sm">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Nenhuma planilha cadastrada para este condomínio.
                  </div>
                : <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50">
                        <th className="text-left px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Mês</th>
                        {(planilha?.colunas || []).map(col => (
                          <th key={col} className="text-right px-3 py-2 text-[10px] font-bold uppercase text-slate-500 whitespace-nowrap" title={col}>
                            {col}
                          </th>
                        ))}
                        <th className="text-right px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mesesParaExibir.map(m => (
                        <tr key={m.mes} onClick={() => !isSnapshot && abrirMesEmissao(m)}
                          className={`border-t border-slate-800 transition-colors ${!isSnapshot ? 'cursor-pointer hover:bg-violet-50' : ''}`}
                          title={!isSnapshot ? `Abrir a emissão de ${m.mes_nome}` : undefined}>
                          <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{m.mes_nome}</td>
                          {(planilha?.colunas || []).map(col => (
                            <td key={col} className="text-right px-3 py-2 text-xs text-slate-700 font-mono whitespace-nowrap">
                              {fmt(m.valores?.[col])}
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 text-xs text-slate-800 font-mono font-bold">{fmt(m.total)}</td>
                        </tr>
                      ))}
                      {planilha?.totais && planilha.totais.total > 0 && (
                        <tr className="border-t border-emerald-500/30 bg-emerald-500/10">
                          <td className="px-3 py-2 text-xs font-bold text-emerald-400">Total</td>
                          {(planilha?.colunas || []).map(col => (
                            <td key={`tot-${col}`} className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">
                              {fmt(planilha.totais?.[col])}
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{fmt(planilha.totais.total)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
            }
          </div>

          {/* Cobranças Extras — sempre visível */}
          <div className="bg-white border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-72 shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-800">Cobranças Extras</h4>
                  <p className="text-[10px] text-slate-500">Lançadas pelo gerente/assistente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                {cobrancas.length} {cobrancas.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            {loading
              ? <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-violet-500" /></div>
              : cobrancas.length === 0
                ? <div className="p-6 text-center">
                    <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                    <p className="text-sm text-slate-500">Nenhuma cobrança extra lançada</p>
                    <p className="text-xs text-slate-600 mt-1">Quando houver, aparecerão aqui.</p>
                  </div>
                : <div className="overflow-y-auto flex-1">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50 backdrop-blur z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Descrição</th>
                          <th className="text-right px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cobrancas.map(c => (
                          <tr key={c.id} onClick={() => abrirCobranca(c)}
                            className={`border-t border-slate-800 transition-colors ${c.attachments?.length ? 'cursor-pointer hover:bg-violet-50' : 'hover:bg-slate-50'}`}
                            title={c.attachments?.length ? 'Clique para abrir o anexo' : 'Sem anexo'}>
                            <td className="px-3 py-2 text-xs text-slate-700">
                              <div className="flex items-center gap-2">
                                {c.descricao}
                                {c.attachments?.length > 0 && <FileText className="w-3 h-3 text-violet-400 shrink-0" />}
                              </div>
                            </td>
                            <td className="text-right px-3 py-2 text-xs text-slate-800 font-mono font-bold">{fmt(c.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            }
          </div>

          {/* Concessionárias — só se houver anexos dessa categoria */}
          {(() => {
            const concessionarias = docList.filter(a => a.categoria === 'concessionaria');
            if (concessionarias.length === 0) return null;
            return (
              <div className="bg-white border border-amber-500/30 rounded-xl overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-amber-500/20 bg-amber-500/5 flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  <h4 className="text-sm font-bold text-amber-300">Concessionárias</h4>
                  <span className="ml-auto text-[10px] text-amber-400/70 font-bold">{concessionarias.length} arquivo{concessionarias.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {concessionarias.map(a => {
                    const eAtual = currentFile?.id === a.id;
                    return (
                      <button key={a.id} onClick={() => openArquivo(a)}
                        className={`w-full px-4 py-2.5 flex items-start gap-3 hover:bg-amber-500/5 transition-colors text-left ${eAtual ? 'bg-amber-500/10' : ''}`}>
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0 mt-0.5">
                          {a.subtipo || 'Outra'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-700 truncate flex-1">{a.arquivo_nome}</span>
                            {eAtual && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                          </div>
                          {(a.nome_condominio_fatura || a.vencimento_fatura || a.valor_fatura) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                              {a.nome_condominio_fatura && (
                                <span className="text-amber-300/90"><span className="text-amber-500/50">cliente:</span> {a.nome_condominio_fatura}</span>
                              )}
                              {a.vencimento_fatura && (
                                <span className="text-amber-300/90"><span className="text-amber-500/50">venc:</span> {new Date(a.vencimento_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                              )}
                              {a.valor_fatura != null && (
                                <span className="text-amber-300 font-bold"><span className="text-amber-500/50 font-normal">total:</span> R$ {Number(a.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Relatórios de Leitura — card espelho do de Concessionárias */}
          {(() => {
            const relatorios = docList.filter(a => a.categoria === 'relatorio_leitura');
            if (relatorios.length === 0) return null;
            return (
              <div className="bg-white border border-violet-500/30 rounded-xl overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-violet-500/20 bg-violet-500/5 flex items-center gap-2">
                  <ClipboardList className="w-4 h-4 text-violet-500" />
                  <h4 className="text-sm font-bold text-violet-600">Relatórios de Leitura</h4>
                  <span className="ml-auto text-[10px] text-violet-500/70 font-bold">{relatorios.length} arquivo{relatorios.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-200">
                  {relatorios.map(a => {
                    const eAtual = currentFile?.id === a.id;
                    const serv = (a.relatorio_tipo_servico || 'agua').toLowerCase();
                    const temUnidades = (a.extracao_dados_brutos?.unidades || []).length > 0;
                    return (
                      <div key={a.id} className={`px-4 py-2.5 ${eAtual ? 'bg-violet-500/10' : ''}`}>
                        <div className="flex items-start gap-3">
                          <button onClick={() => openArquivo(a)} className="flex items-start gap-3 text-left flex-1 min-w-0 hover:opacity-80">
                            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-600 border border-violet-500/30 shrink-0 mt-0.5">
                              {a.relatorio_empresa || a.subtipo || 'Relatório'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-700 truncate flex-1">{a.arquivo_nome}</span>
                                {eAtual && <Check className="w-3.5 h-3.5 text-violet-500 shrink-0" />}
                              </div>
                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                                <span className="text-violet-600/90"><span className="text-violet-500/50">serviço:</span> {serv === 'gas' ? 'Gás' : 'Água'}</span>
                                {a.relatorio_data_leitura && (
                                  <span className="text-violet-600/90"><span className="text-violet-500/50">leitura:</span> {new Date(a.relatorio_data_leitura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                                )}
                                {a.relatorio_unidades != null && (
                                  <span className="text-violet-600/90"><span className="text-violet-500/50">unidades:</span> {a.relatorio_unidades}</span>
                                )}
                                {a.relatorio_consumo_total != null && (
                                  <span className="text-violet-600/90"><span className="text-violet-500/50">consumo:</span> {Number(a.relatorio_consumo_total).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³</span>
                                )}
                                {a.relatorio_valor_total != null && (
                                  <span className="text-violet-600 font-bold"><span className="text-violet-500/50 font-normal">valor:</span> R$ {fmt(a.relatorio_valor_total)}</span>
                                )}
                              </div>
                            </div>
                          </button>
                        </div>
                        {temUnidades && (
                          <button onClick={() => setLeituraModal({ arq: a })}
                            className="mt-2 ml-[68px] text-[10px] font-bold text-violet-600 hover:text-violet-500 flex items-center gap-1">
                            <Droplet className="w-3 h-3" /> ver leitura por unidade
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Outros anexos (atas, etc) */}
          {(() => {
            const outros = docList.filter(a => a.categoria === 'outros');
            if (outros.length === 0) return null;
            return (
              <div className="bg-white border border-slate-700 rounded-xl overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-50 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-bold text-slate-800">Outros Anexos</h4>
                  <span className="ml-auto text-[10px] text-slate-500 font-bold">{outros.length} arquivo{outros.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {outros.map(a => {
                    const eAtual = currentFile?.id === a.id;
                    return (
                      <button key={a.id} onClick={() => openArquivo(a)}
                        className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-100/50 transition-colors text-left ${eAtual ? 'bg-slate-100/70' : ''}`}>
                        {a.subtipo && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-700 border border-slate-500/30 shrink-0 truncate max-w-[100px]" title={a.subtipo}>
                            {a.subtipo}
                          </span>
                        )}
                        <span className="text-xs text-slate-700 truncate flex-1">{a.arquivo_nome}</span>
                        {eAtual && <Check className="w-3.5 h-3.5 text-slate-700 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </div>

      {/* Footer ações */}
      {(() => {
        const modoPacote = !!arquivo?.pacote_id;
        const podeAcao = podeAprovar && (arquivo?.processo_id || arquivo?.pacote_id);
        // Status terminais do pacote ocultam os botoes
        const statusTerminal = ['aprovado','registrado','expedida','rascunho','solicitar_correcao'].includes((arquivo?.pacote_status || '').toLowerCase());
        if (!podeAcao) return null;
        if (modoPacote && statusTerminal) return null;

        const aprovarFn = modoPacote ? handleAprovarPacote : handleAprovar;
        const correcaoFn = modoPacote ? handleCorrecaoPacote : handleCorrecao;
        const labelAprovar = modoPacote
          ? (arquivo?.pacote_status === 'Aguardando Supervisor' || Number(arquivo?.pacote_nivel) === 1 ? 'Aprovar pacote' : 'Aprovar e enviar')
          : 'Aprovar e assinar';

        return (
          <div className="shrink-0 px-4 py-3 border-t border-slate-800 bg-white">
            {!modoCorrecao
              ? <div className="space-y-2">
                  {/* Observacao opcional */}
                  <input
                    value={observacaoAprovacao}
                    onChange={(e) => setObservacaoAprovacao(e.target.value)}
                    placeholder="Observação ao aprovar (opcional)"
                    className="w-full bg-slate-100/60 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-emerald-500/40 placeholder-slate-500"
                  />
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      {modoPacote
                        ? <><span className="text-[9px] uppercase tracking-widest text-slate-500">Status</span> <span className="text-violet-400 font-bold">{arquivo?.pacote_status || '—'}</span></>
                        : (podeAssinar && <><PenTool className="w-3 h-3" /> Ao aprovar, você assina digitalmente.</>)
                      }
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setModoCorrecao(true)} disabled={executando}
                        className="px-3.5 py-2 rounded-lg text-xs font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                        Solicitar correção
                      </button>
                      <button onClick={aprovarFn} disabled={executando}
                        className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                        {executando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                        {labelAprovar}
                      </button>
                    </div>
                  </div>
                </div>
              : <div className="space-y-3">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Motivo da correção <span className="text-rose-400">*</span>
                  </label>
                  <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={5}
                    placeholder="Descreva o que precisa ser corrigido... (sem limite de caracteres)"
                    className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-400 resize-y" />

                  {/* Anexo opcional - so para fluxo de pacote */}
                  {modoPacote && (
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                        Anexar arquivo (opcional)
                      </label>
                      {correcaoFile ? (
                        <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30">
                          <span className="text-xs text-rose-300 truncate flex items-center gap-2">
                            <FileText className="w-4 h-4 shrink-0" />
                            {correcaoFile.name}
                            <span className="text-[10px] text-rose-400/60">({(correcaoFile.size/1024).toFixed(0)} KB)</span>
                          </span>
                          <button onClick={() => setCorrecaoFile(null)} className="text-rose-400 hover:text-slate-900 text-xs font-bold">Remover</button>
                        </div>
                      ) : (
                        <input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                          onChange={(e) => setCorrecaoFile(e.target.files?.[0] || null)}
                          className="block w-full text-xs text-slate-700 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-rose-500/10 file:text-rose-300 hover:file:bg-rose-500/20" />
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setModoCorrecao(false); setComentario(''); setCorrecaoFile(null); }} disabled={executando}
                      className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-100 text-slate-700 hover:bg-slate-700 transition-colors">
                      Cancelar
                    </button>
                    <button onClick={correcaoFn} disabled={executando || !comentario.trim()}
                      className="px-5 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors flex items-center gap-2 disabled:opacity-50">
                      {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                      Enviar correção
                    </button>
                  </div>
                </div>
            }
          </div>
        );
      })()}

      {/* Modal: leitura por unidade do relatório */}
      {leituraModal && (() => {
        const arq = leituraModal.arq;
        const lista = arq?.extracao_dados_brutos?.unidades || [];
        const serv = (arq?.relatorio_tipo_servico || 'agua').toLowerCase();
        const consumos = lista.map(u => Number(u.m3_total) || 0).filter(v => v > 0).sort((a, b) => a - b);
        const mediana = consumos.length ? consumos[Math.floor(consumos.length / 2)] : 0;
        const limiar = mediana * 2;
        const somaM3 = lista.reduce((s, u) => s + (Number(u.m3_total) || 0), 0);
        const somaValor = lista.reduce((s, u) => s + (Number(u.valor_total) || 0), 0);
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-md p-4" onClick={() => setLeituraModal(null)}>
            <div className="bg-white border border-violet-500/20 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center">
                    {serv === 'gas' ? <span className="text-lg">🔥</span> : <Droplet className="w-5 h-5 text-violet-500" />}
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{arq.relatorio_empresa || 'Relatório'}</h3>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                      {serv === 'gas' ? 'Gás' : 'Água'}{arq.mes_referencia ? ` · ${MESES_LONG_VC[arq.mes_referencia]}` : ''} · leitura por unidade
                    </p>
                  </div>
                </div>
                <button onClick={() => setLeituraModal(null)} className="text-slate-400 hover:text-slate-900"><X className="w-5 h-5" /></button>
              </div>

              {lista.length > 0 && (
                <div className="px-6 py-3 border-b border-slate-200 grid grid-cols-3 gap-3 text-center shrink-0">
                  <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Unidades</p><p className="text-lg font-black text-slate-900">{lista.length}</p></div>
                  <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Consumo total</p><p className="text-lg font-black text-violet-600">{somaM3.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³</p></div>
                  <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Valor total</p><p className="text-lg font-black text-emerald-600">R$ {fmt(somaValor)}</p></div>
                </div>
              )}

              <div className="overflow-auto p-4">
                {lista.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-12">Nenhuma unidade encontrada na leitura.</p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead className="sticky top-0 bg-white">
                      <tr className="text-[9px] font-black uppercase tracking-widest text-slate-500">
                        <th className="text-left px-2 py-2">Apto</th>
                        <th className="text-left px-2 py-2">Leituras (ant → atual)</th>
                        <th className="text-right px-2 py-2">Consumo m³</th>
                        <th className="text-right px-2 py-2">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((u, i) => {
                        const m3 = Number(u.m3_total) || 0;
                        const anomala = limiar > 0 && m3 > limiar;
                        return (
                          <tr key={`${u.apto}-${i}`} className={`border-t border-slate-200 ${anomala ? 'bg-amber-500/10' : 'hover:bg-slate-100'}`}>
                            <td className="px-2 py-1.5 font-bold text-slate-800">{u.apto}</td>
                            <td className="px-2 py-1.5 text-slate-400 font-mono text-[11px]">
                              {(u.medidores || []).map((m, j) => (
                                <span key={j} className="inline-block mr-3">
                                  {m.ant != null ? m.ant : '—'} → {m.atual != null ? m.atual : '—'}
                                  <span className="text-slate-500"> ({m.consumo != null ? m.consumo : '—'})</span>
                                </span>
                              ))}
                            </td>
                            <td className={`px-2 py-1.5 text-right font-mono font-bold ${anomala ? 'text-amber-500' : 'text-violet-600'}`}>
                              {m3.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                              {anomala && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-500" />}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-slate-900">R$ {fmt(u.valor_total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              {lista.length > 0 && limiar > 0 && (
                <div className="px-6 py-2.5 border-t border-slate-200 text-[10px] text-slate-500 flex items-center gap-2 shrink-0">
                  <span className="inline-block w-3 h-3 rounded bg-amber-500/20 border border-amber-500/40" />
                  Destacado: consumo &gt; 2× a mediana ({limiar.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³)
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
