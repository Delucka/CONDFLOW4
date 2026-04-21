'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import {
  FileText, Building2, Receipt, Loader2, X, Check, AlertCircle,
  ExternalLink, PenTool
} from 'lucide-react';

/**
 * VisualizadorConferencia
 *
 * Mostra o PDF à esquerda + painel lateral com Planilha Anual e Cobranças Extras.
 * Botões de ação aparecem conforme o role do usuário.
 *
 * Props:
 * - arquivo: { id, nome, url, processo_id, condominio_id, emitido_por }
 * - currentUser: { id, role, full_name }
 * - onClose: callback para fechar o viewer
 * - onAction: callback chamado após aprovar/correção (refresh da lista)
 */
export default function VisualizadorConferencia({ arquivo, currentUser, onClose, onAction }) {
  const { addToast } = useToast();
  const supabase = createClient();

  const [planilha, setPlanilha] = useState(null);
  const [cobrancasExtras, setCobrancasExtras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modoCorrecao, setModoCorrecao] = useState(false);
  const [comentario, setComentario] = useState('');
  const [executando, setExecutando] = useState(false);

  // Capabilities do usuário
  const podeAprovar = can(currentUser?.role, 'approve_document');
  const podeAssinar = can(currentUser?.role, 'sign_document');

  // ─── Carrega planilha e cobranças extras ──────────────────────────
  useEffect(() => {
    async function carregar() {
      if (!arquivo?.condominio_id) return;
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;

        const res = await fetch(`/api/condominio/${arquivo.condominio_id}/conferencia`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data = await res.json();
          setPlanilha(data.planilha);
          setCobrancasExtras(data.cobrancas_extras || []);
        } else {
          addToast('Não foi possível carregar os dados da planilha.', 'error');
        }
      } catch (err) {
        addToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [arquivo?.condominio_id, addToast, supabase]);

  // ─── Ações ────────────────────────────────────────────────────────
  async function handleAprovar() {
    if (!arquivo.processo_id) {
      addToast('Processo não vinculado a este arquivo.', 'error');
      return;
    }
    setExecutando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Aprova + assina em uma única chamada
      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'approve', comment: '', sign: true })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao aprovar');
      addToast('Documento aprovado e assinado!', 'success');
      onAction?.();
      onClose?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExecutando(false);
    }
  }

  async function handleSolicitarCorrecao() {
    if (!comentario.trim()) {
      addToast('Descreva o motivo da correção.', 'warning');
      return;
    }
    setExecutando(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/processo/${arquivo.processo_id}/acao`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ action: 'reject', comment: comentario.trim() })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Erro ao solicitar correção');
      addToast('Correção solicitada. Documento retornado ao emissor.', 'success');
      onAction?.();
      onClose?.();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setExecutando(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-violet-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-white font-bold truncate">{arquivo.nome || 'Documento'}</h3>
            <p className="text-[10px] uppercase tracking-widest text-cyan-400">Visualização integrada</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {arquivo.url && (
            <a href={arquivo.url} target="_blank" rel="noopener noreferrer"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              title="Abrir em nova aba">
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

        {/* ─── PDF à esquerda ─── */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          {arquivo.url ? (
            <iframe
              src={arquivo.url}
              title={arquivo.nome}
              className="w-full h-full bg-white"
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Documento sem URL disponível</p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Painel lateral direito ─── */}
        <div className="flex flex-col gap-3 overflow-y-auto">

          {/* Planilha Anual */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-cyan-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Planilha Anual</h4>
                  <p className="text-[10px] text-slate-500">Cadastrada pelo gerente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 px-2 py-0.5 rounded">
                Só leitura
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              </div>
            ) : !planilha || planilha.meses?.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Nenhuma planilha anual cadastrada para este condomínio.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950/30">
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Condomínio</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Fundo res.</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {planilha.meses.map((m) => (
                    <tr key={m.mes} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-xs font-bold text-slate-400 uppercase">{m.mes_nome}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-300 font-mono">{formatCurrency(m.condominio)}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-300 font-mono">{formatCurrency(m.fundo_reserva)}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{formatCurrency(m.total)}</td>
                    </tr>
                  ))}
                  {planilha.totais && (
                    <tr className="border-t border-emerald-500/30 bg-emerald-500/10">
                      <td className="px-3 py-2 text-xs font-bold text-emerald-400 uppercase">Total</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.condominio)}</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.fundo_reserva)}</td>
                      <td className="text-right px-3 py-2 text-xs text-emerald-400 font-mono font-bold">{formatCurrency(planilha.totais.total)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Cobranças Extras — sempre visível */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="w-4 h-4 text-amber-400" />
                <div>
                  <h4 className="text-sm font-bold text-slate-200">Cobranças Extras</h4>
                  <p className="text-[10px] text-slate-500">Lançadas pelo gerente/assistente</p>
                </div>
              </div>
              <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                {cobrancasExtras.length} {cobrancasExtras.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
              </div>
            ) : cobrancasExtras.length === 0 ? (
              <div className="p-6 text-center">
                <Receipt className="w-8 h-8 mx-auto mb-2 text-slate-700" />
                <p className="text-sm text-slate-500">Nenhuma cobrança extra lançada</p>
                <p className="text-xs text-slate-600 mt-1">Quando houver, aparecerão aqui para conferência.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-950/30">
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Descrição</th>
                    <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Mês</th>
                    <th className="text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {cobrancasExtras.map((c) => (
                    <tr key={c.id} className="border-t border-slate-800">
                      <td className="px-3 py-2 text-xs text-slate-300">{c.descricao}</td>
                      <td className="px-3 py-2 text-xs text-slate-400 uppercase">{c.mes_nome || c.mes}</td>
                      <td className="text-right px-3 py-2 text-xs text-slate-200 font-mono font-bold">{formatCurrency(c.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Footer com ações */}
      {podeAprovar && arquivo.processo_id && (
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-900 shrink-0">
          {!modoCorrecao ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs text-slate-400">
                {podeAssinar && (
                  <span className="inline-flex items-center gap-1">
                    <PenTool className="w-3 h-3" />
                    Ao aprovar, você assina digitalmente com seu nome e timestamp.
                  </span>
                )}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setModoCorrecao(true)}
                  disabled={executando}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors disabled:opacity-50">
                  Solicitar correção
                </button>
                <button
                  onClick={handleAprovar}
                  disabled={executando}
                  className="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                  {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  Aprovar e assinar
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Motivo da correção <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={comentario}
                onChange={e => setComentario(e.target.value)}
                rows={3}
                placeholder="Ex: Valor do fundo de reserva em Março divergente da planilha anual..."
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-rose-500 focus:border-rose-500 placeholder-slate-600 resize-none"
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setModoCorrecao(false); setComentario(''); }}
                  disabled={executando}
                  className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors">
                  Cancelar
                </button>
                <button
                  onClick={handleSolicitarCorrecao}
                  disabled={executando || !comentario.trim()}
                  className="px-5 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 transition-colors flex items-center gap-2 disabled:opacity-50">
                  {executando ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
                  Enviar correção ao emissor
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatCurrency(v) {
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
