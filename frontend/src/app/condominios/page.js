'use client';
import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { usePipelineConfig } from '@/lib/usePipelineConfig';
import { Building, PlusCircle, Pencil, Search, X, Loader2, User, Calendar, ShieldCheck, Eye, ChevronLeft, ChevronRight, Timer, Globe, Save, Lock, Unlock, AlertTriangle } from 'lucide-react';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { createClient } from '@/utils/supabase/client';

export default function CondominiosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', due_day: '', gerente_id: '', assistente: '', fluxo: 1 });
  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const [selectedGerente, setSelectedGerente] = useState(null);
  const supabase = createClient();

  // ── Pipeline Global ──────────────────────────────────────────────
  const toLocalDT = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const anoAtual = new Date().getFullYear();
  const [pipelineAno, setPipelineAno] = useState(anoAtual);
  const { config: pipelineConfig, update: updatePipeline } = usePipelineConfig(pipelineAno);

  const [dataInicioLocal, setDataInicioLocal] = useState('');
  const [dataFimLocal, setDataFimLocal]       = useState('');
  const [savingPeriodo, setSavingPeriodo]     = useState(false);
  const [forcingAll, setForcingAll]           = useState(false);
  const [countdown, setCountdown]             = useState(null);

  // Sincronizar com config do banco
  useEffect(() => {
    setDataInicioLocal(toLocalDT(pipelineConfig?.data_inicio));
    setDataFimLocal(toLocalDT(pipelineConfig?.prazo_edicao));
  }, [pipelineConfig?.data_inicio, pipelineConfig?.prazo_edicao]);

  // Countdown inteligente: programado / ativo / encerrado
  useEffect(() => {
    const fim = pipelineConfig?.prazo_edicao ? new Date(pipelineConfig.prazo_edicao) : null;
    const ini = pipelineConfig?.data_inicio  ? new Date(pipelineConfig.data_inicio)  : null;
    if (!fim) { setCountdown(null); return; }

    const tick = () => {
      const agora = new Date();
      const diffFim = fim - agora;
      const diffIni = ini ? ini - agora : 0;

      if (ini && diffIni > 0) {
        // Ainda não abriu
        const d = Math.floor(diffIni / 86400000);
        const h = Math.floor((diffIni % 86400000) / 3600000);
        const m = Math.floor((diffIni % 3600000) / 60000);
        const s = Math.floor((diffIni % 60000) / 1000);
        setCountdown({ fase: 'agendado', d, h, m, s });
      } else if (diffFim > 0) {
        // Período ativo
        const d = Math.floor(diffFim / 86400000);
        const h = Math.floor((diffFim % 86400000) / 3600000);
        const m = Math.floor((diffFim % 3600000) / 60000);
        const s = Math.floor((diffFim % 60000) / 1000);
        setCountdown({ fase: 'ativo', d, h, m, s });
      } else {
        setCountdown({ fase: 'encerrado' });
      }
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [pipelineConfig?.prazo_edicao, pipelineConfig?.data_inicio]);

  const handleSavePeriodo = async () => {
    setSavingPeriodo(true);
    const ini = dataInicioLocal ? new Date(dataInicioLocal).toISOString() : null;
    const fim = dataFimLocal    ? new Date(dataFimLocal).toISOString()    : null;
    const { error } = await updatePipeline({ data_inicio: ini, prazo_edicao: fim });
    setSavingPeriodo(false);
    if (error) addToast('Erro ao salvar período: ' + error.message, 'error');
    else addToast('Período de edição salvo!', 'success');
  };

  const [gerenteFilter, setGerenteFilter] = useState('');  // '' = todos

  const handleForceAll = async (status) => {
    setForcingAll(true);
    try {
      const sem = new Date().getMonth() < 6 ? 1 : 2;
      const payload = { status, ano: pipelineAno, semestre: sem };
      if (gerenteFilter) payload.gerente_id = gerenteFilter;
      const res = await apiPost('/api/pipeline/force-all', payload);
      const alvo = gerenteFilter
        ? gerentes.find(g => g.id === gerenteFilter)?.full_name || 'gerente'
        : 'todos';
      addToast(`"${status}" aplicado a ${res.updated} condomínios (${alvo})!`, 'success');
    } catch (err) {
      addToast('Erro: ' + err.message, 'error');
    } finally {
      setForcingAll(false);
    }
  };

  // SWR para Dados de Condomínios e Gerentes
  const { data: condosData, mutate: mutateCondos, isLoading: loadingCondos } = useSWR('/api/condominios', apiFetcher);
  const { data: usersData } = useSWR(user?.role === 'master' ? '/api/usuarios' : null, apiFetcher);

  const condos = condosData?.condos || [];
  const gerentes = (usersData?.usuarios || []).filter(u => u.role === 'gerente');

  const canEdit = user?.role === 'master';
  const filtered = condos.filter(c => c.name.toLowerCase().includes(search.toLowerCase()));

  function openEdit(condo = null) {
    if (condo) {
      setFormData({ 
        id: condo.id, 
        name: condo.name, 
        due_day: condo.due_day || '', 
        gerente_id: condo.gerente_id || '', 
        assistente: condo.assistente || '',
        fluxo: condo.fluxo || 1
      });
    } else {
      setFormData({ id: '', name: '', due_day: '', gerente_id: '', assistente: '', fluxo: 1 });
    }
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await apiPost('/api/condominios/salvar', formData);
      addToast(formData.id ? 'Condomínio atualizado!' : 'Novo condomínio cadastrado!', 'success');
      setModalOpen(false);
      mutateCondos(); // Atualiza a lista instantaneamente
    } catch (err) {
      addToast(err.message || 'Erro ao salvar', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData, error: fileError } = await supabase
        .from('emissoes_arquivos')
        .select('*')
        .eq('condominio_id', condoId)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fileError) throw fileError;

      let allFiles = [];
      let signedUrl = null;

      if (fileData) {
        // Buscar todos os arquivos do mesmo pacote
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('*')
          .eq('pacote_id', fileData.pacote_id);
        
        allFiles = arquivos || [];

        const { data: urlData } = await supabase.storage
          .from('emissoes')
          .createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }

      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: fileData?.processo_id || null,
        arquivos: allFiles
      });
    } catch (err) {
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  return (
    <div className="animate-fade-in w-full h-full relative space-y-8 pb-20">

      {/* ── Painel de Controle Global (só master) ── */}
      {user?.role === 'master' && (
        <div className="glass-panel p-6 rounded-[2rem] border border-white/5 shadow-2xl space-y-5">

          {/* Cabeçalho */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Globe className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Painel de Controle Global</p>
                <p className="text-xs font-bold text-white">Período de Edição da Gerência</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2">
              <button onClick={() => setPipelineAno(a => a - 1)} className="text-slate-400 hover:text-white transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span className="text-xs font-black text-slate-200 min-w-[40px] text-center">{pipelineAno}</span>
              <button onClick={() => setPipelineAno(a => a + 1)} className="text-slate-400 hover:text-white transition-colors">
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Programação De / Até */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Programar Período de Edição</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest w-6">De</span>
              <input type="datetime-local" value={dataInicioLocal} onChange={e => setDataInicioLocal(e.target.value)}
                className="flex-1 min-w-[160px] bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/50 transition-all" />
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest w-6">Até</span>
              <input type="datetime-local" value={dataFimLocal} onChange={e => setDataFimLocal(e.target.value)}
                className="flex-1 min-w-[160px] bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/50 transition-all" />
              <button onClick={handleSavePeriodo} disabled={savingPeriodo}
                className="px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 hover:text-white transition-all disabled:opacity-40 flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider shrink-0">
                {savingPeriodo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </button>
              {(dataInicioLocal || dataFimLocal) && (
                <button onClick={() => { setDataInicioLocal(''); setDataFimLocal(''); updatePipeline({ data_inicio: null, prazo_edicao: null }); }}
                  className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-all shrink-0" title="Limpar período">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Status do período — countdown */}
          {countdown ? (
            <div className={`rounded-xl px-4 py-3 border flex items-center gap-4 ${
              countdown.fase === 'encerrado' ? 'bg-rose-500/10 border-rose-500/20' :
              countdown.fase === 'agendado'  ? 'bg-violet-500/10 border-violet-500/20' :
                                               'bg-emerald-500/10 border-emerald-500/20'
            }`}>
              {countdown.fase === 'encerrado' ? (
                <>
                  <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                  <div>
                    <p className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Período Encerrado</p>
                    <p className="text-[10px] text-slate-500">Edição da gerência finalizada</p>
                  </div>
                </>
              ) : (
                <>
                  <Timer className={`w-4 h-4 shrink-0 animate-pulse ${countdown.fase === 'agendado' ? 'text-violet-400' : 'text-emerald-400'}`} />
                  <div className="flex-1">
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${countdown.fase === 'agendado' ? 'text-violet-400' : 'text-emerald-400'}`}>
                      {countdown.fase === 'agendado' ? 'Abre em' : 'Fecha em'}
                    </p>
                    <div className="flex gap-3">
                      {[{ v: countdown.d, l: 'd' }, { v: countdown.h, l: 'h' }, { v: countdown.m, l: 'm' }, { v: countdown.s, l: 's' }].map(({ v, l }) => (
                        <div key={l} className="flex items-baseline gap-0.5">
                          <span className="text-sm font-black text-white tabular-nums">{String(v).padStart(2,'0')}</span>
                          <span className="text-[9px] text-slate-500 font-bold">{l}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {pipelineConfig?.data_inicio && pipelineConfig?.prazo_edicao && (
                    <p className="text-[10px] text-slate-500 shrink-0">
                      {new Date(pipelineConfig.data_inicio).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}
                      {' → '}
                      {new Date(pipelineConfig.prazo_edicao).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })}
                    </p>
                  )}
                </>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-slate-600 italic">Sem período programado — gerentes editam conforme status individual</p>
          )}

          {/* Seletor de gerente */}
          <div className="space-y-2">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Aplicar para</p>
            <select value={gerenteFilter} onChange={e => setGerenteFilter(e.target.value)}
              className="w-full bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500/50 transition-all">
              <option value="">Todos os Gerentes</option>
              {gerentes.map(g => (
                <option key={g.id} value={g.id}>{g.full_name}</option>
              ))}
            </select>
          </div>

          {/* Ações globais */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button onClick={() => handleForceAll('Em edição')} disabled={forcingAll}
              className="py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 hover:text-white disabled:opacity-40 flex items-center justify-center gap-2">
              {forcingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
              Abrir Edição a Todos
            </button>
            <button onClick={() => handleForceAll('Edição finalizada')} disabled={forcingAll}
              className="py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:text-white disabled:opacity-40 flex items-center justify-center gap-2">
              {forcingAll ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Finalizar Edição a Todos
            </button>
          </div>

        </div>
      )}

      {/* Header com Busca e Ação */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-6 glass-panel p-8 rounded-[2rem] border-white/5 shadow-2xl">
        <div className="flex-1 w-full max-w-md relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-cyan-400 transition-colors" />
          <input 
            type="text" 
            placeholder="Pesquisar condomínio..." 
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 pl-12 pr-6 text-sm text-slate-200 outline-none focus:border-cyan-500/50 transition-all shadow-inner"
          />
        </div>

        {canEdit && (
          <button 
             onClick={() => openEdit()} 
             className="w-full md:w-auto bg-cyan-500 text-slate-950 px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-cyan-400 shadow-xl shadow-cyan-500/20 active:scale-95 transition-all"
          >
            <PlusCircle className="w-5 h-5" /> NOVO CADASTRO
          </button>
        )}
      </div>

      {/* Breadcrumb / Back Button */}
      {selectedGerente && !search && (
        <div className="flex items-center gap-4 animate-fade-in">
          <button 
            onClick={() => setSelectedGerente(null)}
            className="flex items-center gap-2 text-xs font-black text-slate-500 hover:text-cyan-400 uppercase tracking-widest transition-colors group"
          >
            <X className="w-4 h-4 p-0.5 border border-slate-700 rounded group-hover:border-cyan-500/50" />
            Voltar para Gerentes
          </button>
          <div className="h-4 w-px bg-white/10"></div>
          <span className="text-xs font-black text-cyan-400 uppercase tracking-[0.2em]">
            Carteira: {selectedGerente}
          </span>
        </div>
      )}

      {/* Grid de Condomínios */}
      {loadingCondos ? (
        <div className="p-24 text-center">
           <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
           <p className="text-[10px] font-black text-slate-600 uppercase tracking-widest">Sincronizando Base...</p>
        </div>
      ) : (
        <div className="space-y-12">
          {(() => {
            const isSupervisor = ['master', 'supervisor_gerentes', 'supervisora', 'supervisora_contabilidade'].includes(user?.role);
            
            if (isSupervisor && !search) {
              // Agrupar por gerente
              const groups = filtered.reduce((acc, c) => {
                const gName = c.gerente_name || 'Sem Gerente';
                if (!acc[gName]) acc[gName] = [];
                acc[gName].push(c);
                return acc;
              }, {});

              if (!selectedGerente) {
                // Mostrar lista de Gerentes
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {Object.entries(groups).sort(([a],[b]) => a.localeCompare(b)).map(([gName, condos]) => (
                      <button 
                        key={gName}
                        onClick={() => setSelectedGerente(gName)}
                        className="glass-panel p-8 rounded-[2.5rem] border-white/5 hover:border-cyan-500/30 transition-all group text-left flex flex-col gap-6 shadow-xl hover:-translate-y-1"
                      >
                        <div className="w-16 h-16 bg-slate-950 rounded-3xl flex items-center justify-center border border-white/5 group-hover:scale-110 transition-transform shadow-inner">
                           <User className="w-7 h-7 text-violet-400 group-hover:text-cyan-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-white uppercase tracking-wider mb-2 leading-tight group-hover:text-cyan-400 transition-colors">
                            {gName}
                          </h3>
                          <div className="flex items-center gap-2 text-slate-500">
                             <Building className="w-3 h-3" />
                             <span className="text-[10px] font-bold uppercase tracking-widest">{condos.length} Condomínios</span>
                          </div>
                        </div>
                        <div className="mt-auto pt-4 flex items-center gap-2 text-cyan-500/50 group-hover:text-cyan-400 text-[10px] font-black uppercase tracking-widest transition-colors">
                          Acessar Carteira <PlusCircle className="w-3 h-3" />
                        </div>
                      </button>
                    ))}
                  </div>
                );
              }

              // Mostrar condomínios do gerente selecionado
              const condos = groups[selectedGerente] || [];
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {condos.map(c => (
                    <CondoCard key={c.id} c={c} canEdit={canEdit} onEdit={openEdit} onQuickView={handleQuickView} />
                  ))}
                </div>
              );
            }

            // Fallback para visualização simples (com busca ou para gerente)
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filtered.map(c => (
                  <CondoCard key={c.id} c={c} canEdit={canEdit} onEdit={openEdit} onQuickView={handleQuickView} />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          arquivos={arquivoConferencia.arquivos}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutateCondos(); setArquivoConferencia(null); }}
        />
      )}

      {/* Modal de Cadastro/Edição */}
      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setModalOpen(false)}></div>
          <div className="glass-panel max-w-xl w-full rounded-[2.5rem] relative animate-fade-up border border-white/10 shadow-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-8 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-2xl font-black text-white uppercase tracking-tighter">
                {formData.id ? 'Ajustar Cadastro' : 'Novo Condomínio'}
              </h3>
              <button onClick={() => setModalOpen(false)} className="p-2 text-slate-500 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="p-8 space-y-6 overflow-y-auto">
              <div className="space-y-2">
                <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Nome do condomínio</label>
                <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                       className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Dia de Vencimento</label>
                  <input type="number" min="1" max="31" value={formData.due_day} onChange={e => setFormData({...formData, due_day: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Carteira / Assistente</label>
                  <input value={formData.assistente} onChange={e => setFormData({...formData, assistente: e.target.value})}
                         className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner" />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Gerente Responsável</label>
                  <select required value={formData.gerente_id} onChange={e => setFormData({...formData, gerente_id: e.target.value})}
                          className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner cursor-pointer">
                    <option value="">Selecione um gerente...</option>
                    {gerentes.map(g => (
                      <option key={g.id} value={g.id}>{g.full_name}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 font-black uppercase tracking-[0.2em] ml-1">Nível de Aprovação (Fluxo)</label>
                  <select required value={formData.fluxo} onChange={e => setFormData({...formData, fluxo: Number(e.target.value)})}
                          className="w-full bg-slate-950/50 border border-white/5 rounded-2xl p-4 text-sm text-slate-200 outline-none focus:border-cyan-500 shadow-inner cursor-pointer">
                    <option value={1}>Nível 1 - Fração (Gerente ➔ Sp. Contabilidade)</option>
                    <option value={2}>Nível 2 - Sem consumos (Supervisora Direto)</option>
                    <option value={3}>Nível 3 - Terceirizadas (Gerente ➔ Sup. Gerentes ➔ Sp. Contabilidade)</option>
                  </select>
                </div>
              </div>
              
              <div className="pt-6">
                <button type="submit" disabled={isSaving} className="w-full py-5 bg-cyan-500 text-slate-950 font-black rounded-2xl hover:bg-cyan-400 transition-all uppercase tracking-[0.2em] text-xs shadow-2xl shadow-cyan-500/20 flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
                  {formData.id ? 'SALVAR ALTERAÇÕES' : 'EFETIVAR CADASTRO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Componente Card para evitar repetição
function CondoCard({ c, canEdit, onEdit, onQuickView }) {
  return (
    <div className="glass-panel p-6 rounded-[2rem] border-white/5 hover:border-cyan-500/30 transition-all group shadow-xl flex flex-col justify-between h-full">
        <div>
           <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-slate-950 rounded-2xl flex items-center justify-center border border-white/5 group-hover:scale-105 transition-transform shadow-inner">
                 <Building className="w-6 h-6 text-slate-500 group-hover:text-cyan-400" />
              </div>
              {canEdit && (
                <button onClick={() => onEdit(c)} className="p-3 bg-white/5 hover:bg-cyan-500/10 text-slate-500 hover:text-cyan-400 rounded-xl transition-all border border-transparent hover:border-cyan-500/20">
                   <Pencil className="w-4 h-4" />
                </button>
              )}
           </div>
           
           <h3 className="text-xl font-black text-white uppercase tracking-tight mb-6 leading-tight group-hover:text-cyan-400 transition-colors">
              {c.name}
           </h3>
           
           <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-slate-400">
                 <User className="w-4 h-4 text-violet-400" />
                 <span className="text-xs font-bold">{c.gerente_name || 'Gerente não definido'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                 <Calendar className="w-4 h-4 text-cyan-500" />
                 <span className="text-xs font-bold">Vencimento: Dia {c.due_day || '—'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                 <ShieldCheck className="w-4 h-4 text-emerald-500" />
                 <span className="text-xs font-bold">Carteira: {c.assistente || 'Padrão'}</span>
              </div>
           </div>
        </div>

        <div className="pt-6 border-t border-white/5 flex gap-2">
           <button onClick={() => onQuickView(c.id)} className="p-3 bg-violet-500/10 hover:bg-violet-500 text-violet-400 hover:text-slate-950 rounded-xl transition-all border border-violet-500/20 shadow-lg shadow-violet-500/10" title="Visualizar Emissão"><Eye className="w-4 h-4" /></button>
           <Link href={`/condominio/${c.id}/arrecadacoes`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Planilha</Link>
           <Link href={`/condominio/${c.id}/cobrancas`} className="flex-1 py-3 text-center bg-white/5 hover:bg-white/10 text-[10px] font-black text-slate-400 hover:text-white rounded-xl uppercase tracking-widest transition-all">Extras</Link>
        </div>
    </div>
  );
}
