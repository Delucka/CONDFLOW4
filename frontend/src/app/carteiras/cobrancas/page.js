'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/utils/supabase/client';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { 
  UploadCloud, FileText, Building2, Calendar, 
  DollarSign, Send, CheckCircle2, ChevronRight,
  Trash2, Search, X, Loader2, AlertCircle
} from 'lucide-react';
import Link from 'next/link';

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
];

export default function CentralCobrancasPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [condos, setCondos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form State
  const [selectedCondo, setSelectedCondo] = useState('');
  const [mesRef, setMesRef] = useState(new Date().getMonth() + 2); // Próximo mês
  const [anoRef, setAnoRef] = useState(new Date().getFullYear());
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [recentUploads, setRecentUploads] = useState([]);

  useEffect(() => {
    async function carregarDados() {
      if (!user) return;
      try {
        setLoading(true);
        // Buscar condomínios vinculados a este gerente
        // Se for Master, busca todos
        let query = supabase.from('condominios').select('id, name').order('name');
        
        if (user.role !== 'master') {
           query = query.eq('gerente_id', user.id);
        }

        const { data } = await query;
        setCondos(data || []);

        // Buscar últimos lançamentos
        const { data: recent } = await supabase
          .from('cobrancas_extras')
          .select('*, processos(condominio_id, condominios(name))')
          .order('created_at', { ascending: false })
          .limit(5);
        
        setRecentUploads(recent || []);
      } catch (err) {
        addToast('Erro ao carregar dados', 'error');
      } finally {
        setLoading(false);
      }
    }
    carregarDados();
  }, [user, supabase, addToast]);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCondo || !descricao || !valor) {
      addToast('Preencha os campos obrigatórios', 'warning');
      return;
    }

    try {
      setSaving(true);
      
      const realMonth = parseInt(mesRef);
      const realYear = parseInt(anoRef);
      const semester = realMonth <= 6 ? 1 : 2;

      // 1. Garantir que o processo existe
      let { data: proc } = await supabase
        .from('processos')
        .select('id')
        .eq('condominio_id', selectedCondo)
        .eq('year', realYear)
        .eq('semester', semester)
        .maybeSingle();

      if (!proc) {
        const { data: newProc, error: procErr } = await supabase
          .from('processos')
          .insert({
            condominio_id: selectedCondo,
            year: realYear,
            semester: semester,
            status: 'Em edição'
          })
          .select()
          .single();
        if (procErr) throw procErr;
        proc = newProc;
      }

      // 2. Upload do Arquivo (opcional mas recomendado)
      let fileUrl = null;
      if (selectedFile) {
        const fileName = `${Date.now()}_${selectedFile.name}`;
        const { data: uploadData, error: uploadErr } = await supabase.storage
          .from('cobrancas')
          .upload(`${selectedCondo}/${fileName}`, selectedFile);
        
        if (uploadErr) throw uploadErr;
        fileUrl = uploadData.path;
      }

      // 3. Salvar Cobrança
      const cleanValor = parseFloat(valor.toString().replace(',', '.'));
      const { error: saveErr } = await supabase
        .from('cobrancas_extras')
        .insert({
          processo_id: proc.id,
          description: descricao,
          amount: cleanValor,
          attachments: fileUrl ? [fileUrl] : []
        });

      if (saveErr) throw saveErr;

      addToast('Cobrança lançada com sucesso!', 'success');
      
      // Reset
      setDescricao('');
      setValor('');
      setSelectedFile(null);
      
      // Refresh Recent
      const { data: recent } = await supabase
        .from('cobrancas_extras')
        .select('*, processos(condominio_id, condominios(name))')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentUploads(recent || []);

    } catch (err) {
      console.error(err);
      addToast('Erro ao salvar cobrança: ' + err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !condos.length) {
    return (
      <div className="flex flex-col items-center justify-center p-20">
        <Loader2 className="w-10 h-10 text-cyan-500 animate-spin mb-4" />
        <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Carregando Central de Cobranças...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-20">
      
      {/* ─── HEADER ─── */}
      <div className="glass-panel p-8 mb-8 rounded-3xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/5 rounded-full -mr-32 -mt-32 blur-3xl"></div>
        <div className="relative z-10">
            <h1 className="text-3xl font-black text-white uppercase tracking-tight mb-2">Central de Cobranças Extras</h1>
            <p className="text-slate-400 text-sm font-medium">Lançamento unificado de taxas e anexos para sua carteira de condomínios.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* ─── FORMULÁRIO DE LANÇAMENTO ─── */}
        <div className="lg:col-span-12 xl:col-span-8">
            <form onSubmit={handleSubmit} className="glass-panel p-8 rounded-3xl border-white/5 shadow-2xl space-y-8">
                
                {/* Seção 1: Destinatário */}
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center border border-orange-500/20">
                            <Building2 className="w-5 h-5 text-orange-400" />
                        </div>
                        <h2 className="text-lg font-black text-white uppercase tracking-tight">Condomínio & Referência</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-1">
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Selecione o Condomínio</label>
                            <select 
                                value={selectedCondo}
                                onChange={e => setSelectedCondo(e.target.value)}
                                required
                                className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm font-bold text-white focus:border-orange-500 transition-all outline-none"
                            >
                                <option value="">Escolher...</option>
                                {condos.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                            {condos.length === 0 && (
                                <p className="text-[10px] text-amber-500 mt-2 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" /> Nenhum condomínio na sua carteira.
                                </p>
                            )}
                        </div>

                        <div>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Mês de Emissão</label>
                            <select 
                                value={mesRef}
                                onChange={e => setMesRef(e.target.value)}
                                className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm font-bold text-white focus:border-orange-500 transition-all outline-none"
                            >
                                {MESES.map((m, i) => (
                                    <option key={i} value={i+1}>{m}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Ano</label>
                            <select 
                                value={anoRef}
                                onChange={e => setAnoRef(e.target.value)}
                                className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm font-bold text-white focus:border-orange-500 transition-all outline-none"
                            >
                                {[2024, 2025, 2026, 2027].map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Seção 2: Detalhes da Cobrança */}
                <div>
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-cyan-500/10 rounded-xl flex items-center justify-center border border-cyan-500/20">
                            <DollarSign className="w-5 h-5 text-cyan-400" />
                        </div>
                        <h2 className="text-lg font-black text-white uppercase tracking-tight">Dados do Documento</h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="md:col-span-3">
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Descrição / Motivo da Cobrança</label>
                            <input 
                                value={descricao}
                                onChange={e => setDescricao(e.target.value)}
                                placeholder="Ex: Conserto do Portão (Nota Fiscal 123)"
                                className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm font-bold text-white focus:border-cyan-500 transition-all outline-none"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Valor Total (R$)</label>
                            <input 
                                value={valor}
                                onChange={e => setValor(e.target.value)}
                                placeholder="0,00"
                                className="w-full bg-black/40 border-white/10 rounded-2xl p-4 text-sm font-bold text-white focus:border-cyan-500 transition-all outline-none text-right"
                                required
                            />
                        </div>
                    </div>
                </div>

                {/* Seção 3: Anexo */}
                <div className="pt-4">
                    <label className="block text-center border-2 border-dashed border-white/10 hover:border-cyan-500/50 rounded-3xl p-10 cursor-pointer bg-white/[0.02] hover:bg-cyan-500/5 transition-all group">
                        <input type="file" className="hidden" onChange={handleFileChange} />
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 bg-white/[0.05] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
                                {selectedFile ? <FileText className="w-8 h-8 text-cyan-400" /> : <UploadCloud className="w-8 h-8 text-slate-500 group-hover:text-cyan-400" />}
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-black text-slate-300 uppercase tracking-widest">
                                    {selectedFile ? selectedFile.name : 'Clique para anexar o boleto/NF'}
                                </p>
                                <p className="text-[10px] text-slate-500 mt-1 uppercase">PDF, Imagens ou Excel (Max. 15MB)</p>
                            </div>
                            {selectedFile && (
                                <button onClick={(e) => { e.preventDefault(); setSelectedFile(null); }} className="text-xs text-red-400 font-bold hover:underline flex items-center gap-1">
                                    <X className="w-3 h-3" /> Remover arquivo
                                </button>
                            )}
                        </div>
                    </label>
                </div>

                {/* Botão Salvar */}
                <div className="pt-6">
                    <button 
                        disabled={saving}
                        className="w-full py-5 bg-gradient-to-r from-cyan-600 to-violet-600 hover:from-cyan-500 hover:to-violet-500 text-white font-black rounded-2xl uppercase tracking-[0.2em] shadow-[0_0_40px_rgba(34,211,238,0.2)] transition-all flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50"
                    >
                        {saving ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> Processando...</>
                        ) : (
                            <><Send className="w-5 h-5" /> Confirmar Lançamento na Planilha</>
                        )}
                    </button>
                </div>

            </form>
        </div>

        {/* ─── SIDEBAR: RECENTES ─── */}
        <div className="lg:col-span-12 xl:col-span-4 space-y-6">
            <div className="glass-panel p-6 rounded-3xl border-white/5">
                <div className="flex items-center gap-2 mb-6">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Últimos Lançamentos</h3>
                </div>
                
                <div className="space-y-4">
                    {recentUploads.length > 0 ? recentUploads.map(r => (
                        <div key={r.id} className="p-4 bg-white/[0.03] border border-white/5 rounded-2xl group hover:bg-white/[0.05] transition-all">
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-[10px] font-black text-slate-500 uppercase">{r.processos?.condominios?.name}</span>
                                <span className="text-xs font-black text-cyan-400">R$ {r.amount?.toFixed(2)}</span>
                            </div>
                            <p className="text-xs font-bold text-white mb-1 truncate">{r.description}</p>
                            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
                                <div className="text-[9px] font-bold text-slate-500 flex items-center gap-1 uppercase">
                                    <Calendar className="w-3 h-3" /> Para Semestre {r.processos?.year}/{r.processos?.semester}
                                </div>
                            </div>
                        </div>
                    )) : (
                        <p className="text-center py-10 text-xs text-slate-600 font-bold uppercase italic">Nenhum lançamento recente</p>
                    )}
                </div>

                <div className="mt-8">
                    <Link href="/dashboard" className="w-full py-4 border border-white/10 rounded-2xl flex items-center justify-center text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-white hover:bg-white/5 transition-all">
                        Ir para o Painel Geral
                    </Link>
                </div>
            </div>

            {/* Dica */}
            <div className="p-6 rounded-3xl bg-violet-600/10 border border-violet-500/20">
                <div className="flex gap-3">
                    <Calendar className="w-5 h-5 text-violet-400 shrink-0" />
                    <div>
                        <p className="text-xs font-black text-violet-300 uppercase mb-1">Dica de Emissão</p>
                        <p className="text-[11px] text-violet-400/80 leading-relaxed">
                            Selecione o mês onde a cobrança deve aparecer. O sistema vinculará automaticamente ao semestre correto na planilha do condomínio.
                        </p>
                    </div>
                </div>
            </div>
        </div>

      </div>

    </div>
  );
}
