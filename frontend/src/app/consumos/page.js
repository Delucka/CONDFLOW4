'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { createClient } from '@/utils/supabase/client';
import {
  Droplet, Building2, Plus, Upload, Loader2, X, FileText, Trash2,
  CheckCircle2, Clock, AlertTriangle, Copy, Pencil, Search, ExternalLink, RefreshCw,
} from 'lucide-react';

const MESES = ['', 'Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const MESES_LONG = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CONCESSIONARIAS = ['SABESP', 'COMGAS', 'ENEL', 'Outra'];

function fmtBRL(v) {
  if (v == null || v === '') return '—';
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(s) {
  if (!s) return '—';
  try { return new Date(s + 'T12:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
}

async function sha256OfFile(file) {
  const buf = await file.arrayBuffer();
  const hashBuf = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Modal Upload / Editar ──────────────────────────────────────────
function ModalFatura({ condoId, condoNome, fatura, preFatura, onClose, onSaved, profile }) {
  const { addToast } = useToast();
  const isEdicao = !!fatura?.id;
  const supabase = useMemo(() => createClient(), []);

  const podeEditarFinal = ['master', 'departamento'].includes(profile?.role);

  const initialConc = fatura?.concessionaria || preFatura?.concessionaria || 'SABESP';
  const [form, setForm] = useState({
    concessionaria: CONCESSIONARIAS.includes(initialConc) ? initialConc : 'Outra',
    concessionaria_outra: CONCESSIONARIAS.includes(initialConc) ? '' : initialConc,
    mes_referencia: fatura?.mes_referencia || preFatura?.mes_referencia || (new Date().getMonth() + 1),
    ano_referencia: fatura?.ano_referencia || preFatura?.ano_referencia || new Date().getFullYear(),
    leitura_atual: fatura?.leitura_atual || '',
    proxima_leitura: fatura?.proxima_leitura || '',
    vencimento: fatura?.vencimento || '',
    valor: fatura?.valor || '',
    descricao: fatura?.descricao || '',
    marcada_repetida: !!fatura?.marcada_repetida,
  });
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [duplicatas, setDuplicatas] = useState([]);
  const [checking, setChecking] = useState(false);

  async function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setChecking(true);
    try {
      const hash = await sha256OfFile(f);
      const res = await apiFetch(`/api/consumos/check-duplicata?arquivo_hash=${hash}${condoId ? `&condominio_id=${condoId}` : ''}`);
      setDuplicatas(res?.duplicatas || []);
    } catch {
      setDuplicatas([]);
    } finally {
      setChecking(false);
    }
  }

  async function uploadArquivo() {
    if (!file) return { arquivo_url: fatura?.arquivo_url || null, arquivo_nome: fatura?.arquivo_nome || null, arquivo_hash: fatura?.arquivo_hash || null };
    const hash = await sha256OfFile(file);
    const path = `consumos/${condoId}/${form.ano_referencia}/${String(form.mes_referencia).padStart(2,'0')}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('emissoes').upload(path, file);
    if (error) throw error;
    return { arquivo_url: path, arquivo_nome: file.name, arquivo_hash: hash };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.concessionaria) return addToast('Escolha uma concessionária', 'error');
    if (form.concessionaria === 'Outra' && !form.concessionaria_outra.trim())
      return addToast('Informe o nome da concessionária', 'error');
    setLoading(true);
    try {
      const arq = await uploadArquivo();
      const concName = form.concessionaria === 'Outra' ? form.concessionaria_outra.trim().toUpperCase() : form.concessionaria;
      const payload = {
        condominio_id: condoId,
        mes_referencia: Number(form.mes_referencia),
        ano_referencia: Number(form.ano_referencia),
        concessionaria: concName,
        leitura_atual: form.leitura_atual || null,
        proxima_leitura: form.proxima_leitura || null,
        vencimento: form.vencimento || null,
        valor: form.valor ? parseFloat(String(form.valor).replace(/\./g, '').replace(',', '.')) : null,
        descricao: form.descricao || null,
        marcada_repetida: !!form.marcada_repetida,
        ...arq,
      };
      if (isEdicao) {
        await apiFetch(`/api/consumos/${fatura.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        addToast('Fatura atualizada!', 'success');
      } else {
        await apiPost('/api/consumos', payload);
        addToast('Fatura enviada!', 'success');
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      addToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900 z-10">
          <div className="flex items-center gap-3">
            <Droplet className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="text-lg font-bold text-white">{isEdicao ? 'Editar fatura' : 'Nova fatura de consumo'}</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">{condoNome}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Concessionária + período */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Concessionária</label>
              <select value={form.concessionaria} onChange={e => setForm({...form, concessionaria: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
                {CONCESSIONARIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {form.concessionaria === 'Outra' && (
                <input value={form.concessionaria_outra} onChange={e => setForm({...form, concessionaria_outra: e.target.value})}
                  placeholder="Ex: VIVO, GO TELECOM..."
                  className="w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
              )}
            </div>
            <div className="md:col-span-4">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Mês de referência</label>
              <select value={form.mes_referencia} onChange={e => setForm({...form, mes_referencia: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500">
                {Array.from({length:12},(_,i)=>i+1).map(m => <option key={m} value={m}>{MESES_LONG[m]}</option>)}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ano</label>
              <input type="number" value={form.ano_referencia} onChange={e => setForm({...form, ano_referencia: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
            </div>
          </div>

          {/* Datas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Leitura atual</label>
              <input type="date" value={form.leitura_atual} onChange={e => setForm({...form, leitura_atual: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Próxima leitura</label>
              <input type="date" value={form.proxima_leitura} onChange={e => setForm({...form, proxima_leitura: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Vencimento</label>
              <input type="date" value={form.vencimento} onChange={e => setForm({...form, vencimento: e.target.value})}
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
            </div>
          </div>

          {/* Valor + descrição */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Valor (R$)</label>
              <input value={form.valor} onChange={e => setForm({...form, valor: e.target.value})} placeholder="0,00"
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 font-mono text-right" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Descrição (opcional)</label>
              <input value={form.descricao} onChange={e => setForm({...form, descricao: e.target.value})}
                placeholder="Anotações sobre essa fatura"
                className="w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500" />
            </div>
          </div>

          {/* Arquivo */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PDF da fatura {isEdicao && '(opcional — só se quiser substituir)'}</label>
            <input type="file" accept="application/pdf,image/*" onChange={handleFileChange}
              className="mt-1 block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-bold file:bg-cyan-500/10 file:text-cyan-300 hover:file:bg-cyan-500/20" />
            {checking && <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Verificando se já existe...</p>}
            {duplicatas.length > 0 && (
              <div className="mt-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                <p className="text-[11px] font-bold text-amber-300 mb-1 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Arquivo idêntico já enviado:</p>
                <ul className="text-[11px] text-amber-200/80 list-disc pl-5">
                  {duplicatas.slice(0, 3).map(d => (
                    <li key={d.id}>{d.condominios?.name} · {d.concessionaria} · {String(d.mes_referencia).padStart(2,'0')}/{d.ano_referencia}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Flag conta repetida */}
          <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg bg-slate-800/50 border border-slate-700">
            <input type="checkbox" checked={!!form.marcada_repetida} onChange={e => setForm({...form, marcada_repetida: e.target.checked})}
              className="w-4 h-4 accent-amber-500" />
            <div>
              <p className="text-sm font-bold text-slate-200">Marcar como conta repetida</p>
              <p className="text-[10px] text-slate-500">Use quando esta fatura é a mesma cobrança de outro mês (sistema também detecta por hash do PDF).</p>
            </div>
          </label>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700">Cancelar</button>
            <button type="submit" disabled={loading} className="px-5 py-2 rounded-lg text-sm font-bold bg-cyan-600 text-white hover:bg-cyan-500 disabled:opacity-50 flex items-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {isEdicao ? 'Salvar' : 'Enviar fatura'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Card de fatura ─────────────────────────────────────────────────
function FaturaCard({ fatura, onEdit, onDuplicar, onAnexar, onDelete, onAbrir, profile }) {
  const isAnexada = fatura.status === 'anexada';
  const podeEditar = ['master', 'departamento', 'assistente'].includes(profile?.role);
  const podeAnexar = ['master', 'departamento'].includes(profile?.role);
  const podeDeletar = ['master', 'departamento'].includes(profile?.role);
  const podeDuplicar = ['master', 'departamento', 'assistente'].includes(profile?.role);

  return (
    <div className={`rounded-xl border p-4 ${isAnexada ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${
            isAnexada ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
          }`}>
            {fatura.concessionaria}
          </span>
          {fatura.marcada_repetida && (
            <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 flex items-center gap-1">
              <RefreshCw className="w-2.5 h-2.5" /> Repetida
            </span>
          )}
          {isAnexada ? (
            <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Anexada</span>
          ) : (
            <span className="text-[9px] font-bold text-amber-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Pendente</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] mb-3">
        <div><span className="text-slate-500">Leitura atual:</span> <span className="text-slate-200 font-mono">{fmtDate(fatura.leitura_atual)}</span></div>
        <div><span className="text-slate-500">Próxima:</span> <span className="text-slate-200 font-mono">{fmtDate(fatura.proxima_leitura)}</span></div>
        <div><span className="text-slate-500">Vencimento:</span> <span className="text-slate-200 font-mono">{fmtDate(fatura.vencimento)}</span></div>
        <div><span className="text-slate-500">Valor:</span> <span className="text-white font-mono font-bold">R$ {fmtBRL(fatura.valor)}</span></div>
      </div>

      {fatura.descricao && (
        <p className="text-[11px] text-slate-400 italic mb-3 truncate" title={fatura.descricao}>“{fatura.descricao}”</p>
      )}

      <div className="flex items-center gap-1 pt-2 border-t border-white/5">
        {fatura.arquivo_url && (
          <button onClick={() => onAbrir(fatura)} className="p-2 rounded-lg hover:bg-cyan-500/10 text-cyan-400" title="Abrir PDF">
            <FileText className="w-3.5 h-3.5" />
          </button>
        )}
        {podeEditar && (
          <button onClick={() => onEdit(fatura)} className="p-2 rounded-lg hover:bg-white/5 text-slate-400" title="Editar">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
        {podeDuplicar && (
          <button onClick={() => onDuplicar(fatura)} className="p-2 rounded-lg hover:bg-violet-500/10 text-violet-400" title="Duplicar para próximo mês">
            <Copy className="w-3.5 h-3.5" />
          </button>
        )}
        {!isAnexada && podeAnexar && (
          <button onClick={() => onAnexar(fatura)} className="ml-auto px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-black uppercase tracking-widest">
            Anexar (final)
          </button>
        )}
        {podeDeletar && (
          <button onClick={() => onDelete(fatura)} className="p-2 rounded-lg hover:bg-rose-500/10 text-rose-400 ml-auto" title="Excluir">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Página Principal ──────────────────────────────────────────────
export default function ConsumosPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const role = profile?.role;

  const podeAdicionar = ['master', 'departamento', 'assistente'].includes(role);

  // Lista de condos (cadastrados em condominios_concessionarias OU com fatura)
  const { data: condosData, mutate: mutateCondos } = useSWR('/api/consumos/condominios-com-faturas', apiFetcher);
  const condosComFaturas = condosData?.condominios || [];

  // Para master/emissor: lista completa de condos pra escolher "novo condo"
  const [todosCondos, setTodosCondos] = useState([]);
  useEffect(() => {
    if (!podeAdicionar) return;
    (async () => {
      const { data } = await supabase.from('condominios').select('id, name').order('name');
      setTodosCondos(data || []);
    })();
  }, [supabase, podeAdicionar]);

  const [condoSel, setCondoSel] = useState('');
  const [anoSel, setAnoSel] = useState(new Date().getFullYear());
  const [search, setSearch] = useState('');
  const [filtroConc, setFiltroConc] = useState('todas'); // todas | SABESP | COMGAS | ENEL | outra
  const [filtroGerente, setFiltroGerente] = useState('todos');
  const [ordenacao, setOrdenacao] = useState('codigo'); // codigo | nome | vencimento | gerente
  const [showNovaModal, setShowNovaModal] = useState(false);
  const [showAddCondoModal, setShowAddCondoModal] = useState(false);
  const [editFatura, setEditFatura] = useState(null);
  // Pré-seleciona condo+concessionaria+mes ao abrir Nova fatura via clique numa celula vazia
  const [preFatura, setPreFatura] = useState(null);

  // Faturas do ano (para a matriz)
  const { data: matrizData, mutate: mutateMatriz } = useSWR(
    `/api/consumos?ano=${anoSel}`, apiFetcher, { revalidateOnFocus: false }
  );
  const todasFaturas = matrizData?.consumos || [];

  // Map: chave `${condo}|${conc}|${mes}` => fatura
  const matrizMap = useMemo(() => {
    const m = {};
    todasFaturas.forEach(f => {
      m[`${f.condominio_id}|${f.concessionaria}|${f.mes_referencia}`] = f;
    });
    return m;
  }, [todasFaturas]);

  // Auto-seleciona o primeiro condo da lista
  useEffect(() => {
    if (!condoSel && condosComFaturas.length > 0) setCondoSel(condosComFaturas[0].id);
  }, [condosComFaturas, condoSel]);

  const condoNomeSel = condosComFaturas.find(c => c.id === condoSel)?.name
                    || todosCondos.find(c => c.id === condoSel)?.name
                    || '';

  // Lista de gerentes que aparecem (pra filtro)
  const gerentesDisponiveis = useMemo(() => {
    const set = new Set();
    condosComFaturas.forEach(c => { if (c.gerente_nome) set.add(c.gerente_nome); });
    return Array.from(set).sort();
  }, [condosComFaturas]);

  // Faturas do condo selecionado
  const { data: faturasData, mutate: mutateFaturas, isLoading: loadingFaturas } =
    useSWR(condoSel ? `/api/consumos?condominio_id=${condoSel}` : null, apiFetcher);
  const faturas = faturasData?.consumos || [];

  // Agrupado por (ano, mes)
  const grupos = useMemo(() => {
    const map = {};
    for (const f of faturas) {
      const key = `${f.ano_referencia}-${String(f.mes_referencia).padStart(2,'0')}`;
      if (!map[key]) map[key] = { ano: f.ano_referencia, mes: f.mes_referencia, faturas: [] };
      map[key].faturas.push(f);
    }
    const arr = Object.values(map).sort((a,b) => (b.ano - a.ano) || (b.mes - a.mes));
    if (search.trim()) {
      const s = search.toLowerCase();
      return arr.filter(g => g.faturas.some(f =>
        (f.concessionaria || '').toLowerCase().includes(s) ||
        (f.descricao || '').toLowerCase().includes(s) ||
        `${MESES[f.mes_referencia]}/${f.ano_referencia}`.toLowerCase().includes(s)
      ));
    }
    return arr;
  }, [faturas, search]);

  const condosFiltrados = useMemo(() => {
    let list = [...condosComFaturas];
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(c =>
        (c.name || '').toLowerCase().includes(s) ||
        (c.gerente_nome || '').toLowerCase().includes(s) ||
        (c.concessionarias || []).some(x => x.toLowerCase().includes(s))
      );
    }
    if (filtroConc !== 'todas') {
      list = list.filter(c => (c.concessionarias || []).includes(filtroConc));
    }
    if (filtroGerente !== 'todos') {
      list = list.filter(c => c.gerente_nome === filtroGerente);
    }
    if (ordenacao === 'nome') list.sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    else if (ordenacao === 'vencimento') list.sort((a,b) => (a.due_day || 99) - (b.due_day || 99));
    else if (ordenacao === 'gerente') list.sort((a,b) => (a.gerente_nome || 'zz').localeCompare(b.gerente_nome || 'zz'));
    else list.sort((a,b) => (a.codigo || 9999) - (b.codigo || 9999));
    return list;
  }, [condosComFaturas, search, filtroConc, filtroGerente, ordenacao]);

  async function handleDuplicar(fatura) {
    try {
      await apiPost(`/api/consumos/${fatura.id}/duplicar`, {});
      addToast(`Duplicada para ${MESES_LONG[fatura.mes_referencia === 12 ? 1 : fatura.mes_referencia + 1]}`, 'success');
      mutateFaturas();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }
  async function handleAnexar(fatura) {
    try {
      await apiPost(`/api/consumos/${fatura.id}/anexar`, {});
      addToast('Fatura anexada como final!', 'success');
      mutateFaturas();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }
  async function handleDelete(fatura) {
    if (!confirm(`Excluir fatura ${fatura.concessionaria} de ${MESES[fatura.mes_referencia]}/${fatura.ano_referencia}?`)) return;
    try {
      await apiFetch(`/api/consumos/${fatura.id}`, { method: 'DELETE' });
      addToast('Fatura excluída', 'success');
      mutateFaturas();
      mutateCondos();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }
  async function handleAbrir(fatura) {
    if (!fatura.arquivo_url) return;
    const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(fatura.arquivo_url, 300);
    if (error) return addToast('Erro ao abrir arquivo', 'error');
    window.open(data.signedUrl, '_blank');
  }
  function handleSaved() {
    mutateFaturas?.();
    mutateCondos?.();
    mutateMatriz?.();
  }

  return (
    <div className="animate-fade-in w-full space-y-6 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 glass-panel p-6 rounded-[2rem] border-white/5 shadow-xl">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center shrink-0">
            <Droplet className="w-7 h-7 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">Consumos</h2>
            <p className="text-xs text-slate-400 mt-1">Faturas de SABESP, COMGAS, ENEL e outras concessionárias · por condomínio e mês</p>
          </div>
        </div>
        {podeAdicionar && (
          <div className="flex gap-2">
            {condoSel && (
              <button onClick={() => { setEditFatura(null); setShowNovaModal(true); }}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold flex items-center gap-2 shadow-lg shadow-cyan-500/20">
                <Plus className="w-4 h-4" /> Nova fatura
              </button>
            )}
            <button onClick={() => setShowAddCondoModal(true)}
              className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white text-sm font-bold flex items-center gap-2">
              <Building2 className="w-4 h-4" /> Adicionar condomínio
            </button>
          </div>
        )}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar nome, gerente ou concessionária..."
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl pl-10 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600" />
        </div>
        <select value={filtroConc} onChange={e => setFiltroConc(e.target.value)}
          className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
          <option value="todas">Todas concessionárias</option>
          <option value="SABESP">SABESP</option>
          <option value="COMGAS">COMGAS</option>
          <option value="ENEL">ENEL</option>
        </select>
        <select value={filtroGerente} onChange={e => setFiltroGerente(e.target.value)}
          className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50 max-w-[200px]">
          <option value="todos">Todos os gerentes</option>
          {gerentesDisponiveis.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={ordenacao} onChange={e => setOrdenacao(e.target.value)}
          className="bg-slate-900/60 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50">
          <option value="codigo">Ordenar: Código</option>
          <option value="nome">Ordenar: Nome</option>
          <option value="vencimento">Ordenar: Vencimento</option>
          <option value="gerente">Ordenar: Gerente</option>
        </select>
        <select value={anoSel} onChange={e => setAnoSel(Number(e.target.value))}
          className="bg-slate-900/60 border border-cyan-500/30 rounded-xl px-3 py-2 text-sm text-cyan-300 font-bold outline-none">
          {[anoSel-1, anoSel, anoSel+1].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {/* Matriz mensal */}
      <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Matriz {anoSel} · {condosFiltrados.length} de {condosComFaturas.length} condomínios
          </p>
          <p className="text-[10px] text-slate-500">Clique numa célula para abrir/criar a fatura do mês</p>
        </div>
        <div className="overflow-auto max-h-[75vh]">
          {condosFiltrados.length === 0 ? (
            <p className="text-xs text-slate-500 px-4 py-12 text-center">Nada encontrado com esses filtros.</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-950/95 backdrop-blur z-10">
                <tr>
                  <th className="text-left px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 sticky left-0 bg-slate-950/95 z-20 min-w-[220px]">Condomínio</th>
                  <th className="text-center px-2 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 min-w-[50px]">Venc</th>
                  <th className="text-left px-2 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 min-w-[120px]">Gerente</th>
                  <th className="text-left px-2 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 min-w-[80px]">Conta</th>
                  {Array.from({length:12}, (_,i)=>i+1).map(m => (
                    <th key={m} className="text-center px-1 py-2 text-[9px] font-black uppercase tracking-widest text-slate-500 min-w-[60px]">{MESES[m]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {condosFiltrados.flatMap(c => {
                  const concs = (c.concessionarias || []);
                  if (concs.length === 0) return [];
                  return concs.map((conc, idx) => (
                    <tr key={`${c.id}-${conc}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                      {idx === 0 ? (
                        <>
                          <td rowSpan={concs.length} className="px-3 py-2 align-top font-bold text-slate-200 sticky left-0 bg-slate-950/60 backdrop-blur z-10 truncate max-w-[220px] border-r border-white/5" title={c.name}>
                            {c.name}
                          </td>
                          <td rowSpan={concs.length} className="text-center px-2 py-2 align-top text-slate-400 font-mono border-r border-white/5">{c.due_day || '—'}</td>
                          <td rowSpan={concs.length} className="px-2 py-2 align-top text-slate-400 truncate max-w-[120px] border-r border-white/5" title={c.gerente_nome || '—'}>{c.gerente_nome || '—'}</td>
                        </>
                      ) : null}
                      <td className={`px-2 py-2 font-black text-[10px] uppercase tracking-widest border-r border-white/5 ${
                        conc === 'SABESP' ? 'text-cyan-400'
                        : conc === 'COMGAS' ? 'text-amber-400'
                        : conc === 'ENEL' ? 'text-rose-400'
                        : 'text-slate-400'
                      }`}>{conc}</td>
                      {Array.from({length:12}, (_,i)=>i+1).map(m => {
                        const f = matrizMap[`${c.id}|${conc}|${m}`];
                        const isAnexada = f?.status === 'anexada';
                        return (
                          <td key={m} className="p-0.5 border-r border-white/5">
                            {f ? (
                              <button onClick={() => { setEditFatura(f); setCondoSel(c.id); setShowNovaModal(true); }}
                                className={`w-full h-full px-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                                  isAnexada
                                    ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                                    : 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                                }`}
                                title={`${f.concessionaria} ${MESES[m]}/${anoSel} · ${isAnexada ? 'Anexada' : 'Pendente'}${f.valor != null ? ' · R$ '+fmtBRL(f.valor) : ''}`}>
                                {f.valor != null ? `R$ ${fmtBRL(f.valor)}` : (isAnexada ? '✓' : '·')}
                              </button>
                            ) : (
                              <button onClick={() => {
                                  setCondoSel(c.id);
                                  setPreFatura({ concessionaria: conc, mes_referencia: m, ano_referencia: anoSel });
                                  setEditFatura(null);
                                  setShowNovaModal(true);
                                }}
                                className="w-full h-full px-1 py-1.5 rounded text-[10px] text-slate-600 hover:text-cyan-400 hover:bg-cyan-500/5 transition-all border border-transparent hover:border-cyan-500/20"
                                title={`Adicionar fatura ${conc} ${MESES[m]}/${anoSel}`}>
                                +
                              </button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modal Nova/Edit */}
      {showNovaModal && condoSel && (
        <ModalFatura
          condoId={condoSel}
          condoNome={condoNomeSel}
          fatura={editFatura}
          preFatura={preFatura}
          profile={profile}
          onClose={() => { setShowNovaModal(false); setEditFatura(null); setPreFatura(null); }}
          onSaved={handleSaved}
        />
      )}

      {/* Modal escolher condo (pra criar fatura num condo que nao tem nenhuma ainda) */}
      {showAddCondoModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">Escolher condomínio</h3>
              <button onClick={() => setShowAddCondoModal(false)} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
              {todosCondos.length === 0 ? (
                <p className="text-sm text-slate-400">Carregando...</p>
              ) : (
                todosCondos.map(c => (
                  <button key={c.id} onClick={() => {
                      setCondoSel(c.id);
                      setShowAddCondoModal(false);
                      setEditFatura(null);
                      setShowNovaModal(true);
                    }}
                    className="w-full text-left px-4 py-3 rounded-xl bg-slate-800 hover:bg-cyan-500/10 hover:border-cyan-500/30 border border-slate-700 text-sm text-slate-200">
                    {c.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
