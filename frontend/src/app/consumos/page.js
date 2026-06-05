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
function tempoRelativo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return '';
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
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
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">PDF da fatura {isEdicao && fatura?.arquivo_url && '(opcional — só se quiser substituir)'}</label>
            {/* Botão abrir PDF atual se existir */}
            {isEdicao && fatura?.arquivo_url && (
              <button type="button"
                onClick={async () => {
                  const { data, error } = await supabase.storage.from('emissoes').createSignedUrl(fatura.arquivo_url, 300);
                  if (error) return addToast('Erro ao abrir PDF', 'error');
                  window.open(data.signedUrl, '_blank');
                }}
                className="mt-1 mb-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-bold hover:bg-cyan-500/20 transition-colors">
                <FileText className="w-4 h-4" /> Abrir PDF atual ({fatura.arquivo_nome || 'arquivo'})
                <ExternalLink className="w-3 h-3 ml-auto" />
              </button>
            )}
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
  // Modal de leitura por unidade (tabela extraída do relatório)
  const [unidadesModal, setUnidadesModal] = useState(null); // { nome, empresa, mes, servico, loading, unidades, erro }

  // Faturas do ano (para a matriz + dashboard) — polling 30s
  const { data: matrizData, mutate: mutateMatriz } = useSWR(
    `/api/consumos?ano=${anoSel}`, apiFetcher,
    { revalidateOnFocus: true, refreshInterval: 30000, dedupingInterval: 5000 }
  );
  const todasFaturas = matrizData?.consumos || [];

  // Relatórios de leitura do ano (Prosper/Outra) — direto do Supabase, polling 30s
  const [relatorios, setRelatorios] = useState([]);
  const fetchRelatorios = useCallback(async () => {
    const { data } = await supabase
      .from('consumos_relatorios_leitura')
      .select('*, condominios(name)')
      .eq('ano_referencia', anoSel);
    setRelatorios(data || []);
  }, [supabase, anoSel]);
  useEffect(() => {
    fetchRelatorios();
    const t = setInterval(fetchRelatorios, 30000);
    return () => clearInterval(t);
  }, [fetchRelatorios]);

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
    fetchRelatorios?.();
  }

  // Abre a tabela de leitura por unidade de um relatório (lê extracao_dados_brutos)
  async function abrirUnidades(item) {
    if (!item.origem) {
      addToast('Relatório sem dados de unidades (anexado antes da extração automática).', 'info');
      return;
    }
    setUnidadesModal({ nome: item.nome, empresa: item.empresa, mes: item.mes, servico: item.servico, loading: true, unidades: null });
    try {
      const { data, error } = await supabase
        .from('emissoes_arquivos')
        .select('extracao_dados_brutos')
        .eq('id', item.origem)
        .maybeSingle();
      if (error) throw error;
      const unidades = data?.extracao_dados_brutos?.unidades || null;
      setUnidadesModal(prev => prev && { ...prev, loading: false, unidades, erro: unidades ? null : 'Sem tabela de unidades neste relatório.' });
    } catch (e) {
      setUnidadesModal(prev => prev && { ...prev, loading: false, erro: e.message || 'Erro ao carregar' });
    }
  }

  // ─── Dashboard: stats, alertas e feed (faturas + relatórios) ───────
  const relatoriosMap = useMemo(() => {
    const m = {};
    relatorios.forEach(r => { m[`${r.condominio_id}|${r.empresa_leitura}|${r.tipo_servico}|${r.mes_referencia}`] = r; });
    return m;
  }, [relatorios]);

  const stats = useMemo(() => {
    const processadas = todasFaturas.length + relatorios.length;
    const totalValor =
      todasFaturas.reduce((s, f) => s + (Number(f.valor) || 0), 0) +
      relatorios.reduce((s, r) => s + (Number(r.valor_total) || 0), 0);
    const duplicatas =
      todasFaturas.filter(f => f.marcada_repetida).length +
      relatorios.filter(r => r.marcada_repetida).length;
    const pendentes =
      todasFaturas.filter(f => f.status !== 'anexada').length +
      relatorios.filter(r => r.status !== 'anexada').length;
    return { processadas, totalValor, duplicatas, pendentes };
  }, [todasFaturas, relatorios]);

  const alertasList = useMemo(() => {
    const out = [];
    todasFaturas.forEach(f => {
      const ant = matrizMap[`${f.condominio_id}|${f.concessionaria}|${f.mes_referencia - 1}`];
      if (f.valor != null && ant?.valor != null && Number(ant.valor) > 0) {
        const pct = (Number(f.valor) - Number(ant.valor)) / Number(ant.valor) * 100;
        if (Math.abs(pct) >= 50) out.push({ tipo: 'anomalia', condo_id: f.condominio_id, nome: f.condominios?.name, label: `${f.concessionaria} ${MESES[f.mes_referencia]}`, pct });
      }
      if (f.marcada_repetida) out.push({ tipo: 'repetida', condo_id: f.condominio_id, nome: f.condominios?.name, label: `${f.concessionaria} ${MESES[f.mes_referencia]}`, motivo: f.motivo_repeticao });
    });
    relatorios.forEach(r => {
      const ant = relatoriosMap[`${r.condominio_id}|${r.empresa_leitura}|${r.tipo_servico}|${r.mes_referencia - 1}`];
      if (r.valor_total != null && ant?.valor_total != null && Number(ant.valor_total) > 0) {
        const pct = (Number(r.valor_total) - Number(ant.valor_total)) / Number(ant.valor_total) * 100;
        if (Math.abs(pct) >= 50) out.push({ tipo: 'anomalia', condo_id: r.condominio_id, nome: r.condominios?.name, label: `${r.empresa_leitura} ${MESES[r.mes_referencia]}`, pct });
      }
      if (r.marcada_repetida) out.push({ tipo: 'repetida', condo_id: r.condominio_id, nome: r.condominios?.name, label: `${r.empresa_leitura} ${MESES[r.mes_referencia]}`, motivo: r.motivo_repeticao });
    });
    return out;
  }, [todasFaturas, relatorios, matrizMap, relatoriosMap]);

  const feed = useMemo(() => {
    const all = [
      ...todasFaturas.filter(f => f.status === 'anexada').map(f => ({
        id: 'f' + f.id, nome: f.condominios?.name, empresa: f.concessionaria,
        valor: f.valor, mes: f.mes_referencia, em: f.anexada_em, kind: 'fatura',
      })),
      ...relatorios.filter(r => r.status === 'anexada').map(r => ({
        id: 'r' + r.id, nome: r.condominios?.name, empresa: r.empresa_leitura,
        valor: r.valor_total, mes: r.mes_referencia, em: r.anexada_em, kind: 'relatorio',
        servico: r.tipo_servico, origem: r.origem_emissao_arquivo_id,
      })),
    ];
    return all.filter(x => x.em).sort((a, b) => new Date(b.em) - new Date(a.em)).slice(0, 10);
  }, [todasFaturas, relatorios]);

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

      {/* ─── Dashboard: stats cards ─── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="glass-panel rounded-2xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Processadas</p>
          </div>
          <p className="text-2xl font-black text-white">{stats.processadas}</p>
          <p className="text-[11px] text-slate-500">R$ {fmtBRL(stats.totalValor)} no ano</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Anomalias</p>
          </div>
          <p className="text-2xl font-black text-amber-300">{alertasList.filter(a => a.tipo === 'anomalia').length}</p>
          <p className="text-[11px] text-slate-500">Δ ≥ 50% vs mês anterior</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <RefreshCw className="w-4 h-4 text-rose-400" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Duplicatas</p>
          </div>
          <p className="text-2xl font-black text-rose-300">{stats.duplicatas}</p>
          <p className="text-[11px] text-slate-500">sancionadas</p>
        </div>
        <div className="glass-panel rounded-2xl border border-white/5 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-sky-400" />
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Pendentes</p>
          </div>
          <p className="text-2xl font-black text-sky-300">{stats.pendentes}</p>
          <p className="text-[11px] text-slate-500">aguardando anexar</p>
        </div>
      </div>

      {/* ─── Banner de alertas (só se houver) ─── */}
      {alertasList.length > 0 && (
        <div className="glass-panel rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-2 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5" /> Atenção · {alertasList.length} {alertasList.length === 1 ? 'item' : 'itens'}
          </p>
          <div className="space-y-1.5 max-h-44 overflow-y-auto">
            {alertasList.slice(0, 30).map((a, i) => (
              <button key={i} onClick={() => { setSearch(a.nome || ''); }}
                className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors text-[12px]">
                {a.tipo === 'repetida'
                  ? <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                  : <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                <span className="font-bold text-slate-200 truncate">{a.nome || '—'}</span>
                <span className="text-slate-500">· {a.label}</span>
                {a.tipo === 'anomalia'
                  ? <span className={`ml-auto font-mono font-bold ${a.pct >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>Δ {a.pct >= 0 ? '+' : ''}{a.pct.toFixed(0)}%</span>
                  : <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-rose-300" title={a.motivo || ''}>repetida</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ─── Feed das últimas anexações ─── */}
      {feed.length > 0 && (
        <div className="glass-panel rounded-2xl border border-white/5 p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-emerald-400" /> Últimas anexações
          </p>
          <div className="space-y-1">
            {feed.map(x => {
              const clicavel = x.kind === 'relatorio' && x.origem;
              return (
              <div key={x.id}
                onClick={clicavel ? () => abrirUnidades(x) : undefined}
                title={clicavel ? 'Ver leitura por unidade' : undefined}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] ${clicavel ? 'cursor-pointer hover:bg-sky-500/10' : 'hover:bg-white/[0.02]'}`}>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded shrink-0 ${x.kind === 'relatorio' ? 'bg-sky-500/20 text-sky-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{x.empresa}</span>
                <span className="font-bold text-slate-200 truncate">{x.nome || '—'}</span>
                <span className="text-slate-500 hidden sm:inline">· {MESES[x.mes]}</span>
                {clicavel && <ExternalLink className="w-3 h-3 text-sky-400/70 shrink-0" />}
                <span className="ml-auto font-mono text-white font-bold shrink-0">R$ {fmtBRL(x.valor)}</span>
                <span className="text-[10px] text-slate-600 w-10 text-right shrink-0">{tempoRelativo(x.em)}</span>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Abas de concessionária */}
      <div className="flex gap-2 bg-white/[0.03] p-1.5 rounded-2xl border border-white/5 w-fit">
        {[
          { id: 'todas',  label: 'Todas',  color: 'text-white' },
          { id: 'SABESP', label: 'SABESP', color: 'text-cyan-300',  active: 'bg-cyan-500 text-slate-950' },
          { id: 'COMGAS', label: 'COMGAS', color: 'text-amber-300', active: 'bg-amber-500 text-slate-950' },
          { id: 'ENEL',   label: 'ENEL',   color: 'text-rose-300',  active: 'bg-rose-500 text-white' },
        ].map(t => (
          <button key={t.id} onClick={() => setFiltroConc(t.id)}
            className={`px-5 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              filtroConc === t.id
                ? (t.active || 'bg-violet-600 text-white shadow-lg')
                : `${t.color} hover:bg-white/5`
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtros secundários */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Pesquisar nome ou gerente..."
            className="w-full bg-slate-900/60 border border-white/10 rounded-xl pl-10 pr-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500/50 placeholder-slate-600" />
        </div>
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

      {/* Legenda */}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[10px] text-slate-500">
        <span className="font-bold uppercase tracking-widest">Legenda:</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/40" /> Anexada
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-amber-500/20 border border-amber-500/40" /> Pendente
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-block w-3 h-3 rounded bg-amber-500/20 border border-amber-500/50">
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full" />
          </span> Anomalia (Δ ≥ 50%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="relative inline-block w-3 h-3 rounded bg-rose-500/20 border border-rose-500/40">
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-rose-500 rounded-full" />
          </span> Repetida sancionada
        </span>
      </div>

      {/* Matriz mensal */}
      <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Matriz {anoSel} · {condosFiltrados.length} de {condosComFaturas.length} condomínios
          </p>
          <p className="text-[10px] text-slate-500">Passe o mouse na célula para ver detalhes · Click pra editar</p>
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
                  const concsAll = (c.concessionarias || []);
                  // Quando filtra por concessionaria, mostra somente as linhas dela
                  const concs = filtroConc === 'todas' ? concsAll : concsAll.filter(x => x === filtroConc);
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
                        const isRepetida = f?.marcada_repetida === true;
                        // Calcula anomalia: variacao % vs mes anterior se ambos existirem
                        const fAnt = matrizMap[`${c.id}|${conc}|${m - 1}`];
                        let variacaoPct = null;
                        if (f && fAnt && f.valor != null && fAnt.valor != null && Number(fAnt.valor) > 0) {
                          variacaoPct = (Number(f.valor) - Number(fAnt.valor)) / Number(fAnt.valor) * 100;
                        }
                        const anomaliaGrave = variacaoPct !== null && Math.abs(variacaoPct) >= 50;
                        // Tooltip rico
                        const tooltipParts = [`${conc} ${MESES[m]}/${anoSel}`];
                        if (isAnexada) tooltipParts.push('✓ Anexada'); else if (f) tooltipParts.push('⏳ Pendente');
                        if (f?.valor != null) tooltipParts.push(`R$ ${fmtBRL(f.valor)}`);
                        if (variacaoPct !== null) tooltipParts.push(`Δ ${variacaoPct >= 0 ? '+' : ''}${variacaoPct.toFixed(1)}% vs ${MESES[m-1] || 'mês ant.'}`);
                        if (isRepetida) tooltipParts.push(`🔴 REPETIDA SANCIONADA${f.motivo_repeticao ? ': ' + f.motivo_repeticao : ''}`);
                        return (
                          <td key={m} className="p-0.5 border-r border-white/5">
                            {f ? (
                              <button onClick={() => { setEditFatura(f); setCondoSel(c.id); setShowNovaModal(true); }}
                                className={`relative w-full h-full px-1 py-1.5 rounded text-[10px] font-bold transition-all ${
                                  isRepetida ? 'bg-rose-500/15 border border-rose-500/40 text-rose-300 hover:bg-rose-500/25'
                                  : anomaliaGrave ? 'bg-amber-500/20 border border-amber-500/50 text-amber-200 hover:bg-amber-500/30'
                                  : isAnexada ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
                                  : 'bg-amber-500/15 border border-amber-500/30 text-amber-300 hover:bg-amber-500/25'
                                }`}
                                title={tooltipParts.join(' · ')}>
                                {f.valor != null ? `R$ ${fmtBRL(f.valor)}` : (isAnexada ? '✓' : '·')}
                                {isRepetida && (<span className="absolute -top-1 -right-1 w-2 h-2 bg-rose-500 rounded-full border border-slate-950" />)}
                                {!isRepetida && anomaliaGrave && (<span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-400 rounded-full border border-slate-950 animate-pulse" />)}
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

      {/* Modal de leitura por unidade */}
      {unidadesModal && (
        <RelatorioUnidadesModal info={unidadesModal} onClose={() => setUnidadesModal(null)} />
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

// ─── Modal: leitura por unidade (extraída do relatório) ─────────────
function RelatorioUnidadesModal({ info, onClose }) {
  const { nome, empresa, mes, servico, loading, unidades, erro } = info;
  const lista = unidades || [];

  // Estatísticas + detecção de unidade anômala (m³ > 2× mediana)
  const consumos = lista.map(u => Number(u.m3_total) || 0).filter(v => v > 0).sort((a, b) => a - b);
  const mediana = consumos.length ? consumos[Math.floor(consumos.length / 2)] : 0;
  const limiarAnomalia = mediana * 2;
  const somaM3 = lista.reduce((s, u) => s + (Number(u.m3_total) || 0), 0);
  const somaValor = lista.reduce((s, u) => s + (Number(u.valor_total) || 0), 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-sky-500/20 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center">
              {servico === 'gas' ? <span className="text-lg">🔥</span> : <Droplet className="w-5 h-5 text-sky-400" />}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{nome || 'Relatório'}</h3>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest">
                {empresa} · {servico === 'gas' ? 'Gás' : 'Água'} · {MESES_LONG[mes]} · leitura por unidade
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
        </div>

        {/* Resumo */}
        {!loading && !erro && lista.length > 0 && (
          <div className="px-6 py-3 border-b border-slate-800 grid grid-cols-3 gap-3 text-center shrink-0">
            <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Unidades</p><p className="text-lg font-black text-white">{lista.length}</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Consumo total</p><p className="text-lg font-black text-sky-300">{somaM3.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} m³</p></div>
            <div><p className="text-[10px] text-slate-500 uppercase tracking-widest">Valor total</p><p className="text-lg font-black text-emerald-300">R$ {fmtBRL(somaValor)}</p></div>
          </div>
        )}

        <div className="overflow-auto p-4">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-12 flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando leituras...</p>
          ) : erro ? (
            <p className="text-sm text-amber-300 text-center py-12 flex items-center justify-center gap-2"><AlertTriangle className="w-4 h-4" /> {erro}</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-12">Nenhuma unidade encontrada.</p>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-slate-900">
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
                  const anomala = limiarAnomalia > 0 && m3 > limiarAnomalia;
                  return (
                    <tr key={`${u.apto}-${i}`} className={`border-t border-white/5 ${anomala ? 'bg-amber-500/10' : 'hover:bg-white/[0.02]'}`}>
                      <td className="px-2 py-1.5 font-bold text-slate-200">{u.apto}</td>
                      <td className="px-2 py-1.5 text-slate-400 font-mono text-[11px]">
                        {(u.medidores || []).map((m, j) => (
                          <span key={j} className="inline-block mr-3">
                            {m.ant != null ? m.ant : '—'} → {m.atual != null ? m.atual : '—'}
                            <span className="text-slate-600"> ({m.consumo != null ? m.consumo : '—'})</span>
                          </span>
                        ))}
                      </td>
                      <td className={`px-2 py-1.5 text-right font-mono font-bold ${anomala ? 'text-amber-300' : 'text-sky-300'}`}>
                        {m3.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                        {anomala && <AlertTriangle className="inline w-3 h-3 ml-1 text-amber-400" />}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-white">R$ {fmtBRL(u.valor_total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {!loading && !erro && lista.length > 0 && limiarAnomalia > 0 && (
          <div className="px-6 py-2.5 border-t border-slate-800 text-[10px] text-slate-500 flex items-center gap-2 shrink-0">
            <span className="inline-block w-3 h-3 rounded bg-amber-500/20 border border-amber-500/40" />
            Destacado: consumo &gt; 2× a mediana ({(limiarAnomalia).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³)
          </div>
        )}
      </div>
    </div>
  );
}
