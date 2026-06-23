'use client';
import { useState, useEffect } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { X, Loader2, Save, FileText, FileBarChart, CheckCircle, Calendar, Trash2, Lock, Unlock } from 'lucide-react';
import { apiPost } from '@/lib/api';

const ETAPAS = [
  {
    id: 'aguardando_fatura',
    label: 'Aguardando fatura',
    desc: 'Aguardando recebimento da fatura',
    icon: FileText,
    color: 'amber',
    dateField: 'data_fatura',
    dateLabel: 'Data de emissão da fatura',
  },
  {
    id: 'aguardando_relatorio',
    label: 'Aguardando relatório',
    desc: 'Aguardando relatório de faturas enviadas',
    icon: FileBarChart,
    color: 'sky',
    dateField: 'data_relatorio',
    dateLabel: 'Data do relatório de faturas enviadas',
  },
  {
    id: 'pronto_para_emitir',
    label: 'Pronto para emitir',
    desc: 'Conferências feitas — pode iniciar emissão',
    icon: CheckCircle,
    color: 'emerald',
    dateField: null,
    dateLabel: null,
  },
];

const COLOR_CLASSES = {
  amber:   { active: 'border-amber-500 bg-amber-500/10',     icon: 'bg-amber-500/20 text-amber-400',   text: 'text-amber-300' },
  sky:     { active: 'border-violet-500 bg-violet-500/10',         icon: 'bg-violet-500/20 text-violet-400',       text: 'text-violet-300' },
  emerald: { active: 'border-emerald-500 bg-emerald-500/10', icon: 'bg-emerald-500/20 text-emerald-400', text: 'text-emerald-300' },
};

export default function ModalPreparacao({ condo, mes, ano, onClose, onSaved }) {
  const supabase = createClient();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [etapa, setEtapa]       = useState('aguardando_fatura');
  const [dataFatura, setDataFatura]       = useState('');
  const [dataRelatorio, setDataRelatorio] = useState('');
  const [notas, setNotas]       = useState('');
  const [existingId, setExistingId] = useState(null);
  const [edicaoGerente, setEdicaoGerente] = useState(null);  // registro edicoes_mensais deste mês
  const [reabrindo, setReabrindo] = useState(false);

  // Busca o status de edição do gerente (edicoes_mensais) deste condo/mês
  async function fetchEdicao() {
    try {
      const { data } = await supabase
        .from('edicoes_mensais')
        .select('id, status, liberado_em, aberto_em')
        .eq('condominio_id', condo.id)
        .eq('mes_referencia', mes)
        .eq('ano_referencia', ano)
        .maybeSingle();
      setEdicaoGerente(data || null);
    } catch { /* opcional */ }
  }

  useEffect(() => {
    async function carregar() {
      setLoading(true);
      try {
        const { data } = await supabase
          .from('emissoes_preparacao')
          .select('*')
          .eq('condominio_id', condo.id)
          .eq('mes_referencia', mes)
          .eq('ano_referencia', ano)
          .maybeSingle();
        if (data) {
          setExistingId(data.id);
          setEtapa(data.etapa || 'aguardando_fatura');
          setDataFatura(data.data_fatura || '');
          setDataRelatorio(data.data_relatorio || '');
          setNotas(data.notas || '');
        }
        await fetchEdicao();
      } finally {
        setLoading(false);
      }
    }
    carregar();
  }, [condo.id, mes, ano, supabase]);

  // Reabre o mês p/ o gerente alterar (mesma ação do painel, mas aqui no fluxo de emissão)
  async function handleReabrir() {
    setReabrindo(true);
    try {
      await apiPost('/api/edicoes-mensais/abrir', { mes, ano, condominio_id: condo.id });
      await fetchEdicao();
      addToast('Mês reaberto — o gerente já pode alterar a planilha.', 'success');
      onSaved?.();
    } catch (err) {
      addToast('Erro ao reabrir: ' + (err.message || err), 'error');
    } finally {
      setReabrindo(false);
    }
  }

  async function handleLimpar() {
    if (!existingId) return;
    if (!window.confirm('Tem certeza que deseja limpar a etapa? Ela voltará para "Definir Etapa".')) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('emissoes_preparacao').delete().eq('id', existingId);
      if (error) throw error;
      addToast('Etapa removida.', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      addToast('Erro ao limpar: ' + (err.message || err), 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        condominio_id:  condo.id,
        mes_referencia: mes,
        ano_referencia: ano,
        etapa,
        data_fatura:    dataFatura || null,
        data_relatorio: dataRelatorio || null,
        notas:          notas || null,
        atualizado_por: user?.id,
        atualizado_em:  new Date().toISOString(),
      };

      if (existingId) {
        const { error } = await supabase
          .from('emissoes_preparacao').update(payload).eq('id', existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('emissoes_preparacao').insert(payload);
        if (error) throw error;
      }

      // O lock acontece automaticamente por mês via useLockedMonths
      // — quando etapa = 'pronto_para_emitir' o mês X fica travado para edição.
      // Não há mais auto-lock semestral.
      addToast(
        etapa === 'pronto_para_emitir'
          ? `Etapa salva! O mês ${String(mes).padStart(2,'0')}/${ano} fica bloqueado para edição.`
          : 'Etapa de preparação atualizada!',
        'success'
      );

      onSaved?.();
      onClose();
    } catch (err) {
      addToast('Erro ao salvar: ' + (err.message || err), 'error');
    } finally {
      setSaving(false);
    }
  }

  const etapaAtual = ETAPAS.find(e => e.id === etapa);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-md p-4 animate-fade-in">
      <div className="bg-white border border-slate-200 rounded-3xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Etapa de Preparação</h3>
            <p className="text-[10px] text-slate-500 mt-0.5 font-bold uppercase tracking-widest">
              {condo.name} · {String(mes).padStart(2,'0')}/{ano}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X className="w-5 h-5" /></button>
        </div>

        {loading ? (
          <div className="p-12 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Edição da gerência — status do gerente + reabrir p/ alteração (sem ir ao painel) */}
            {(() => {
              const st = edicaoGerente?.status;
              const liberado = st === 'edicao_finalizada';
              const emEdicao = st === 'em_edicao';
              const pediu = st === 'reabertura_solicitada';
              const isMaster = user?.role === 'master';
              const dataLib = edicaoGerente?.liberado_em ? new Date(edicaoGerente.liberado_em).toLocaleDateString('pt-BR') : null;
              return (
                <div className={`rounded-2xl border p-3.5 flex items-center gap-3 ${
                  liberado ? 'bg-emerald-50 border-emerald-200' :
                  emEdicao ? 'bg-amber-50 border-amber-200' :
                  pediu ? 'bg-violet-50 border-violet-200' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Edição da gerência</p>
                    <p className="text-sm font-bold mt-0.5 flex items-center gap-1.5">
                      {liberado ? <><CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" /> <span className="text-emerald-800">Liberado pelo gerente{dataLib ? ` · ${dataLib}` : ''}</span></>
                        : emEdicao ? <><Unlock className="w-4 h-4 text-amber-600 shrink-0" /> <span className="text-amber-800">Aberto — gerente editando</span></>
                        : pediu ? <><Lock className="w-4 h-4 text-violet-600 shrink-0" /> <span className="text-violet-800">Gerente pediu reabertura</span></>
                        : <span className="text-slate-500">Mês não aberto para o gerente</span>}
                    </p>
                  </div>
                  {isMaster && !emEdicao && (
                    <button type="button" onClick={handleReabrir} disabled={reabrindo}
                      className="shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50 flex items-center gap-1.5">
                      {reabrindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                      {liberado || pediu ? 'Reabrir p/ alteração' : 'Abrir p/ o gerente'}
                    </button>
                  )}
                </div>
              );
            })()}

            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Etapa atual</label>
              <div className="space-y-2">
                {ETAPAS.map(et => {
                  const Icon = et.icon;
                  const isActive = etapa === et.id;
                  const colors = COLOR_CLASSES[et.color];
                  return (
                    <button
                      key={et.id}
                      type="button"
                      onClick={() => setEtapa(et.id)}
                      className={`w-full text-left flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                        isActive ? colors.active : 'border-slate-200 bg-slate-50 hover:border-slate-200'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isActive ? colors.icon : 'bg-slate-50 text-slate-500'}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-black ${isActive ? 'text-slate-900' : 'text-slate-500'}`}>{et.label}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{et.desc}</p>
                      </div>
                      {isActive && <div className={`w-2 h-2 rounded-full ${colors.icon.split(' ')[0]}`} />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date pickers — sempre visíveis pra registrar histórico mesmo após mudar de etapa */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> Data emissão fatura
                </label>
                <input type="date" value={dataFatura} onChange={(e) => setDataFatura(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:border-amber-500 outline-none transition-all" />
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                  <Calendar className="w-3 h-3" /> Data relatório enviadas
                </label>
                <input type="date" value={dataRelatorio} onChange={(e) => setDataRelatorio(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:border-violet-500 outline-none transition-all" />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Notas (opcional)</label>
              <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={3}
                placeholder="Observações relevantes para esta etapa..."
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 focus:border-violet-500 outline-none transition-all placeholder:text-slate-700" />
            </div>

            {/* Aviso quando vai bloquear o mes */}
            {etapa === 'pronto_para_emitir' && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2">
                <Lock className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-[11px] text-rose-300 leading-relaxed">
                  <strong>Atenção:</strong> ao salvar nesta etapa, o mês <strong>{String(mes).padStart(2,'0')}/{ano}</strong> da planilha e das cobranças extras será <strong>bloqueado automaticamente</strong>. Os demais meses continuam editáveis.
                </p>
              </div>
            )}
          </form>
        )}

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          {existingId ? (
            <button onClick={handleLimpar} disabled={saving || loading}
              className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-rose-400 font-black uppercase tracking-widest hover:bg-rose-500/10 rounded-lg transition-colors disabled:opacity-50">
              <Trash2 className="w-3.5 h-3.5" /> Limpar etapa
            </button>
          ) : <div />}
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="px-5 py-2.5 text-xs text-slate-500 font-bold uppercase tracking-widest hover:text-slate-900 transition-colors">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={saving || loading}
              className="px-6 py-3 bg-violet-500 hover:bg-violet-400 text-slate-950 rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-violet-500/20 disabled:opacity-50 flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Salvar Etapa
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
