'use client';
import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { apiFetcher } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import { FileText, Building2, Receipt, Loader2, X, Check, AlertCircle, ExternalLink, PenTool, ChevronLeft, ChevronRight, Package, FolderOpen } from 'lucide-react';



function fmt(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VisualizadorConferencia({ arquivo, arquivos = [], currentUser, onClose, onAction }) {
  const { addToast } = useToast();
  const supabase = createClient();

  const [currentFile, setCurrentFile] = useState(arquivo);
  const [loadingFile, setLoadingFile] = useState(false);
  
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

  // Snapshot congela os valores; dados ao vivo são mutáveis
  const planilha = isSnapshot ? arquivo.planilha_snapshot : data?.planilha;
  const cobrancas = isSnapshot ? [] : (data?.cobrancas_extras || []);

  useEffect(() => {
    if (arquivo) {
      setCurrentFile(arquivo);
    }
  }, [arquivo]);

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
        body: JSON.stringify({ action: 'approve', comment: '', sign: true })
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
    const fluxos = {
      1: { default: 'aprovado' },
      2: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      3: { 'Aguardando Gerente': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
      4: { 'Aguardando Gerente': 'Aguardando Chefe', 'Aguardando Chefe': 'Aguardando Supervisor', 'Aguardando Supervisor': 'aprovado' },
    };
    const fluxoId = Number(pacoteNivel) || 1;
    const nextStatus = fluxos[fluxoId]?.[pacoteStatus] ?? fluxos[fluxoId]?.default ?? 'aprovado';
    setExecutando(true);
    try {
      const payload = { status: nextStatus, atualizado_em: new Date().toISOString() };
      if (observacaoAprovacao.trim()) {
        payload.observacao_aprovacao = observacaoAprovacao.trim();
      }
      const { error, data } = await supabase
        .from('emissoes_pacotes')
        .update(payload)
        .eq('id', pacoteId)
        .select('id');
      if (error || !data || data.length === 0) throw new Error(error?.message || 'Sem permissão para aprovar');
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
        const path = `correcoes/${pacoteId}/${Date.now()}_${correcaoFile.name}`;
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
        })
        .eq('id', pacoteId);
      if (error) throw error;
      addToast('Correção solicitada. Pacote retornado.', 'success');
      onAction?.(); onClose?.();
    } catch (e) { addToast(e.message, 'error'); }
    finally { setExecutando(false); }
  }

  // Navegação entre arquivos
  const currentIndex = arquivos.findIndex(a => String(a.id) === String(currentFile?.id));
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < arquivos.length - 1;

  async function openArquivo(a) {
    setLoadingFile(true);
    try {
      const path = a.arquivo_url || a.path;
      let url = a.url;
      if (!url && path) {
        const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(path, 300);
        if (error) throw error;
        url = data.signedUrl;
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

  async function handleNavigate(direction) {
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= arquivos.length) return;

    setLoadingFile(true);
    const nextDoc = arquivos[nextIndex];
    
    try {
      const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(nextDoc.arquivo_url, 300);
      if (error) throw error;

      setCurrentFile({
        ...currentFile,
        id: nextDoc.id,
        nome: nextDoc.arquivo_nome,
        url: data.signedUrl
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
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col">

      {/* Header */}
      <div className="px-4 h-[52px] border-b border-slate-800 bg-slate-900/95 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <FileText className="w-4 h-4 text-violet-400 shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm text-white font-bold truncate leading-tight">{currentFile?.nome || 'Documento'}</h3>
            <p className="text-[9px] uppercase tracking-widest text-slate-500">Conferência {arquivos.length > 1 ? `· ${currentIndex + 1} de ${arquivos.length}` : ''}</p>
          </div>
        </div>

        {/* Navegação entre arquivos */}
        {arquivos.length > 1 && (
          <div className="flex items-center gap-1 bg-black/30 rounded-lg p-0.5 border border-white/5 shrink-0">
            <button
              onClick={() => handleNavigate(-1)}
              disabled={!hasPrev || loadingFile}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-colors"
              title="Anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <select
              value={currentFile?.id || ''}
              onChange={(e) => {
                const arq = arquivos.find(a => String(a.id) === e.target.value);
                if (arq) {
                  const idx = arquivos.indexOf(arq);
                  handleNavigate(idx - currentIndex);
                }
              }}
              className="bg-transparent text-[10px] font-bold text-white outline-none px-1.5 py-1 max-w-[140px] truncate cursor-pointer"
            >
              {arquivos.map((a, i) => (
                <option key={a.id} value={a.id} className="bg-slate-900">
                  {i + 1}. {a.arquivo_nome}
                </option>
              ))}
            </select>
            <button
              onClick={() => handleNavigate(1)}
              disabled={!hasNext || loadingFile}
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-colors"
              title="Próximo"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          {arquivo.url && (
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5 transition-colors" title="Abrir em nova aba">
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/5" title="Fechar">
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
                const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arquivo.correcao_arquivo_url, 300);
                if (error) return addToast('Erro ao abrir anexo', 'error');
                window.open(data.signedUrl, '_blank');
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
                const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(arquivo.resposta_correcao_arquivo_url, 300);
                if (error) return addToast('Erro ao abrir anexo', 'error');
                window.open(data.signedUrl, '_blank');
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[10px] font-bold uppercase tracking-widest">
              <FileText className="w-3 h-3" />
              {arquivo.resposta_correcao_arquivo_nome || 'Anexo da correção'}
            </button>
          )}
        </div>
      )}

      {/* Split view */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-3 p-3 overflow-auto lg:overflow-hidden">

        {/* PDF */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col relative min-h-[60vh] lg:min-h-0">
          {loadingFile && (
            <div className="absolute inset-0 z-10 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className={`w-4 h-4 ${isSnapshot ? 'text-amber-400' : 'text-cyan-400'}`} />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">
                    Planilha {isSnapshot ? `· Mês ${String(arquivo.mes).padStart(2,'0')}/${arquivo.ano}` : (planilha?.ano ? `Anual · ${planilha.ano}` : 'Anual')}
                  </h4>
                  <p className="text-[10px] text-slate-500">
                    {isSnapshot ? 'Valores congelados no momento da emissão' : 'Espelho em tempo real'}
                  </p>
                </div>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${isSnapshot ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'}`}>
                {isSnapshot ? '🔒 Congelado' : 'Só leitura'}
              </span>
            </div>

            {loading
              ? <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
              : mesesParaExibir.length === 0
                ? <div className="p-6 text-center text-slate-500 text-sm">
                    <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    Nenhuma planilha cadastrada para este condomínio.
                  </div>
                : <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-950/30">
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
                        <tr key={m.mes} className="border-t border-slate-800">
                          <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{m.mes_nome}</td>
                          {(planilha?.colunas || []).map(col => (
                            <td key={col} className="text-right px-3 py-2 text-xs text-slate-300 font-mono whitespace-nowrap">
                              {fmt(m.valores?.[col])}
                            </td>
                          ))}
                          <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{fmt(m.total)}</td>
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-72 shrink-0">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Cobranças Extras</h4>
                  <p className="text-[10px] text-slate-500">Lançadas pelo gerente/assistente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                {cobrancas.length} {cobrancas.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            {loading
              ? <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-indigo-500" /></div>
              : cobrancas.length === 0
                ? <div className="p-6 text-center">
                    <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                    <p className="text-sm text-slate-500">Nenhuma cobrança extra lançada</p>
                    <p className="text-xs text-slate-600 mt-1">Quando houver, aparecerão aqui.</p>
                  </div>
                : <div className="overflow-y-auto flex-1">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-950/90 backdrop-blur z-10">
                        <tr>
                          <th className="text-left px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Descrição</th>
                          <th className="text-right px-3 py-2 text-[10px] font-bold uppercase text-slate-500">Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cobrancas.map(c => (
                          <tr key={c.id} className="border-t border-slate-800">
                            <td className="px-3 py-2 text-xs text-slate-300">
                              <div className="flex items-center gap-2">
                                {c.descricao}
                                {c.attachments?.length > 0 && (
                                   <button 
                                     onClick={() => {
                                       setLoadingFile(true);
                                       setCurrentFile({
                                         ...currentFile,
                                         id: `att_${c.id}`,
                                         nome: `Anexo: ${c.descricao}`,
                                         url: c.attachments[0] // Assume que já é a Signed URL vinda da API de conferência
                                       });
                                       setLoadingFile(false);
                                     }}
                                     className="text-slate-500 hover:text-cyan-400 transition-colors" 
                                     title="Visualizar anexo aqui"
                                   >
                                     <FileText className="w-3 h-3" />
                                   </button>
                                 )}
                              </div>
                            </td>
                            <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{fmt(c.valor)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
            }
          </div>

          {/* Concessionárias — só se houver anexos dessa categoria */}
          {(() => {
            const concessionarias = arquivos.filter(a => a.categoria === 'concessionaria');
            if (concessionarias.length === 0) return null;
            return (
              <div className="bg-slate-900 border border-orange-500/30 rounded-xl overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-orange-500/20 bg-orange-500/5 flex items-center gap-2">
                  <Package className="w-4 h-4 text-orange-400" />
                  <h4 className="text-sm font-bold text-orange-300">Concessionárias</h4>
                  <span className="ml-auto text-[10px] text-orange-400/70 font-bold">{concessionarias.length} arquivo{concessionarias.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {concessionarias.map(a => {
                    const eAtual = currentFile?.id === a.id;
                    return (
                      <button key={a.id} onClick={() => openArquivo(a)}
                        className={`w-full px-4 py-2.5 flex items-start gap-3 hover:bg-orange-500/5 transition-colors text-left ${eAtual ? 'bg-orange-500/10' : ''}`}>
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30 shrink-0 mt-0.5">
                          {a.subtipo || 'Outra'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-300 truncate flex-1">{a.arquivo_nome}</span>
                            {eAtual && <Check className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                          </div>
                          {(a.nome_condominio_fatura || a.vencimento_fatura || a.valor_fatura) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                              {a.nome_condominio_fatura && (
                                <span className="text-orange-300/90"><span className="text-orange-500/50">cliente:</span> {a.nome_condominio_fatura}</span>
                              )}
                              {a.vencimento_fatura && (
                                <span className="text-orange-300/90"><span className="text-orange-500/50">venc:</span> {new Date(a.vencimento_fatura + 'T12:00:00').toLocaleDateString('pt-BR')}</span>
                              )}
                              {a.valor_fatura != null && (
                                <span className="text-orange-300 font-bold"><span className="text-orange-500/50 font-normal">total:</span> R$ {Number(a.valor_fatura).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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

          {/* Outros anexos (relatórios, atas, etc) */}
          {(() => {
            const outros = arquivos.filter(a => a.categoria === 'outros');
            if (outros.length === 0) return null;
            return (
              <div className="bg-slate-900 border border-slate-700 rounded-xl overflow-hidden shrink-0">
                <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-slate-400" />
                  <h4 className="text-sm font-bold text-slate-200">Outros Anexos</h4>
                  <span className="ml-auto text-[10px] text-slate-500 font-bold">{outros.length} arquivo{outros.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="divide-y divide-slate-800/50">
                  {outros.map(a => {
                    const eAtual = currentFile?.id === a.id;
                    return (
                      <button key={a.id} onClick={() => openArquivo(a)}
                        className={`w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-800/50 transition-colors text-left ${eAtual ? 'bg-slate-800/70' : ''}`}>
                        {a.subtipo && (
                          <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-300 border border-slate-500/30 shrink-0 truncate max-w-[100px]" title={a.subtipo}>
                            {a.subtipo}
                          </span>
                        )}
                        <span className="text-xs text-slate-300 truncate flex-1">{a.arquivo_nome}</span>
                        {eAtual && <Check className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
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
          <div className="shrink-0 px-4 py-3 border-t border-slate-800 bg-slate-900/95">
            {!modoCorrecao
              ? <div className="space-y-2">
                  {/* Observacao opcional - so para fluxo de pacote */}
                  {modoPacote && (
                    <input
                      value={observacaoAprovacao}
                      onChange={(e) => setObservacaoAprovacao(e.target.value)}
                      placeholder="Observação ao aprovar (opcional)"
                      className="w-full bg-slate-800/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/40 placeholder-slate-500"
                    />
                  )}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      {modoPacote
                        ? <><span className="text-[9px] uppercase tracking-widest text-slate-500">Status</span> <span className="text-cyan-400 font-bold">{arquivo?.pacote_status || '—'}</span></>
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
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-600 resize-y" />

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
                          <button onClick={() => setCorrecaoFile(null)} className="text-rose-400 hover:text-white text-xs font-bold">Remover</button>
                        </div>
                      ) : (
                        <input type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
                          onChange={(e) => setCorrecaoFile(e.target.files?.[0] || null)}
                          className="block w-full text-xs text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-bold file:bg-rose-500/10 file:text-rose-300 hover:file:bg-rose-500/20" />
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-3">
                    <button onClick={() => { setModoCorrecao(false); setComentario(''); setCorrecaoFile(null); }} disabled={executando}
                      className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
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
    </div>
  );
}
