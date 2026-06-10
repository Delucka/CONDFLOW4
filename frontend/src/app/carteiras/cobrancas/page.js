'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { can } from '@/lib/roles';
import {
  Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2,
  Receipt, Calendar, Repeat, Building2, Clock, Lock,
  UploadCloud, FileText
} from 'lucide-react';

import { useLockedMonths } from '@/lib/useLockedMonths';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function getMesAtual() {
  const n = new Date();
  return { mes: n.getMonth() + 1, ano: n.getFullYear() };
}

// Lock por (condo, ano) é calculado no hook useLockedMonths; aqui mantemos só
// a verificação de "mês passou" para casos sem condo selecionado.
function isMesNoPassado(mes, ano) {
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
function ModalLancar({ condominioId, condominioNome, onClose, onSaved }) {
  const { addToast } = useToast();
  const { mes: mesAtual, ano: anoAtual } = getMesAtual();

  const [form, setForm] = useState({
    descricao: '',
    unidades: '',
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

  // Lock por mês para o condomínio + ano selecionados
  const { isLocked: isMesTravado } = useLockedMonths(condominioId, form.ano_inicio);

  // Lista de parcelas que vão cair em mês bloqueado
  const parcelasEmMesBloqueado = useMemo(() => {
    const arr = [];
    for (let i = 0; i < form.parcelas; i++) {
      let m = form.mes_inicio + i;
      let a = form.ano_inicio;
      while (m > 12) { m -= 12; a += 1; }
      if (a === form.ano_inicio && isMesTravado(m)) arr.push({ mes: m, ano: a });
      // Se cair em ano diferente, useLockedMonths não cobre — usa só "passado"
      else if (a !== form.ano_inicio && isMesNoPassado(m, a)) arr.push({ mes: m, ano: a });
    }
    return arr;
  }, [form.parcelas, form.mes_inicio, form.ano_inicio, isMesTravado]);

  // Meses disponíveis para INÍCIO: oculta bloqueados/emitidos/passados (nem aparecem)
  const mesesDisponiveis = useMemo(
    () => MESES.map((m, i) => ({ mes: i + 1, label: m }))
      .filter(({ mes }) => !(isMesTravado(mes) || isMesNoPassado(mes, form.ano_inicio))),
    [isMesTravado, form.ano_inicio]
  );
  // Se o mês inicial selecionado ficou indisponível, pula pro primeiro disponível
  useEffect(() => {
    if (mesesDisponiveis.length && !mesesDisponiveis.some(x => x.mes === form.mes_inicio)) {
      setForm(f => ({ ...f, mes_inicio: mesesDisponiveis[0].mes }));
    }
  }, [mesesDisponiveis, form.mes_inicio]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.unidades.trim()) {
      addToast('Informe a(s) unidade(s) do condomínio.', 'error');
      return;
    }
    if (parcelasEmMesBloqueado.length > 0) {
      addToast('Alguma parcela cai em mês bloqueado. Escolha outro mês inicial.', 'error');
      return;
    }
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
          unidades: form.unidades.trim(),
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold text-slate-800">Nova Cobrança Extra</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Condomínio (selecionado na página) */}
          <div className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
            <Building2 className="w-4 h-4 text-violet-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] text-violet-500 font-black uppercase tracking-widest leading-none">Condomínio</p>
              <p className="text-sm font-bold text-slate-800 truncate">{condominioNome || '—'}</p>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Descrição</label>
            <input required value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: Reforma portão eletrônico"
              className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-400" />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Unidade(s) <span className="text-rose-500">*</span></label>
            <input required value={form.unidades} onChange={e => setForm({ ...form, unidades: e.target.value })}
              placeholder="Ex: 101, 102, 203 — pode ser mais de uma"
              className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-400" />
            <p className="text-[10px] text-slate-400 mt-1">Informe a(s) unidade(s) a que esta cobrança se refere (separe por vírgula).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Valor Total (R$)</label>
              <input required value={form.valor_total}
                onChange={e => setForm({ ...form, valor_total: e.target.value })}
                placeholder="0,00"
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-400 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Parcelas</label>
              <select value={form.parcelas} onChange={e => setForm({ ...form, parcelas: Number(e.target.value) })}
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
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
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
                {mesesDisponiveis.length === 0 && <option value="">— sem meses disponíveis —</option>}
                {mesesDisponiveis.map(({ mes, label }) => (
                  <option key={mes} value={mes}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Ano</label>
              <select value={form.ano_inicio} onChange={e => setForm({ ...form, ano_inicio: Number(e.target.value) })}
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500">
                {anos.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Preview meses */}
          {form.parcelas > 1 && (
            <div className="bg-slate-100 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 font-bold uppercase mb-2">Parcelas agendadas:</p>
              <div className="flex flex-wrap gap-1">
                {Array.from({ length: form.parcelas }).map((_, i) => {
                  let m = form.mes_inicio + i;
                  let a = form.ano_inicio;
                  while (m > 12) { m -= 12; a += 1; }
                  const bloq = (a === form.ano_inicio && isMesTravado(m)) || (a !== form.ano_inicio && isMesNoPassado(m, a));
                  return (
                    <span key={i} className={`text-[10px] px-2 py-0.5 rounded border ${
                      bloq
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30 line-through'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {MESES[m-1]}/{a}{bloq ? ' 🔒' : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {parcelasEmMesBloqueado.length > 0 && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-xs text-rose-300 flex items-start gap-2">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{parcelasEmMesBloqueado.length} parcela{parcelasEmMesBloqueado.length !== 1 ? 's' : ''} cai{parcelasEmMesBloqueado.length === 1 ? '' : 'em'} em mês bloqueado. Ajuste o <strong>mês inicial</strong> ou reduza as parcelas.</span>
            </div>
          )}

          {/* Anexo de Documento */}
        <div className="pt-2">
            <label className="block text-center border-2 border-dashed border-slate-700 
hover:border-amber-500/50 rounded-xl p-4 cursor-pointer bg-slate-100/50 hover:bg-amber-500/5 transition-all group">
                <input type="file" className="hidden" onChange={(e) => setSelectedFile(e.target.files[0])} />
                <div className="flex flex-col items-center gap-2">
                    <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center 
group-hover:scale-110 transition-transform">
                        {selectedFile ? <FileText className="w-5 h-5 text-amber-400" /> : <UploadCloud 
className="w-5 h-5 text-slate-500 group-hover:text-amber-400" />}
                    </div>
                    <div className="text-center">
                        <p className="text-xs font-bold text-slate-700">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-400" />
            <h3 className="text-lg font-bold text-slate-800">Solicitar Cancelamento</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-slate-100 rounded-lg p-3 text-sm text-slate-700">
            <p className="font-bold text-slate-800 mb-1">{cobranca.descricao_base}</p>
            <p className="text-xs text-slate-400">As parcelas <strong>já emitidas</strong> permanecem. Apenas as parcelas futuras serão canceladas pelo emissor.</p>
          </div>
          <div>
            <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Motivo do cancelamento</label>
            <textarea value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
              placeholder="Ex: Obra foi concluída antecipadamente..."
              className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-400 resize-none" />
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
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const supabase = createClient();

  const [condominios, setCondominios] = useState([]);
  const [condoSel, setCondoSel] = useState('');
  const [cobrancas, setCobrancas] = useState([]);
  const [cancelamentos, setCancelamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalLancar, setModalLancar] = useState(false);
  const [modalCancelar, setModalCancelar] = useState(null);
  const [search, setSearch] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos'); // 'todos' | 'ativa' | 'cancelamento'
  const [loadingCondos, setLoadingCondos] = useState(true);

  const role = profile?.role || user?.role;
  const podeLancar   = can(role, 'edit_cobrancas_extras');
  const podeExecutar = role === 'master' || role === 'departamento';
  const podeSolicitar = role === 'master' || role === 'gerente';

  // Carrega condomínios filtrados por carteira (gerente/assistente)
  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      setLoadingCondos(true);
      try {
        if (role === 'gerente') {
          const { data: g } = await supabase.from('gerentes').select('id').eq('profile_id', profile.id).maybeSingle();
          if (!g?.id) { setCondominios([]); setLoadingCondos(false); return; }
          const { data } = await supabase.from('condominios').select('id, name').eq('gerente_id', g.id).order('name');
          setCondominios(data || []);
          if (data?.length) setCondoSel(data[0].id);
        } else if (role === 'assistente') {
          // assistente: gerentes onde a coluna 'assistente' (texto) bate com o full_name do profile
          const { data: gers } = await supabase.from('gerentes').select('id, assistente').not('assistente', 'is', null);
          const fullName = (profile.full_name || '').trim().toLowerCase();
          const gIds = (gers || []).filter(g => (g.assistente || '').trim().toLowerCase() === fullName).map(g => g.id);
          if (gIds.length === 0) { setCondominios([]); setLoadingCondos(false); return; }
          const { data } = await supabase.from('condominios').select('id, name').in('gerente_id', gIds).order('name');
          setCondominios(data || []);
          if (data?.length) setCondoSel(data[0].id);
        } else {
          // master / supervisores / departamento: veem todos
          const { data } = await supabase.from('condominios').select('id, name').order('name');
          setCondominios(data || []);
          if (data?.length) setCondoSel(data[0].id);
        }
      } finally {
        setLoadingCondos(false);
      }
    })();
  }, [supabase, profile?.id, profile?.full_name, role]);

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

  // Stats
  const condoNome = condominios.find(c => c.id === condoSel)?.name || '';

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

  // Stats agregadas
  const todosGrupos = Object.values(grupos);
  const stats = useMemo(() => {
    const ativas = todosGrupos.filter(g => g.status !== 'solicitado_cancelamento');
    const cancel = todosGrupos.filter(g => g.status === 'solicitado_cancelamento');
    const valorTotal = ativas.reduce((s, g) => {
      const parcelasAtivas = (g.parcelas || []).filter(p => p.status !== 'cancelada' && p.status !== 'solicitado_cancelamento');
      return s + parcelasAtivas.reduce((sp, p) => sp + Number(p.amount || g.valor_parcela || 0), 0);
    }, 0);
    return { ativas: ativas.length, cancel: cancel.length, total: todosGrupos.length, valorTotal };
  }, [todosGrupos]);

  // Filtros aplicados
  const gruposFiltrados = useMemo(() => {
    let list = todosGrupos;
    if (filtroStatus === 'ativa') list = list.filter(g => g.status !== 'solicitado_cancelamento');
    else if (filtroStatus === 'cancelamento') list = list.filter(g => g.status === 'solicitado_cancelamento');
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(g => (g.descricao_base || '').toLowerCase().includes(s));
    }
    return list;
  }, [todosGrupos, filtroStatus, search]);

  return (
    <div className="animate-fade-in w-full space-y-6 pb-20">

      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 glass-panel p-6 rounded-[2rem] border-slate-200 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Receipt className="w-7 h-7 text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Cobranças Extras</h2>
            <p className="text-xs text-slate-400 mt-1">
              {role === 'gerente' ? 'Sua carteira' : role === 'assistente' ? 'Carteira do seu gerente' : 'Todos os condomínios'} · Lançamentos vinculados por mês
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {condominios.length === 0 ? (
            <span className="text-xs text-slate-500 italic">
              {loadingCondos ? 'Carregando carteira...' : 'Nenhum condomínio na sua carteira'}
            </span>
          ) : (
            <select value={condoSel} onChange={e => setCondoSel(e.target.value)}
              className="bg-slate-100 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-800 outline-none focus:border-amber-500 min-w-[260px]">
              {condominios.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {podeLancar && condominios.length > 0 && (
            <button onClick={() => setModalLancar(true)}
              className="bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-amber-500 transition-all ">
              <Plus className="w-4 h-4" /> Nova Cobrança
            </button>
          )}
        </div>
      </div>

      {/* Stats cards (só quando tem condo + cobrancas) */}
      {condoSel && todosGrupos.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="glass-panel p-4 rounded-2xl border border-slate-200">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Total</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{stats.total}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">cobrança{stats.total !== 1 ? 's' : ''}</p>
          </div>
          <div className="glass-panel p-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Ativas</p>
            <p className="text-2xl font-black text-emerald-300 mt-1">{stats.ativas}</p>
            <p className="text-[10px] text-emerald-500/70 mt-0.5">em vigor</p>
          </div>
          <div className="glass-panel p-4 rounded-2xl border border-rose-500/20 bg-rose-500/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-400">Aguardando cancel.</p>
            <p className="text-2xl font-black text-rose-300 mt-1">{stats.cancel}</p>
            <p className="text-[10px] text-rose-500/70 mt-0.5">pendentes</p>
          </div>
          <div className="glass-panel p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Valor estimado</p>
            <p className="text-xl font-black text-amber-300 mt-1 truncate">R$ {stats.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            <p className="text-[10px] text-amber-500/70 mt-0.5">parcelas restantes</p>
          </div>
        </div>
      )}

      {/* Toolbar (busca + filtro de status) */}
      {condoSel && todosGrupos.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Pesquisar descrição..."
              className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-500/50 placeholder-slate-400" />
          </div>
          <div className="flex gap-1 bg-slate-50 p-1 rounded-xl border border-slate-200">
            {[
              { id: 'todos',        label: 'Todas' },
              { id: 'ativa',        label: 'Ativas' },
              { id: 'cancelamento', label: 'Em cancelamento' },
            ].map(opt => (
              <button key={opt.id} onClick={() => setFiltroStatus(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                  filtroStatus === opt.id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-900'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
                  <p className="text-sm font-bold text-slate-800">{c.descricao} — {c.condominio}</p>
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
      ) : !condoSel ? (
        <div className="text-center py-20 glass-panel rounded-[2rem]">
          <Building2 className="w-12 h-12 mx-auto mb-3 text-slate-700" />
          <p className="text-slate-400 font-bold">Nenhum condomínio na sua carteira</p>
          <p className="text-slate-600 text-sm mt-1">Fale com o master pra ser atribuído a um condomínio.</p>
        </div>
      ) : todosGrupos.length === 0 ? (
        <div className="text-center py-20 glass-panel rounded-[2rem]">
          <Receipt className="w-12 h-12 mx-auto mb-3 text-slate-700" />
          <p className="text-slate-400 font-bold">Nenhuma cobrança extra lançada</p>
          <p className="text-slate-600 text-sm mt-1">Clique em &quot;Nova Cobrança&quot; pra começar.</p>
        </div>
      ) : gruposFiltrados.length === 0 ? (
        <div className="text-center py-12 glass-panel rounded-[2rem]">
          <p className="text-slate-400 font-bold">Nada encontrado com esses filtros</p>
          <p className="text-slate-600 text-sm mt-1">Limpe a busca ou troque o filtro de status.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {gruposFiltrados.map(grupo => (
            <div key={grupo.grupo_id}
              className={`glass-panel rounded-2xl border overflow-hidden shadow-lg
                ${grupo.status === 'solicitado_cancelamento' ? 'border-rose-500/30' : 'border-slate-200'}`}>
              <div className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                    ${grupo.parcela_total > 1 ? 'bg-violet-500/20' : 'bg-amber-500/20'}`}>
                    {grupo.parcela_total > 1
                      ? <Repeat className="w-5 h-5 text-violet-400" />
                      : <Receipt className="w-5 h-5 text-amber-400" />}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800 truncate">{grupo.descricao_base}</p>
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
                      className="text-slate-400 hover:text-violet-400 transition-colors" title="Ver documento anexado">
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
                <div className="border-t border-slate-200">
                  <div className="flex flex-wrap gap-2 px-5 py-3">
                    {grupo.parcelas.sort((a, b) => a.parcela_atual - b.parcela_atual).map(p => {
                      const bloq = isMesNoPassado(p.mes, p.ano);
                      const cancelado = p.status === 'solicitado_cancelamento' || p.status === 'cancelada';
                      const processada = p.status === 'processada';
                      return (
                        <span key={p.id}
                          className={`text-[10px] font-bold px-2.5 py-1 rounded border
                            ${cancelado ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 line-through'
                              : processada ? 'bg-violet-500/10 text-violet-400 border-violet-500/20'
                              : bloq ? 'bg-slate-100 text-slate-500 border-slate-700'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}`}>
                          {MESES[(p.mes || 1) - 1]}/{p.ano}
                          {p.parcela_total > 1 ? ` (${p.parcela_atual}/${p.parcela_total})` : ''}
                          {processada && ' ✓'}
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
        <ModalLancar condominioId={condoSel} condominioNome={condoNome} onClose={() => setModalLancar(false)} onSaved={carregar} />
      )}
      {modalCancelar && (
        <ModalCancelar cobranca={modalCancelar} onClose={() => setModalCancelar(null)} onSaved={carregar} />
      )}
    </div>
  );
}
