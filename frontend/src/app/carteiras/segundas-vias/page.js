'use client';
import { useState, useMemo, useRef } from 'react';
import useSWR from 'swr';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { apiFetcher, apiPost } from '@/lib/api';
import { validarArquivo } from '@/lib/uploadGuard';
import { safeStorageName } from '@/lib/storage';
import {
  FileText, Plus, Loader2, Building2, Send, Paperclip, X, CheckCircle2,
  AlertTriangle, Clock, Ban, Mail, Calendar, UploadCloud,
} from 'lucide-react';

const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const MODALIDADES = [
  { id: 'com_multa',   label: 'Com multa',    desc: 'Padrão (boleto vencido com multa).' },
  { id: 'sem_multa',   label: 'Sem multa',    desc: 'Exige anexar a autorização do síndico/gerente.' },
  { id: 'quinto_andar',label: 'Quinto Andar', desc: 'Vencimento +5 dias — eles não pagam vencido.' },
];
const MODAL_LABEL = { com_multa: 'Com multa', sem_multa: 'Sem multa', quinto_andar: 'Quinto Andar' };

const STATUS_STYLE = {
  pendente: { label: 'Pendente', cls: 'bg-amber-500/15 text-amber-700 border-amber-500/30', Icon: Clock },
  emitido:  { label: 'Emitido',  cls: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', Icon: CheckCircle2 },
  cancelado:{ label: 'Cancelado',cls: 'bg-slate-500/10 text-slate-500 border-slate-300', Icon: Ban },
};

const hojeMais = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

export default function SegundasViasPage() {
  const { profile } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);
  const role = profile?.role;
  const atende = ['master', 'departamento'].includes(role);

  const { data: condosData } = useSWR('/api/condominios', apiFetcher);
  const condos = condosData?.condos || [];

  const { data: listData, mutate, isLoading } = useSWR('/api/segundas-vias', apiFetcher, { refreshInterval: 30000 });
  const solicitacoes = listData?.solicitacoes || [];

  const anoAtual = new Date().getFullYear();
  const vazio = { condominio_id: '', unidade: '', ref_mes: new Date().getMonth() + 1, ref_ano: anoAtual,
                  vencimento: '', modalidade: 'com_multa', email_destinatario: '', observacoes: '' };
  const [form, setForm] = useState(vazio);
  const [anexoFile, setAnexoFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const anexoRef = useRef(null);

  function setModalidade(m) {
    setForm(f => {
      const next = { ...f, modalidade: m };
      if (m === 'quinto_andar' && (!f.vencimento || f.vencimento < hojeMais(5))) next.vencimento = hojeMais(5);
      return next;
    });
  }

  async function uploadBucket(file, prefix) {
    const path = `${prefix}/${Date.now()}_${safeStorageName(file.name)}`;
    const { error } = await supabase.storage.from('emissoes').upload(path, file);
    if (error) throw error;
    return { url: path, nome: file.name };
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.condominio_id) return addToast('Escolha o condomínio.', 'error');
    if (!form.unidade.trim()) return addToast('Informe a unidade.', 'error');
    if (form.modalidade === 'sem_multa' && !anexoFile) return addToast('Sem multa exige anexar a autorização do síndico/gerente.', 'error');
    if (anexoFile) { const v = validarArquivo(anexoFile); if (!v.ok) return addToast(v.erro, 'error'); }
    setSaving(true);
    try {
      let anexo = {};
      if (anexoFile) { const up = await uploadBucket(anexoFile, 'segundas-vias/autorizacoes'); anexo = { anexo_url: up.url, anexo_nome: up.nome }; }
      await apiPost('/api/segundas-vias', {
        condominio_id: form.condominio_id, unidade: form.unidade.trim(),
        ref_mes: form.ref_mes ? Number(form.ref_mes) : null, ref_ano: form.ref_ano ? Number(form.ref_ano) : null,
        vencimento: form.vencimento || null, modalidade: form.modalidade,
        email_destinatario: form.email_destinatario.trim() || null, observacoes: form.observacoes.trim() || null,
        ...anexo,
      });
      addToast('Solicitação enviada! O time de 2ª via foi avisado.', 'success');
      setForm({ ...vazio }); setAnexoFile(null); if (anexoRef.current) anexoRef.current.value = '';
      mutate();
    } catch (err) { addToast(err.message || 'Erro ao enviar', 'error'); }
    finally { setSaving(false); }
  }

  async function abrirArquivo(path) {
    if (!path) return;
    try {
      const { data } = await supabase.storage.from('emissoes').createSignedUrl(path, 300);
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
      else addToast('Não consegui abrir o arquivo.', 'error');
    } catch { addToast('Não consegui abrir o arquivo.', 'error'); }
  }

  const [emitindoId, setEmitindoId] = useState(null);
  async function handleEmitir(sv, boletoFile) {
    if (boletoFile) { const v = validarArquivo(boletoFile); if (!v.ok) return addToast(v.erro, 'error'); }
    setEmitindoId(sv.id);
    try {
      let boleto = {};
      if (boletoFile) { const up = await uploadBucket(boletoFile, `segundas-vias/boletos/${sv.condominio_id}`); boleto = { boleto_url: up.url, boleto_nome: up.nome }; }
      const r = await apiPost(`/api/segundas-vias/${sv.id}/emitir`, { ...boleto, enviar_email: true });
      addToast(r?.email_enviado ? 'Emitido e e-mail enviado ao destinatário (assistente em cópia).'
        : 'Marcado como emitido. (Sem e-mail — confira se há e-mail do destinatário.)', r?.email_enviado ? 'success' : 'warning');
      mutate();
    } catch (err) { addToast(err.message || 'Erro ao emitir', 'error'); }
    finally { setEmitindoId(null); }
  }

  async function handleCancelar(sv) {
    if (!confirm('Cancelar esta solicitação?')) return;
    try { await apiPost(`/api/segundas-vias/${sv.id}/cancelar`, {}); addToast('Solicitação cancelada.', 'success'); mutate(); }
    catch (err) { addToast(err.message, 'error'); }
  }

  const pendentes = solicitacoes.filter(s => s.status === 'pendente');

  return (
    <div className="animate-fade-in w-full flex flex-col gap-6 pb-20">
      {/* Header */}
      <div className="glass-panel p-6 rounded-[2rem] border border-slate-200 shadow-xl flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-center shrink-0">
          <FileText className="w-7 h-7 text-violet-500" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Segundas Vias</h2>
          <p className="text-xs text-slate-500 mt-1">Pedidos de boleto de 2ª via, centralizados — sem depender de e-mail solto.{atende ? ` · ${pendentes.length} pendente${pendentes.length !== 1 ? 's' : ''}` : ''}</p>
        </div>
      </div>

      {/* Formulário de nova solicitação */}
      <form onSubmit={handleCreate} className="glass-panel p-6 rounded-2xl border border-slate-200 space-y-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2"><Plus className="w-4 h-4 text-violet-500" /> Nova solicitação</p>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Condomínio</label>
            <select required value={form.condominio_id} onChange={e => setForm({ ...form, condominio_id: e.target.value })}
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60">
              <option value="">Selecione…</option>
              {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unidade</label>
            <input required value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })} placeholder="Ex: 71"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60" />
          </div>
          <div className="md:col-span-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">E-mail do destinatário</label>
            <input type="email" value={form.email_destinatario} onChange={e => setForm({ ...form, email_destinatario: e.target.value })} placeholder="quem recebe o boleto"
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Referência (cota)</label>
            <div className="flex gap-2 mt-1">
              <select value={form.ref_mes} onChange={e => setForm({ ...form, ref_mes: e.target.value })}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60">
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{MESES[m]}</option>)}
              </select>
              <input type="number" value={form.ref_ano} onChange={e => setForm({ ...form, ref_ano: e.target.value })}
                className="w-24 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60" />
            </div>
          </div>
          <div className="md:col-span-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Vencimento</label>
            <input type="date" value={form.vencimento}
              min={form.modalidade === 'quinto_andar' ? hojeMais(5) : undefined}
              onChange={e => setForm({ ...form, vencimento: e.target.value })}
              className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60" />
            {form.modalidade === 'quinto_andar' && <p className="text-[10px] text-amber-700 mt-1">Quinto Andar: vencimento mínimo hoje + 5 dias.</p>}
          </div>
          <div className="md:col-span-4">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Anexo {form.modalidade === 'sem_multa' && <span className="text-rose-600">(autorização — obrigatório)</span>}
            </label>
            <input ref={anexoRef} type="file" accept="application/pdf,image/*" onChange={e => setAnexoFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-violet-500/10 file:text-violet-700 hover:file:bg-violet-500/20" />
          </div>
        </div>

        {/* Modalidade */}
        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Modalidade</label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
            {MODALIDADES.map(m => (
              <button type="button" key={m.id} onClick={() => setModalidade(m.id)}
                className={`text-left p-3 rounded-xl border-2 transition-all ${form.modalidade === m.id ? 'border-violet-600 bg-violet-500/5' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}>
                <p className={`text-xs font-black uppercase tracking-tight ${form.modalidade === m.id ? 'text-violet-700' : 'text-slate-700'}`}>{m.label}</p>
                <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Observações</label>
          <textarea value={form.observacoes} onChange={e => setForm({ ...form, observacoes: e.target.value })} rows={2}
            placeholder="Ex: emitir a 2ª via da cota de junho/26 com multa e vencimento 30/06."
            className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-violet-500/60 resize-none" />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving}
            className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold flex items-center gap-2 shadow-lg shadow-violet-500/20 disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Enviar solicitação
          </button>
        </div>
      </form>

      {/* Lista / Fila */}
      <div className="glass-panel rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">{atende ? 'Fila de pedidos' : 'Minhas solicitações'} · {solicitacoes.length}</p>
        </div>
        {isLoading && solicitacoes.length === 0 ? (
          <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-violet-500 mx-auto" /></div>
        ) : solicitacoes.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <FileText className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-700">Nenhuma solicitação ainda</p>
            <p className="text-xs text-slate-500 mt-1">Use o formulário acima para abrir o primeiro pedido de 2ª via.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {solicitacoes.map(sv => {
              const st = STATUS_STYLE[sv.status] || STATUS_STYLE.pendente;
              const ref = (sv.ref_mes && sv.ref_ano) ? `${MESES[sv.ref_mes]}/${sv.ref_ano}` : '';
              const venc = sv.vencimento ? new Date(sv.vencimento + 'T00:00:00').toLocaleDateString('pt-BR') : '';
              return (
                <div key={sv.id} className="px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{sv.condominios?.name || '—'}</span>
                        <span className="text-[11px] text-slate-500">· unid. <b className="text-slate-700">{sv.unidade}</b></span>
                        <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded border ${st.cls} flex items-center gap-1`}><st.Icon className="w-3 h-3" /> {st.label}</span>
                        <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-700">{MODAL_LABEL[sv.modalidade] || sv.modalidade}</span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-slate-500">
                        {ref && <span><Calendar className="w-3 h-3 inline -mt-0.5" /> ref. {ref}</span>}
                        {venc && <span>venc. {venc}</span>}
                        {sv.email_destinatario && <span><Mail className="w-3 h-3 inline -mt-0.5" /> {sv.email_destinatario}{sv.email_enviado ? ' ✓ enviado' : ''}</span>}
                        {sv.criado_por_nome && <span>por {sv.criado_por_nome}</span>}
                      </div>
                      {sv.observacoes && <p className="text-[11px] text-slate-500 italic mt-1 line-clamp-2">&ldquo;{sv.observacoes}&rdquo;</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        {sv.anexo_url && <button onClick={() => abrirArquivo(sv.anexo_url)} className="text-[10px] font-bold text-violet-700 hover:text-violet-900 inline-flex items-center gap-1"><Paperclip className="w-3 h-3" /> autorização</button>}
                        {sv.boleto_url && <button onClick={() => abrirArquivo(sv.boleto_url)} className="text-[10px] font-bold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1"><FileText className="w-3 h-3" /> boleto</button>}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-2 shrink-0">
                      {atende && sv.status === 'pendente' && (
                        <EmitirBox sv={sv} emitindo={emitindoId === sv.id} onEmitir={handleEmitir} />
                      )}
                      {sv.status !== 'cancelado' && sv.status !== 'emitido' && (
                        <button onClick={() => handleCancelar(sv)} title="Cancelar"
                          className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:text-rose-500 hover:border-rose-300 transition-all">
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Caixa de emissão: anexar boleto + enviar
function EmitirBox({ sv, emitindo, onEmitir }) {
  const [file, setFile] = useState(null);
  const ref = useRef(null);
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} type="file" accept="application/pdf,image/*" className="hidden" onChange={e => setFile(e.target.files?.[0] || null)} />
      <button type="button" onClick={() => ref.current?.click()} title="Anexar boleto"
        className={`p-2 rounded-lg border transition-all ${file ? 'bg-emerald-500/10 border-emerald-400 text-emerald-700' : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-900'}`}>
        <UploadCloud className="w-4 h-4" />
      </button>
      <button type="button" onClick={() => onEmitir(sv, file)} disabled={emitindo}
        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 disabled:opacity-50"
        title="Marca como emitido e envia o boleto por e-mail (assistente em cópia)">
        {emitindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Emitir e enviar
      </button>
    </div>
  );
}
