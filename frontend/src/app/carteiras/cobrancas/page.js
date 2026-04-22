'use client';
import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import {
  Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2,
  Receipt, Calendar, Repeat, Building2, Clock,
  UploadCloud, FileText
} from 'lucide-react';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function getMesAtual() {
  const n = new Date();
  return { mes: n.getMonth() + 1, ano: n.getFullYear() };
}

function isBloqueado(mes, ano) {
  const { mes: ma, ano: aa } = getMesAtual();
  return ano < aa || (ano === aa && mes < ma);
}

async function getToken() {
  const sb = createClient();
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token;
}

async function apiFetch(url, opts = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.detail || 'Erro');
  return json;
}

// ─── Modal: Lançar Cobrança ────────────────────────────────────────
function ModalLancar({ condominioId, onClose, onSaved }) {
  const { addToast } = useToast();
  const { mes: mesAtual, ano: anoAtual } = getMesAtual();

  const [form, setForm] = useState({
    descricao: '',
    valor_total: '',
    mes_inicio: mesAtual,
    ano_inicio: anoAtual,
    parcelas: 1,
  });
  const [selectedFile, setSelectedFile] = useState(null);
  const [loading, setLoading] = useState(false);

  const valorParcela = form.valor_total && form.parcelas > 0
    ? (parseFloat(form.valor_total.replace(',', '.')) / form.parcelas).toFixed(2)
    : '—';

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      let fileUrl = null;
      if (selectedFile) {
        const sb = createClient();
        const fileName = `${Date.now()}_${selectedFile.name}`;
        const { data: uploadData, error: uploadErr } = await sb.storage
          .from('emissoes')
          .upload(`cobrancas_extras/${condominioId}/${fileName}`, selectedFile);
        
        if (uploadErr) throw uploadErr;
        fileUrl = uploadData.path;
      }

      await apiFetch('/api/cobrancas-extras/lancar', {
        method: 'POST',
        body: JSON.stringify({
          condominio_id: condominioId,
          descricao: form.descricao,
          valor_total: parseFloat(form.valor_total.replace(',', '.')),
          mes_inicio: form.mes_inicio,
          ano_inicio: form.ano_inicio,
          parcelas: form.parcelas,
          attachments: fileUrl ? [fileUrl] : []
        })
      });
      addToast(`Cobrança lançada em ${form.parcelas} parcela(s)!`, 'success');
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Anos disponíveis: atual + próximos 2
  const anos = [anoAtual, anoAtual + 1, anoAtual + 2];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-slate-200">Nova Cobrança Extra</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Descrição</label>
            <input required value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: Reforma portão eletrônico"
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-600" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Valor Total (R$)</label>
              <input required value={form.valor_total}
                onChange={e => setForm({ ...form, valor_total: e.target.value })}
                placeholder="0,00"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-600 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Parcelas</label>
              <select value={form.parcelas} onChange={e => setForm({ ...form, parcelas: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
                {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                  <option key={n} value={n}>{n === 1 ? 'À vista (1x)' : `${n}x`}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview parcela */}
          {form.valor_total && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300">
              <Repeat className="w-3 h-3 inline mr-1" />
              {form.parcelas === 1
                ? `Cobrança única de R$ ${valorParcela}`
                : `${form.parcelas}x de R$ ${valorParcela} por mês`}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Mês inicial</label>
              <select value={form.mes_inicio} onChange={e => setForm({ ...form, mes_inicio: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
                {MESES.map((m, i) => {
                  const bloq = isBloqueado(i + 1, form.ano_inicio);
                  return <option key={i} value={i + 1} disabled={bloq}>{m}{bloq ? ' 🔒' : ''}</option>;
                })}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ano</label>
              <select value={form.ano_inicio} onChange={e => setForm({ ...form, ano_inicio: Number(e.target.value) })}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
                {anos.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Preview meses */}
          {form.parcelas > 1 && (
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Parcelas agendadas:</p>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: form.parcelas }).map((_, i) => {
                  let m = form.mes_inicio + i;
                  let a = form.ano_inicio;
                  while (m > 12) { m -= 12; a += 1; }
                  return (
                    <span key={i} className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded">
                      {MESES[m-1]}/{a}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Anexo de Documento */}
        <div className="pt-2">
            <label className="block text-center border-2 border-dashed border-slate-700 
hover:border-amber-500/50 rounded-xl p-4 cursor-pointer bg-slate-800/50 hover:bg-amber-500/5 transition-all group">
                <input type="file" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0])} />
                <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center 
group-hover:scale-110 transition-transform">
                        {selectedFile ? <FileText className="w-5 h-5 text-amber-400" /> : <UploadCloud 
className="w-5 h-5 text-slate-500 group-hover:text-amber-400" />}
                    </div>
                    <div className="text-center">
                        <p className="text-xs font-bold text-slate-300">
                            {selectedFile ? selectedFile.name : 'Anexar comprovante/NF'}
                        </p>
                    </div>
                    {selectedFile && (
                        <button onClick={(e) => { e.preventDefault(); setSelectedFile(null); }} 
className="text-[10px] text-rose-400 font-bold hover:underline">Remover arquivo</button>
                    )}
                </div>
            </label>
        </div>

        <div className="pt-2">
            <button type="submit" disabled={loading}
              className="w-full py-3 bg-amber-600 text-white font-bold rounded-lg hover:bg-amber-500 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-4 h-4" />}
              Lançar Cobrança
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal: Solicitar Cancelamento ────────────────────────────────
function ModalCancelar({ cobranca, onClose, onSaved }) {
  const { addToast } = useToast();
  const [motivo, setMotivo] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!motivo.trim()) { addToast('Informe o motivo.', 'warning'); return; }
    setLoading(true);
    try {
      await apiFetch('/api/cobrancas-extras/solicitar-cancelamento', {
        method: 'POST',
        body: JSON.stringify({ grupo_id: cobranca.grupo_id, motivo: motivo.trim() })
      });
      addToast('Cancelamento solicitado ao emissor.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <h3 className="text-lg font-bold text-slate-200">Solicitar Cancelamento</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-slate-800 rounded-lg p-3 text-sm text-slate-300">
            <p className="font-bold text-slate-200 mb-1">{cobranca.descricao_base}</p>
            <p className="text-xs text-slate-400">As parcelas <strong>já emitidas</strong> permanecem. Apenas as parcelas futuras serão canceladas pelo emissor.</p>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Motivo do cancelamento</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Ex: Obra foi concluída antecipadamente..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 mt-1 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-600 resize-none" />
          </div>
          <button type="submit" disabled={loading}
            className="w-full py-3 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-500 transition-colors flex justify-center items-center gap-2 disabled:opacity-50">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <AlertCircle className="w-4 h-4" />}
            Solicitar ao Emissor
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────
export default function CobrancasExtrasPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const supabase = createClient();

  const [condominios, setCondominios] = useState([]);
  const [condoSel, setCondoSel] = useState('');
  const [cobrancas, setCobrancas] = useState([]);
  const [cancelamentos, setCancelamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalLancar, setModalLancar] = useState(false);
  const [modalCancelar, setModalCancelar] = useState(null);

  const podeLancar   = can(user?.role, 'edit_cobrancas_extras');
  const podeExecutar = user?.role === 'master' || user?.role === 'departamento';
  const podeSolicitar = user?.role === 'master' || user?.role === 'gerente';

  // Carrega condomínios
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('condominios').select('id, name').order('name');
      setCondominios(data || []);
      if (data?.length) setCondoSel(data[0].id);
    })();
  }, [supabase]);

  // Carrega cobranças e cancelamentos pendentes
  const carregar = useCallback(async () => {
    if (!condoSel) return;
    setLoading(true);
    try {
      const res = await apiFetch(`/api/cobrancas-extras/${condoSel}`);
      setCobrancas(res.cobrancas || []);

      if (podeExecutar) {
        const res2 = await apiFetch('/api/cobrancas-extras/cancelamentos-pendentes');
        setCancelamentos(res2.pendentes || []);
      }
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [condoSel, podeExecutar, addToast]);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleExecutarCancelamento(grupo_id) {
    try {
      await apiFetch('/api/cobrancas-extras/executar-cancelamento', {
        method: 'POST',
        body: JSON.stringify({ grupo_id })
      });
      addToast('Cobranças futuras canceladas!', 'success');
      carregar();
    } catch (err) {
      addToast(err.message, 'error');
    }
  }

  // Agrupa cobranças por grupo_id para exibição
  const grupos = cobrancas.reduce((acc, c) => {
    const gid = c.grupo_id || c.id;
    if (!acc[gid]) {
      acc[gid] = {
        grupo_id: gid,
        descricao_base: (c.description || c.descricao || '').split(' (')[0],
        parcela_total: c.parcela_total || 1,
        valor_parcela: c.amount || 0,
        status: c.status,
        motivo: c.motivo_cancelamento,
        attachments: c.attachments || [],
        parcelas: []
      };
    }
    acc[gid].parcelas.push(c);
    // se qualquer parcela está solicitada, marca o grupo
    if (c.status === 'solicitado_cancelamento') acc[gid].status = 'solicitado_cancelamento';
    return acc;
  }, {});

  const { mes: mesAtual, ano: anoAtual } = getMesAtual();

  return (
    <div className="animate-fade-in w-full space-y-6 pb-20">

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 glass-panel p-6 rounded-[2rem] border-white/5 shadow-xl">
        <div>
          <h2 className="text-xl font-black text-white uppercase tracking-tight">Cobranças Extras</h2>
          <p className="text-xs text-slate-400 mt-1">Lançamentos vinculados por mês — sem retroativo</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select value={condoSel} onChange={e => setCondoSel(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-200 outline-none focus:border-amber-500">
            {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {podeLancar && (
            <button onClick={() => setModalLancar(true)}
              className="bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-amber-500 transition-all shadow-[0_0_15px_rgba(217,119,6,0.3)]">
              <Plus className="w-4 h-4" /> Nova Cobrança
            </button>
          )}
        </div>
      </div>

      {/* Cancelamentos pendentes — só para Emissor/Master */}
      {podeExecutar && cancelamentos.length > 0 && (
        <div className="bg-rose-500/5 border border-rose-500/20 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-rose-500/10 flex items-center gap-2">
            <Clock className="w-4 h-4 text-rose-400" />
            <h3 className="text-sm font-bold text-rose-300">Cancelamentos aguardando sua aprovação ({cancelamentos.length})</h3>
          </div>
          <div className="divide-y divide-rose-500/10">
            {cancelamentos.map(c => (
              <div key={c.grupo_id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-slate-200">{c.descricao} — {c.condominio}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {c.parcelas_pendentes} parcela(s) de R$ {Number(c.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} • Motivo: <em>{c.motivo}</em>
                  </p>
                </div>
                <button onClick={() => handleExecutarCancelamento(c.grupo_id)}
                  className="px-4 py-2 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-500 transition-colors flex items-center gap-1 shrink-0">
                  <CheckCircle2 className="w-3 h-3" /> Cancelar parcelas
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lista de cobranças */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
      ) : Object.keys(grupos).length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-[2rem]">
          <Receipt className="w-12 h-12 mx-auto mb-3 text-slate-700" />
          <p className="text-slate-400 font-bold">Nenhuma cobrança extra lançada</p>
          <p className="text-slate-600 text-sm mt-1">Selecione um condomínio e clique em "Nova Cobrança"</p>
        </div>
      ) : (
        <div className="space-y-4">
          {Object.values(grupos).map(grupo => (
            <div key={grupo.grupo_id}
              className={`glass-panel rounded-2xl border overflow-hidden shadow-lg
                ${grupo.status === 'solicitado_cancelamento' ? 'border-rose-500/30' : 'border-white/5'}`}>
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                    ${grupo.parcela_total > 1 ? 'bg-violet-500/20' : 'bg-amber-500/20'}`}>
                    {grupo.parcela_total > 1
                      ? <Repeat className="w-5 h-5 text-violet-400" />
                      : <Receipt className="w-5 h-5 text-amber-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-200 truncate">{grupo.descricao_base}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {grupo.parcela_total > 1
                        ? `${grupo.parcela_total}x de R$ ${Number(grupo.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
                        : `R$ ${Number(grupo.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {grupo.attachments?.length > 0 && (
                    <a href={grupo.attachments[0]} target="_blank" rel="noreferrer"
                      className="text-slate-400 hover:text-cyan-400 transition-colors" title="Ver documento anexado">
                      <FileText className="w-4 h-4" />
                    </a>
                  )}
                  {grupo.status === 'solicitado_cancelamento' && (
                    <span className="text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-1 rounded">
                      Cancelamento solicitado
                    </span>
                  )}
                  {podeSolicitar && grupo.status === 'ativa' && (
                    <button onClick={() => setModalCancelar(grupo)}
                      className="text-slate-600 hover:text-rose-400 transition-colors" title="Solicitar cancelamento">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Parcelas */}
              {grupo.parcelas.length > 0 && (
                <div className="border-t border-white/5">
                  <div className="flex flex-wrap gap-2 px-5 py-3">
                    {grupo.parcelas.sort((a, b) => a.parcela_atual - b.parcela_atual).map(p => {
                      const bloq = isBloqueado(p.mes, p.ano);
                      const cancelado = p.status === 'solicitado_cancelamento' || p.status === 'cancelada';
                      return (
                        <span key={p.id}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded border
                            ${cancelado ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 line-through'
                              : bloq ? 'bg-slate-800 text-slate-500 border-slate-700'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                          {MESES[(p.mes || 1) - 1]}/{p.ano}
                          {p.parcela_total > 1 ? ` (${p.parcela_atual}/${p.parcela_total})` : ''}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalLancar && (
        <ModalLancar condominioId={condoSel} onClose={() => setModalLancar(false)} onSaved={carregar} />
      )}
      {modalCancelar && (
        <ModalCancelar cobranca={modalCancelar} onClose={() => setModalCancelar(null)} onSaved={carregar} />
      )}
    </div>
  );
}
