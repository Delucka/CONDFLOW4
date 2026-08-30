'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { mesAnoVigente, mesFechado } from '@/lib/mesVigente';
import { can } from '@/lib/roles';
import {
  Plus, Trash2, Loader2, X, AlertCircle, CheckCircle2,
  Receipt, Calendar, Repeat, Building2, Clock, Lock,
  UploadCloud, FileText, ChevronDown, Search, Pencil,
} from 'lucide-react';

import { useLockedMonths } from '@/lib/useLockedMonths';
import { useIsMobile } from '@/hooks/useMediaQuery';

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function getMesAtual() {
  return mesAnoVigente();   // trabalhamos 1 mês à frente
}

// Lock por (condo, ano) é calculado no hook useLockedMonths; aqui fica só a
// verificação de "mês passou", para os casos sem condomínio selecionado.
// Usa a MESMA régua das outras telas (mesFechado): antes comparava com o mês do
// calendário, e as três telas fechavam o mês em datas diferentes.
const isMesNoPassado = (mes, ano) => mesFechado(mes, ano);

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
// ─── Picker de condomínio com busca (digita código ou nome) ───
function CondoPicker({ condominios, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef(null);
  const sel = condominios.find(c => c.id === value);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? condominios.filter(c => (c.name || '').toLowerCase().includes(s)) : condominios;
  }, [condominios, q]);

  return (
    <div className="relative w-full sm:w-[280px]" ref={ref}>
      <button type="button" onClick={() => { setOpen(o => !o); setQ(''); }}
        className="w-full flex items-center justify-between gap-2 bg-slate-100 border border-slate-700 rounded-xl px-4 py-2 text-sm text-slate-800 outline-none focus:border-amber-500">
        <span className="truncate">{sel ? sel.name : 'Selecione o condomínio'}</span>
        <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)}
                placeholder="Buscar por código ou nome…"
                className="w-full pl-8 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-amber-500 placeholder-slate-400" />
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-xs text-slate-400 text-center">Nenhum condomínio encontrado.</p>
            ) : filtered.map(c => (
              <button key={c.id} type="button" onClick={() => { onChange(c.id); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${c.id === value ? 'bg-amber-50 text-amber-700 font-bold' : 'text-slate-700 hover:bg-slate-100'}`}>
                {c.name}
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400">{filtered.length} condomínio{filtered.length !== 1 ? 's' : ''}</div>
        </div>
      )}
    </div>
  );
}

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
    // Documento obrigatório: cobrança extra é dinheiro cobrado do condômino, e
    // sem o comprovante ninguém consegue responder "por que estou pagando
    // isso?" — nem seis meses depois, quando a memória de quem lançou já foi.
    if (!selectedFile) {
      addToast('Anexe o documento que comprova a cobrança.', 'error');
      return;
    }
    if (parcelasEmMesBloqueado.length > 0) {
      addToast('Alguma parcela cai em mês bloqueado. Escolha outro mês inicial.', 'error');
      return;
    }
    const valorNum = parseFloat(String(form.valor_total).replace(',', '.'));
    if (!valorNum || isNaN(valorNum)) {
      addToast('Informe um valor (use - para crédito/abatimento).', 'error');
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
          valor_total: valorNum,
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
                onChange={e => setForm({ ...form, valor_total: e.target.value.replace(/[^0-9.,-]/g, '') })}
                inputMode="text"
                placeholder="0,00 ou -50,00"
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500 placeholder-slate-400 font-mono" />
              <p className="text-[10px] text-slate-400 mt-0.5">Use <span className="font-mono font-bold">-</span> para crédito/abatimento (valor negativo).</p>
            </div>
            <div>
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Parcelas</label>
              <input type="number" min="1" max="600" step="1" value={form.parcelas}
                onChange={e => setForm({ ...form, parcelas: Math.min(600, Math.max(1, Math.floor(Number(e.target.value) || 1))) })}
                className="w-full bg-slate-100 border border-slate-700 rounded-lg p-3 text-sm text-slate-800 mt-1 outline-none focus:ring-1 focus:ring-amber-500 font-mono" />
              <p className="text-[10px] text-slate-400 mt-0.5">1 = à vista · até 600x</p>
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
                            {!selectedFile && <span className="text-rose-500"> *</span>}
                        </p>
                        {!selectedFile && (
                            <p className="text-[10px] text-slate-500 mt-0.5">
                                obrigatório — sem ele a cobrança não pode ser lançada
                            </p>
                        )}
                    </div>
                    {selectedFile && (
                        <button onClick={(e) => { e.preventDefault(); setSelectedFile(null); }} 
className="text-[10px] text-rose-400 font-bold hover:underline">Remover arquivo</button>
                    )}
                </div>
            </label>
        </div>

        <div className="pt-2">
            <button type="submit" disabled={loading || !selectedFile}
              title={!selectedFile ? 'Anexe o documento que comprova a cobrança' : undefined}
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

// ─── Modal: Pedir alteração ───────────────────────────────────────
//
// Uma cobrança lançada era imutável: para trocar o mês das churrasqueiras de
// setembro para outubro, só cancelando e relançando — o que perde o documento
// anexado e a data do lançamento original.
//
// A mudança não vale sozinha. Fica pendente até master ou emissão decidir, e
// nesse meio tempo a cobrança NÃO entra em emissão: cobrar um valor que está
// sob revisão é o erro que essa aprovação existe para evitar.
const MESES_ALT = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function ModalAlterar({ grupo, onClose, onSaved }) {
  const { addToast } = useToast();
  // A primeira parcela ativa é a que carrega o pedido; `grupo_todo` estende às
  // irmãs que ainda não saíram.
  const alvo = (grupo.parcelas || []).find(p => p.status === 'ativa') || (grupo.parcelas || [])[0];
  const [campos, setCampos] = useState({
    description: grupo.descricao_base || '',
    amount: String(grupo.valor_parcela ?? ''),
    mes: String(alvo?.mes ?? ''),
    ano: String(alvo?.ano ?? ''),
    unidades: alvo?.unidades || '',
  });
  const [motivo, setMotivo] = useState('');
  const [grupoTodo, setGrupoTodo] = useState((grupo.parcelas || []).length > 1);
  const [loading, setLoading] = useState(false);

  // Só o que MUDOU vai no pedido. Mandar tudo faria quem aprova reler campos
  // idênticos procurando a diferença.
  function mudancas() {
    const out = {};
    if (campos.description.trim() && campos.description.trim() !== (grupo.descricao_base || '')) out.description = campos.description.trim();
    const v = parseFloat(String(campos.amount).replace(',', '.'));
    if (Number.isFinite(v) && v !== Number(grupo.valor_parcela)) out.amount = v;
    if (Number(campos.mes) && Number(campos.mes) !== alvo?.mes) out.mes = Number(campos.mes);
    if (Number(campos.ano) && Number(campos.ano) !== alvo?.ano) out.ano = Number(campos.ano);
    if ((campos.unidades || '').trim() !== (alvo?.unidades || '')) out.unidades = campos.unidades.trim();
    return out;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const proposta = mudancas();
    if (!Object.keys(proposta).length) { addToast('Nada mudou — altere algum campo.', 'warning'); return; }
    if (!motivo.trim()) { addToast('Diga por que a alteração é necessária.', 'warning'); return; }
    setLoading(true);
    try {
      const r = await apiFetch('/api/cobrancas-extras/' + alvo.id + '/alterar', {
        method: 'POST',
        body: JSON.stringify({ proposta, motivo: motivo.trim(), grupo_todo: grupoTodo }),
      });
      addToast('Alteração enviada para aprovação' + (r?.cobrancas_afetadas > 1 ? ' (' + r.cobrancas_afetadas + ' parcelas)' : '') + '.', 'success');
      onSaved();
      onClose();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  const proposta = mudancas();
  const CAMPO = 'w-full bg-slate-100 border border-slate-300 rounded-lg p-2.5 text-sm text-slate-800 outline-none focus:border-violet-500';
  const ROT = 'text-[10px] text-slate-500 font-bold uppercase tracking-wider';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
      <div className="bg-white border border-slate-300 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Pencil className="w-5 h-5 text-violet-500" />
            <h3 className="text-lg font-bold text-slate-800">Alterar cobrança</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className={ROT}>Descrição</label>
            <input value={campos.description} onChange={e => setCampos({ ...campos, description: e.target.value })} className={CAMPO + ' mt-1'} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={ROT}>Valor</label>
              <input value={campos.amount} onChange={e => setCampos({ ...campos, amount: e.target.value })}
                inputMode="decimal" className={CAMPO + ' mt-1'} />
            </div>
            <div>
              <label className={ROT}>Unidade(s)</label>
              <input value={campos.unidades} onChange={e => setCampos({ ...campos, unidades: e.target.value })} className={CAMPO + ' mt-1'} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={ROT}>Mês</label>
              <select value={campos.mes} onChange={e => setCampos({ ...campos, mes: e.target.value })} className={CAMPO + ' mt-1 cursor-pointer'}>
                {MESES_ALT.slice(1).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className={ROT}>Ano</label>
              <input value={campos.ano} onChange={e => setCampos({ ...campos, ano: e.target.value })}
                inputMode="numeric" className={CAMPO + ' mt-1'} />
            </div>
          </div>

          {(grupo.parcelas || []).length > 1 && (
            <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-violet-200 bg-violet-50 p-3">
              <input type="checkbox" checked={grupoTodo} onChange={e => setGrupoTodo(e.target.checked)}
                className="w-4 h-4 mt-0.5 accent-violet-600 shrink-0" />
              <span className="text-xs text-slate-700">
                Aplicar às <strong>{grupo.parcelas.length} parcelas</strong> deste lançamento.
                Mudar o valor de uma parcela quase sempre é querer mudar o das que ainda não saíram.
              </span>
            </label>
          )}

          <div>
            <label className={ROT}>Por que a alteração <span className="text-rose-500">*</span></label>
            <textarea required rows={3} value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Ex.: o gerente responsável só entra em outubro — a cobrança acompanha."
              className={CAMPO + ' mt-1 resize-y'} />
            <p className="text-[11px] text-slate-500 mt-1">Quem aprova decide com isto. Sem o motivo, decide no escuro.</p>
          </div>

          {Object.keys(proposta).length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-800 mb-1.5">O que vai mudar</p>
              {'description' in proposta && <p className="text-xs text-amber-900">Descrição: <s>{grupo.descricao_base}</s> → <strong>{proposta.description}</strong></p>}
              {'amount' in proposta && <p className="text-xs text-amber-900">Valor: <s>R$ {Number(grupo.valor_parcela).toFixed(2)}</s> → <strong>R$ {proposta.amount.toFixed(2)}</strong></p>}
              {('mes' in proposta || 'ano' in proposta) && (
                <p className="text-xs text-amber-900">
                  Competência: <s>{MESES_ALT[alvo?.mes]}/{alvo?.ano}</s> → <strong>{MESES_ALT[proposta.mes ?? alvo?.mes]}/{proposta.ano ?? alvo?.ano}</strong>
                </p>
              )}
              {'unidades' in proposta && <p className="text-xs text-amber-900">Unidades: <s>{alvo?.unidades || '—'}</s> → <strong>{proposta.unidades || '—'}</strong></p>}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-[11px] text-slate-600">
              Enquanto a alteração espera decisão, esta cobrança <strong>não entra em emissão</strong>.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-lg border border-slate-300 text-sm font-bold text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-bold hover:bg-violet-500 disabled:opacity-50">
              {loading ? 'Enviando…' : 'Pedir alteração'}
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
  const isMobile = useIsMobile();

  const [condominios, setCondominios] = useState([]);
  const [condoSel, setCondoSel] = useState('');
  const [cobrancas, setCobrancas] = useState([]);
  const [cancelamentos, setCancelamentos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalLancar, setModalLancar] = useState(false);
  const [modalCancelar, setModalCancelar] = useState(null);
  const [modalAlterar, setModalAlterar] = useState(null);
  const [alteracoes, setAlteracoes] = useState([]);
  const [decidindo, setDecidindo] = useState(null);
  const [search, setSearch] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos'); // 'todos' | 'ativa' | 'cancelamento'
  const [loadingCondos, setLoadingCondos] = useState(true);

  const role = profile?.role || user?.role;
  const podeLancar   = can(role, 'edit_cobrancas_extras');
  const podeExecutar = role === 'master' || role === 'departamento';
  const podeSolicitar = role === 'master' || role === 'gerente' || role === 'assistente';

  // Carrega condomínios da carteira — usa /api/condominios (já filtra carteira p/ gerente E assistente)
  useEffect(() => {
    if (!profile?.id) return;
    (async () => {
      setLoadingCondos(true);
      try {
        const res = await apiFetch('/api/condominios');
        const data = (res?.condos || [])
          .map(c => ({ id: c.id, name: c.name }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setCondominios(data);
        if (data.length) {
          // Se veio de um link focado num condomínio (?condo=…, ex.: o "$" do dashboard),
          // abre já nele — mesma tela de cobranças pra todo mundo, sem tela paralela.
          let inicial = data[0].id;
          try {
            const q = new URLSearchParams(window.location.search).get('condo');
            if (q && data.some(c => c.id === q)) inicial = q;
          } catch { /* ignora */ }
          setCondoSel(inicial);
        }
      } catch {
        setCondominios([]);
      } finally {
        setLoadingCondos(false);
      }
    })();
  }, [profile?.id, role]);

  // Carrega cobranças e cancelamentos pendentes
  const carregar = useCallback(async () => {
    if (!condoSel) return;
    setLoading(true);
    try {
      // As três juntas: cada ida ao servidor custa o mesmo pedágio, e pedir uma
      // depois da outra triplicaria a espera de abrir a tela.
      const [res, res2, res3] = await Promise.all([
        apiFetch(`/api/cobrancas-extras/${condoSel}`),
        podeExecutar ? apiFetch('/api/cobrancas-extras/cancelamentos-pendentes') : Promise.resolve(null),
        podeExecutar ? apiFetch('/api/cobrancas-extras/alteracoes-pendentes') : Promise.resolve(null),
      ]);
      setCobrancas(res.cobrancas || []);
      if (res2) setCancelamentos(res2.pendentes || []);
      if (res3) setAlteracoes(res3.pendentes || []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [condoSel, podeExecutar, addToast]);

  useEffect(() => { carregar(); }, [carregar]);

  async function handleDecidirAlteracao(cobranca, aprovar) {
    let motivo = null;
    if (!aprovar) {
      motivo = window.prompt('Por que a alteração foi recusada?\n(quem pediu precisa saber o que fazer em seguida)', '');
      if (motivo === null) return;
    }
    setDecidindo(cobranca.id);
    try {
      await apiFetch('/api/cobrancas-extras/' + cobranca.id + '/alteracao/decidir', {
        method: 'POST',
        body: JSON.stringify({ aprovar, motivo: motivo || null }),
      });
      addToast(aprovar ? 'Alteração aplicada.' : 'Alteração recusada.', aprovar ? 'success' : 'warning');
      carregar();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setDecidindo(null);
    }
  }

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

  // ═══════════ COBRANÇAS EXTRAS — versão de celular (layout de app) ═══════════
  const renderMobile = () => {
    const scopeText = role === 'gerente' ? 'Sua carteira' : role === 'assistente' ? 'Carteira do seu gerente' : 'Todos os condomínios';
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Receipt className="w-5 h-5 text-amber-500" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black text-slate-900 leading-tight">Cobranças extras</h2>
            <p className="text-[11px] text-slate-500">{scopeText}</p>
          </div>
        </div>

        {condominios.length === 0 ? (
          <p className="text-xs text-slate-500 italic px-1">{loadingCondos ? 'Carregando carteira…' : 'Nenhum condomínio na sua carteira'}</p>
        ) : (
          <div className="space-y-2">
            <CondoPicker condominios={condominios} value={condoSel} onChange={setCondoSel} />
            {podeLancar && (
              <button onClick={() => setModalLancar(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-amber-600 text-white text-sm font-black active:opacity-80 transition-opacity">
                <Plus className="w-4 h-4" aria-hidden="true" /> Nova cobrança
              </button>
            )}
          </div>
        )}

        {condoSel && todosGrupos.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl bg-slate-100 p-3">
              <p className="text-2xl font-black text-slate-800 leading-none tabular-nums">{stats.total}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-1.5">Total</p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3">
              <p className="text-2xl font-black text-emerald-600 leading-none tabular-nums">{stats.ativas}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-1.5">Ativas</p>
            </div>
            <div className="rounded-2xl bg-rose-50 p-3">
              <p className="text-2xl font-black text-rose-500 leading-none tabular-nums">{stats.cancel}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-1.5">Aguard. cancel.</p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-3">
              <p className="text-lg font-black text-amber-600 leading-none truncate">R$ {stats.valorTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
              <p className="text-[10px] font-bold text-slate-500 mt-1.5">Valor estimado</p>
            </div>
          </div>
        )}

        {condoSel && todosGrupos.length > 0 && (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar descrição…"
                className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-3 py-2.5 text-sm text-slate-800 outline-none focus:border-amber-500 placeholder-slate-400" />
            </div>
            <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-thin">
              {[{ id: 'todos', label: 'Todas' }, { id: 'ativa', label: 'Ativas' }, { id: 'cancelamento', label: 'Em cancelamento' }].map(opt => (
                <button key={opt.id} onClick={() => setFiltroStatus(opt.id)}
                  className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors ${filtroStatus === opt.id ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {podeExecutar && cancelamentos.length > 0 && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50/50 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-rose-100 flex items-center gap-2">
              <Clock className="w-4 h-4 text-rose-400" aria-hidden="true" />
              <h3 className="text-xs font-black text-rose-500">Aguardando sua aprovação ({cancelamentos.length})</h3>
            </div>
            <div className="divide-y divide-rose-100">
              {cancelamentos.map(c => (
                <div key={c.grupo_id} className="px-4 py-3">
                  <p className="text-sm font-bold text-slate-800 break-words">{c.descricao} — {c.condominio}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{c.parcelas_pendentes} parcela(s) de R$ {Number(c.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} · <em>{c.motivo}</em></p>
                  <button onClick={() => handleExecutarCancelamento(c.grupo_id)}
                    className="mt-2 w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black active:opacity-80">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Cancelar parcelas futuras
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-amber-500" /></div>
        ) : !condoSel ? (
          <div className="py-14 text-center"><Building2 className="w-10 h-10 mx-auto mb-2 text-slate-300" /><p className="text-slate-500 font-bold text-sm">Nenhum condomínio na carteira</p></div>
        ) : todosGrupos.length === 0 ? (
          <div className="py-14 text-center"><Receipt className="w-10 h-10 mx-auto mb-2 text-slate-300" /><p className="text-slate-500 font-bold text-sm">Nenhuma cobrança lançada</p><p className="text-slate-400 text-xs mt-1">Toque em “Nova cobrança”.</p></div>
        ) : gruposFiltrados.length === 0 ? (
          <div className="py-14 text-center"><p className="text-slate-500 font-bold text-sm">Nada encontrado</p><p className="text-slate-400 text-xs mt-1">Limpe a busca ou troque o filtro.</p></div>
        ) : (
          <div className="space-y-2.5">
            {gruposFiltrados.map(grupo => (
              <div key={grupo.grupo_id} className={`bg-white rounded-2xl border p-3.5 ${grupo.status === 'solicitado_cancelamento' ? 'border-rose-200' : 'border-slate-200'}`}>
                <div className="flex items-start gap-2.5">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${grupo.parcela_total > 1 ? 'bg-violet-50' : 'bg-amber-50'}`}>
                    {grupo.parcela_total > 1 ? <Repeat className="w-4 h-4 text-violet-500" /> : <Receipt className="w-4 h-4 text-amber-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 text-sm break-words leading-tight">{grupo.descricao_base}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      {grupo.parcela_total > 1 ? `${grupo.parcela_total}x de R$ ${Number(grupo.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : `R$ ${Number(grupo.valor_parcela).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}
                    </p>
                  </div>
                  {grupo.attachments?.length > 0 && (
                    <a href={grupo.attachments[0]} target="_blank" rel="noreferrer" className="tap shrink-0 text-slate-400" title="Ver documento"><FileText className="w-4 h-4" /></a>
                  )}
                  {podeSolicitar && grupo.status === 'ativa' && (
                    <button onClick={() => setModalAlterar(grupo)} className="tap shrink-0 text-slate-400" aria-label="Pedir alteração"><Pencil className="w-4 h-4" /></button>
                  )}
                  {podeSolicitar && grupo.status === 'ativa' && (
                    <button onClick={() => setModalCancelar(grupo)} className="tap shrink-0 text-slate-400" aria-label="Solicitar cancelamento"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
                {grupo.status === 'solicitado_cancelamento' && (
                  <span className="inline-block mt-2 text-[10px] font-bold bg-rose-50 text-rose-500 border border-rose-200 px-2 py-0.5 rounded">Cancelamento solicitado</span>
                )}
                {grupo.parcelas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2.5 border-t border-slate-100">
                    {grupo.parcelas.sort((a, b) => a.parcela_atual - b.parcela_atual).map(p => {
                      const bloq = isMesNoPassado(p.mes, p.ano);
                      const cancelado = p.status === 'solicitado_cancelamento' || p.status === 'cancelada';
                      const processada = p.status === 'processada';
                      return (
                        <span key={p.id} className={`text-[10px] font-bold px-2 py-0.5 rounded border ${cancelado ? 'bg-rose-50 text-rose-500 border-rose-200 line-through' : processada ? 'bg-violet-50 text-violet-500 border-violet-200' : bloq ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-emerald-50 text-emerald-600 border-emerald-200'}`}>
                          {MESES[(p.mes || 1) - 1]}/{p.ano}{p.parcela_total > 1 ? ` (${p.parcela_atual}/${p.parcela_total})` : ''}{processada ? ' ✓' : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="animate-fade-in w-full space-y-6 pb-20">

      {isMobile ? renderMobile() : (<>

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
            <CondoPicker condominios={condominios} value={condoSel} onChange={setCondoSel} />
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
            <p className="text-[10px] text-amber-600 mt-0.5">parcelas restantes</p>
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
      {/* Alterações esperando decisão.
          Fica antes dos cancelamentos porque é a fila que anda: cancelamento é
          raro, alteração de mês acontece todo início de ciclo. */}
      {podeExecutar && alteracoes.length > 0 && (
        <div className="bg-violet-500/5 border border-violet-500/20 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-violet-500/10 flex items-center gap-2">
            <Pencil className="w-4 h-4 text-violet-500" />
            <h3 className="text-sm font-bold text-violet-700">Alterações aguardando sua decisão ({alteracoes.length})</h3>
          </div>
          <div className="divide-y divide-violet-500/10">
            {alteracoes.map(a => {
              const p = a.alteracao_proposta || {};
              const MES = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
              return (
                <div key={a.id} className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">
                      {a.description} — {a.condominios?.name || '—'}
                    </p>
                    {/* De → para, campo a campo. Quem decide precisa ver a
                        diferença, não os dois estados inteiros. */}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
                      {'amount' in p && (
                        <span>valor <s className="text-slate-400">R$ {Number(a.amount).toFixed(2)}</s> → <strong>R$ {Number(p.amount).toFixed(2)}</strong></span>
                      )}
                      {('mes' in p || 'ano' in p) && (
                        <span>competência <s className="text-slate-400">{MES[a.mes]}/{a.ano}</s> → <strong>{MES[p.mes ?? a.mes]}/{p.ano ?? a.ano}</strong></span>
                      )}
                      {'description' in p && (
                        <span>descrição → <strong>{p.description}</strong></span>
                      )}
                      {'unidades' in p && (
                        <span>unidades <s className="text-slate-400">{a.unidades || '—'}</s> → <strong>{p.unidades || '—'}</strong></span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {a.alteracao_pedida_por ? a.alteracao_pedida_por + ': ' : ''}<em>{a.alteracao_motivo}</em>
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => handleDecidirAlteracao(a, false)} disabled={decidindo === a.id}
                      className="px-3 py-2 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                      Recusar
                    </button>
                    <button onClick={() => handleDecidirAlteracao(a, true)} disabled={decidindo === a.id}
                      className="px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-500 disabled:opacity-50 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> {decidindo === a.id ? '…' : 'Aprovar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  {grupo.parcelas?.some(p => p.alteracao_proposta) && (
                    <span className="text-[10px] font-bold bg-violet-500/10 text-violet-600 border border-violet-500/20 px-2 py-1 rounded"
                      title="Não entra em emissão até alguém decidir">
                      Alteração pendente
                    </span>
                  )}
                  {grupo.status === 'solicitado_cancelamento' && (
                    <span className="text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-1 rounded">
                      Cancelamento solicitado
                    </span>
                  )}
                  {podeSolicitar && grupo.status === 'ativa' && (
                    <button onClick={() => setModalAlterar(grupo)}
                      className="text-slate-600 hover:text-violet-500 transition-colors" title="Pedir alteração (valor, mês, descrição)">
                      <Pencil className="w-4 h-4" />
                    </button>
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
      </>)}

      {modalLancar && (
        <ModalLancar condominioId={condoSel} condominioNome={condoNome} onClose={() => setModalLancar(false)} onSaved={carregar} />
      )}
      {modalCancelar && (
        <ModalCancelar cobranca={modalCancelar} onClose={() => setModalCancelar(null)} onSaved={carregar} />
      )}
      {modalAlterar && (
        <ModalAlterar grupo={modalAlterar} onClose={() => setModalAlterar(null)} onSaved={carregar} />
      )}
    </div>
  );
}
