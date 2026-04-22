'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { apiFetcher } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import { FileText, Building2, Receipt, Loader2, X, Check, AlertCircle, ExternalLink, PenTool, ChevronLeft, ChevronRight } from 'lucide-react';



function fmt(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function VisualizadorConferencia({ arquivo, arquivos = [], currentUser, onClose, onAction }) {
  const { addToast } = useToast();
  const supabase = createClient();

  const [currentFile, setCurrentFile] = useState(arquivo);
  const [loadingFile, setLoadingFile] = useState(false);
  
  const { data, error, isLoading: loading, mutate } = useSWR(
    currentFile?.condominio_id ? `/api/condominio/${currentFile.condominio_id}/conferencia` : null,
    apiFetcher,
    { refreshInterval: 3000, revalidateOnFocus: true }
  );

  const [modoCorrecao, setModoCorrecao] = useState(false);
  const [comentario, setComentario]   = useState('');
  const [executando, setExecutando]   = useState(false);

  const planilha = data?.planilha;
  const cobrancas = data?.cobrancas_extras || [];

  const podeAprovar = can(currentUser?.role, 'approve_document');
  const podeAssinar = can(currentUser?.role, 'sign_document');

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token;
  }

  async function handleAprovar() {
    if (!arquivo.processo_id) { addToast('Processo não vinculado.', 'error'); return; }
    setExecutando(true);
    try {
      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
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
    setExecutando(true);
    try {
      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
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

  // Navegação entre arquivos
  const currentIndex = arquivos.findIndex(a => a.id === currentFile.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < arquivos.length - 1;

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

  // Exibe todos os meses retornados pela API (mesmo os zerados)
  const mesesParaExibir = planilha?.meses || [];

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col">

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-bold truncate">{currentFile.nome || 'Documento'}</h3>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400">Visualização integrada {arquivos.length > 1 ? `(${currentIndex + 1} de ${arquivos.length})` : ''}</p>
          </div>
        </div>

        {/* Navegação */}
        {arquivos.length > 1 && (
          <div className="flex items-center gap-1 bg-black/20 rounded-xl p-1 border border-white/5">
            <button 
              onClick={() => handleNavigate(-1)} 
              disabled={!hasPrev || loadingFile}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="w-[1px] h-4 bg-white/10 mx-1" />
            <button 
              onClick={() => handleNavigate(1)} 
              disabled={!hasNext || loadingFile}
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          {arquivo.url && (
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors">
              <ExternalLink className="w-5 h-5" />
            </a>
          )}
          <button onClick={onClose} className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-3 p-3 overflow-hidden">

        {/* PDF */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col relative">
          {loadingFile && (
            <div className="absolute inset-0 z-10 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-cyan-500 animate-spin" />
            </div>
          )}
          {currentFile.url
            ? <iframe src={currentFile.url} title={currentFile.nome} className="w-full h-full bg-white" />
            : <div className="flex-1 flex items-center justify-center text-slate-500 text-center">
                <div><FileText className="w-12 h-12 mx-auto mb-2 opacity-30" /><p className="text-sm">Sem URL disponível</p></div>
              </div>
          }
        </div>

        {/* Painel lateral */}
        <div className="flex flex-col gap-3 overflow-y-auto">

          {/* Planilha Anual */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Planilha Anual {planilha?.ano ? `· ${planilha.ano}` : ''}</h4>
                  <p className="text-[10px] text-slate-500">Espelho em tempo real</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded">Só leitura</span>
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
                          <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{fmt(planilha.totais.condominio)}</td>
                          <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{fmt(planilha.totais.fundo_reserva)}</td>
                          <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{fmt(planilha.totais.total)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
            }
          </div>

          {/* Cobranças Extras — sempre visível */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-72">
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
                                  <a href={c.attachments[0]} target="_blank" rel="noreferrer"
                                    className="text-slate-500 hover:text-cyan-400 transition-colors" title="Ver documento anexado">
                                    <FileText className="w-3 h-3" />
                                  </a>
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
        </div>
      </div>

      {/* Footer ações */}
      {podeAprovar && arquivo.processo_id && (
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900 shrink-0">
          {!modoCorrecao
            ? <div className="flex items-center justify-between gap-4">
                <p className="text-xs text-slate-400 flex items-center gap-1">
                  {podeAssinar && <><PenTool className="w-3 h-3" /> Ao aprovar, você assina digitalmente.</>}
                </p>
                <div className="flex gap-3">
                  <button onClick={() => setModoCorrecao(true)} disabled={executando}
                    className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                    Solicitar correção
                  </button>
                  <button onClick={handleAprovar} disabled={executando}
                    className="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                    {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Aprovar e assinar
                  </button>
                </div>
              </div>
            : <div className="space-y-3">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Motivo da correção <span className="text-rose-400">*</span>
                </label>
                <textarea value={comentario} onChange={e => setComentario(e.target.value)} rows={3}
                  placeholder="Descreva o que precisa ser corrigido..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-600 resize-none" />
                <div className="flex justify-end gap-3">
                  <button onClick={() => { setModoCorrecao(false); setComentario(''); }} disabled={executando}
                    className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                    Cancelar
                  </button>
                  <button onClick={handleCorrecao} disabled={executando || !comentario.trim()}
                    className="px-5 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors flex items-center gap-2 disabled:opacity-50">
                    {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                    Enviar correção
                  </button>
                </div>
              </div>
          }
        </div>
      )}
    </div>
  );
}
