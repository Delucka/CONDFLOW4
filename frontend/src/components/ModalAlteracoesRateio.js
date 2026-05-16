'use client';
import { useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { useAlteracoesRateio, TIPOS_ALTERACAO, STATUS_ALTERACAO } from '@/lib/useAlteracoesRateio';
import {
  X, Plus, Calendar, Trash2, Check, AlertCircle, Loader2, MessageSquare,
  FileWarning
} from 'lucide-react';

const MESES = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
};

const COLORS = {
  amber:   { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300',   dot: 'bg-amber-400' },
  orange:  { bg: 'bg-orange-500/10',  border: 'border-orange-500/30',  text: 'text-orange-300',  dot: 'bg-orange-400' },
  cyan:    { bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    text: 'text-cyan-300',    dot: 'bg-cyan-400' },
  emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  slate:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/30',   text: 'text-slate-300',   dot: 'bg-slate-400' },
};

export default function ModalAlteracoesRateio({ condoId, ano, mesInicial = null, onClose }) {
  const supabase = createClient();
  const { user } = useAuth();
  const { addToast } = useToast();
  const { alteracoes, refetch, loading } = useAlteracoesRateio(condoId, ano);

  const [mostrarForm, setMostrarForm] = useState(!!mesInicial);
  const [submetendo, setSubmetendo] = useState(false);
  const [editandoId, setEditandoId] = useState(null);

  const [form, setForm] = useState({
    mes: mesInicial || new Date().getMonth() + 1,
    tipo: 'AGO',
    data_evento: '',
    descricao: '',
    status: 'prevista',
  });

  function abrirForm(altParaEditar = null) {
    if (altParaEditar) {
      setEditandoId(altParaEditar.id);
      setForm({
        mes: altParaEditar.mes_referencia,
        tipo: altParaEditar.tipo,
        data_evento: altParaEditar.data_evento || '',
        descricao: altParaEditar.descricao || '',
        status: altParaEditar.status,
      });
    } else {
      setEditandoId(null);
      setForm({
        mes: mesInicial || new Date().getMonth() + 1,
        tipo: 'AGO',
        data_evento: '',
        descricao: '',
        status: 'prevista',
      });
    }
    setMostrarForm(true);
  }

  function fecharForm() {
    setMostrarForm(false);
    setEditandoId(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.data_evento) {
      addToast('Informe a data do evento', 'error');
      return;
    }
    setSubmetendo(true);
    try {
      const payload = {
        condominio_id: condoId,
        mes_referencia: form.mes,
        ano_referencia: ano,
        tipo: form.tipo,
        data_evento: form.data_evento,
        descricao: form.descricao || null,
        status: form.status,
        atualizado_por: user?.id,
        atualizado_em: new Date().toISOString(),
      };
      if (editandoId) {
        const { error } = await supabase.from('alteracoes_rateio').update(payload).eq('id', editandoId);
        if (error) throw error;
        addToast('Alteração atualizada!', 'success');
      } else {
        payload.criado_por = user?.id;
        const { error } = await supabase.from('alteracoes_rateio').insert(payload);
        if (error) throw error;
        addToast('Alteração registrada!', 'success');
      }
      fecharForm();
      refetch();
    } catch (err) {
      addToast('Erro: ' + (err.message || err), 'error');
    } finally {
      setSubmetendo(false);
    }
  }

  async function alterarStatus(id, novoStatus) {
    try {
      const { error } = await supabase
        .from('alteracoes_rateio')
        .update({ status: novoStatus, atualizado_por: user?.id, atualizado_em: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      addToast(`Marcada como ${novoStatus}.`, 'success');
      refetch();
    } catch (err) {
      addToast('Erro ao alterar status: ' + (err.message || err), 'error');
    }
  }

  async function remover(id) {
    if (!window.confirm('Remover esta alteração?')) return;
    try {
      const { error } = await supabase.from('alteracoes_rateio').delete().eq('id', id);
      if (error) throw error;
      addToast('Alteração removida.', 'success');
      refetch();
    } catch (err) {
      addToast('Erro: ' + (err.message || err), 'error');
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-[#0a0a0f] border border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-black text-white uppercase tracking-tight flex items-center gap-2">
              <FileWarning className="w-5 h-5 text-amber-400" /> Alterações do Rateio
            </h3>
            <p className="text-[10px] text-gray-500 mt-0.5 font-bold uppercase tracking-widest">
              {ano} — AGO / AGE / Reunião
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* FORM */}
          {mostrarForm && (
            <form onSubmit={handleSubmit} className="p-6 border-b border-white/10 space-y-4 bg-white/[0.02]">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Mês</label>
                  <select required value={form.mes} onChange={(e) => setForm({ ...form, mes: parseInt(e.target.value) })}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500">
                    {Object.entries(MESES).map(([m, nome]) => (
                      <option key={m} value={m}>{nome}/{String(ano).slice(-2)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Tipo</label>
                  <select required value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500">
                    {TIPOS_ALTERACAO.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1">
                  <Calendar className="w-3 h-3" /> Data do evento
                </label>
                <input type="date" required value={form.data_evento}
                  onChange={(e) => setForm({ ...form, data_evento: e.target.value })}
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500" />
              </div>

              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Descrição (opcional)</label>
                <textarea value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  rows={2} placeholder="Ex: Aprovação da reforma da piscina"
                  className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500 placeholder:text-slate-700" />
              </div>

              {editandoId && (
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">Status</label>
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                    className="w-full bg-slate-900 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-amber-500">
                    {STATUS_ALTERACAO.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={fecharForm} className="px-4 py-2 text-xs text-slate-500 font-bold uppercase tracking-widest hover:text-white transition-colors">
                  Cancelar
                </button>
                <button type="submit" disabled={submetendo}
                  className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-black uppercase tracking-widest text-xs flex items-center gap-2 disabled:opacity-50">
                  {submetendo ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {editandoId ? 'Salvar' : 'Registrar'}
                </button>
              </div>
            </form>
          )}

          {/* LISTA */}
          <div className="p-6 space-y-3">
            {!mostrarForm && (
              <button onClick={() => abrirForm()}
                className="w-full py-3 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 border-dashed rounded-xl text-amber-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all">
                <Plus className="w-4 h-4" /> Nova Alteração
              </button>
            )}

            {loading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
              </div>
            ) : alteracoes.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                Nenhuma alteração registrada para {ano}.
              </div>
            ) : (
              alteracoes.map(alt => {
                const tipoInfo = TIPOS_ALTERACAO.find(t => t.value === alt.tipo);
                const statusInfo = STATUS_ALTERACAO.find(s => s.value === alt.status);
                const c = COLORS[statusInfo?.color || 'slate'];
                const tc = COLORS[tipoInfo?.color || 'amber'];
                return (
                  <div key={alt.id} className={`p-4 rounded-2xl border ${c.bg} ${c.border}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${tc.bg} ${tc.text} border ${tc.border}`}>
                            {alt.tipo}
                          </span>
                          <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${c.bg} ${c.text} border ${c.border}`}>
                            {statusInfo?.label || alt.status}
                          </span>
                          <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">
                            {MESES[alt.mes_referencia]}/{ano}
                          </span>
                        </div>
                        <p className="text-sm font-bold text-white flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          {new Date(alt.data_evento + 'T00:00:00').toLocaleDateString('pt-BR')}
                        </p>
                        {alt.descricao && (
                          <p className="text-xs text-slate-400 mt-2 flex items-start gap-1.5">
                            <MessageSquare className="w-3 h-3 mt-0.5 shrink-0 text-slate-600" />
                            <span>{alt.descricao}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {alt.status === 'prevista' && (
                          <>
                            <button onClick={() => alterarStatus(alt.id, 'realizada')}
                              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
                              ✓ Realizada
                            </button>
                            <button onClick={() => alterarStatus(alt.id, 'cancelada')}
                              className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/30 text-slate-400">
                              ✗ Cancelada
                            </button>
                          </>
                        )}
                        <div className="flex gap-1 mt-1">
                          <button onClick={() => abrirForm(alt)} className="p-1.5 text-slate-500 hover:text-cyan-400" title="Editar">
                            <FileWarning className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => remover(alt.id)} className="p-1.5 text-slate-500 hover:text-rose-400" title="Remover">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="px-6 py-3 border-t border-white/10 text-[10px] text-gray-600 uppercase tracking-widest font-bold flex items-center gap-2 shrink-0">
          <AlertCircle className="w-3 h-3" />
          Alterações <strong className="text-amber-400">previstas</strong> bloqueiam emissão até marcar como <strong className="text-emerald-400">realizada</strong> ou <strong className="text-slate-400">cancelada</strong>.
        </div>
      </div>
    </div>
  );
}
