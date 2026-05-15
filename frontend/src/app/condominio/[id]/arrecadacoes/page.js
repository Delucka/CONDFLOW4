'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { apiPost, apiFetch } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import StatusBadge from '@/components/StatusBadge';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  Save, Lock, ArrowLeft, PlusCircle, X, Search,
  ChevronDown, Layers, Building, Calendar, Info,
  Printer, Send, Trash2, CheckCircle2, Settings, Timer
} from 'lucide-react';
import Link from 'next/link';
import { usePipelineConfig } from '@/lib/usePipelineConfig';
import ModalSelecionarConta from '@/components/ModalSelecionarConta';
import { useLockedMonths, reasonLabel } from '@/lib/useLockedMonths';

const MESES = {
    1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho', 
    7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro' 
};

export default function ArrecadacoesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { addToast } = useToast();

  const condoId = params.id;
  const urlAno = searchParams.get('ano');
  const selectedYear = urlAno ? parseInt(urlAno) : new Date().getFullYear();

  const [condo, setCondo] = useState(null);
  const [processo, setProcesso] = useState(null);
  const [rateios, setRateios] = useState([]);
  const [rateiosVals, setRateiosVals] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [obsEmissao, setObsEmissao] = useState('');
  
  // Modals / Overlays
  const [showContaDropdown, setShowContaDropdown] = useState(null);  // guarda o rateio_id em edição
  const [showConfirmSend, setShowConfirmSend] = useState(false);
  const [editingRateioId, setEditingRateioId] = useState(null);

  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);

  const supabase = useMemo(() => createClient(), []);

  // Pipeline config — prazo de edição com verificação em tempo real
  const { config: pipelineConfig } = usePipelineConfig(selectedYear);
  const agora = new Date();
  const prazoFim  = pipelineConfig?.prazo_edicao ? new Date(pipelineConfig.prazo_edicao) : null;
  const prazoIni  = pipelineConfig?.data_inicio  ? new Date(pipelineConfig.data_inicio)  : null;
  // Período ativo = sem datas definidas (sem restrição) OU dentro do intervalo
  const periodoAtivo = !prazoFim || ((!prazoIni || agora >= prazoIni) && agora <= prazoFim);
  const prazoExpirado = prazoFim && agora > prazoFim;

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const payload = await apiFetch(`/api/condominio/${condoId}/arrecadacoes?ano=${selectedYear}`);
      
      if (payload.condo) {
        let gName = '—';
        if (payload.condo.gerentes?.profiles) {
            gName = Array.isArray(payload.condo.gerentes.profiles) ? payload.condo.gerentes.profiles[0]?.full_name : payload.condo.gerentes.profiles.full_name;
        }
        setCondo({ ...payload.condo, gerente_name: gName });
      }

      setProcesso(payload.processo);
      setObsEmissao(payload.processo?.issue_notes || payload.condo?.obs_emissao || '');
      setRateios(payload.rateios || []);
      setRateiosVals(payload.rateios_vals || {});
      
    } catch (err) {
      console.error(err);
      addToast('Erro ao turbocarregar planilha: ' + err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId, selectedYear]);

  // Lock por mês — passado, etapa 'pronto p/ emitir' ou pacote registrado
  const { isLocked, reasonFor } = useLockedMonths(condoId, selectedYear);

  // Permissão de edição em nível de página (ações gerais como "salvar observações", "adicionar verba")
  // Per-célula adicional: !isLocked(mes)
  const canEdit = user?.role === 'master' || (
    periodoAtivo &&
    user?.role === 'gerente' &&
    (!processo || ['Em edição', 'Solicitar alteração', 'Edição finalizada'].includes(processo?.status))
  );
  
  const isEmissor = ['master', 'emissor'].includes(user?.role);
  
  const handleForceStatus = async (newStatus) => {
      // Optimistic UI - Update instantâneo local
      const previousProcesso = { ...processo };
      setProcesso(prev => ({ ...prev, status: newStatus }));
      
      try {
          const payload = { status: newStatus, year: selectedYear };
          const result = await apiPost(`/api/condominio/${condoId}/processo/force`, payload);
          
          if (result.success && result.processo) {
              setProcesso(result.processo); // sync real com o banco
          }
          addToast(`Puxado para: ${newStatus}`, 'success');
      } catch (err) {
          // Rollback em caso de falha
          setProcesso(previousProcesso);
          addToast('Erro ao atualizar: ' + err.message, 'error');
      }
  };

  // Logic Helpers
  const handleRateioChange = (id, field, value) => {
    setRateios(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  };

  const handleValueChange = (rid, month, value) => {
    setRateiosVals(prev => ({
      ...prev,
      [rid]: { ...prev[rid], [month]: value }
    }));
  };

  const getParcelaBadge = (rateio, m) => {
    if (!rateio.is_parcelado) return null;
    const mesIni = parseInt(rateio.mes_inicio || 1);
    const total = parseInt(rateio.parcela_total || 1);
    const startNum = parseInt(rateio.parcela_inicio || 1);
    
    if (m >= mesIni) {
      const currentLabel = startNum + (m - mesIni);
      if (currentLabel > 0 && currentLabel <= total) {
        return (
          <span className="inline-block text-[8px] font-black text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-1.5 mt-0.5">
            {String(currentLabel).padStart(2, '0')}/{String(total).padStart(2, '0')}
          </span>
        );
      }
    }
    return null;
  };

  const handleAddNew = async () => {
    const { data, error } = await supabase.from('rateios_config').insert({
        condominio_id: condoId,
        nome: 'NOVO RATEIO',
        ordem: rateios.length + 1
    }).select().single();
    
    if (data) {
        setRateios([...rateios, data]);
        addToast('Novo rateio adicionado!');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Remover este rateio permanentemente?')) return;
    
    // Se é um rateio temporário (criado no frontend, ainda não salvo)
    if (String(id).startsWith('temp_')) {
      setRateios(rateios.filter(r => r.id !== id));
      addToast('Rateio removido.');
      return;
    }
    
    // Rateio persistido no banco — deletar do Supabase
    // Primeiro deleta os valores associados
    await supabase.from('rateios_valores').delete().eq('rateio_id', id);
    const { error } = await supabase.from('rateios_config').delete().eq('id', id);
    if (error) {
      console.error('Erro ao excluir rateio:', error);
      addToast('Erro ao excluir: ' + error.message, 'error');
    } else {
      setRateios(rateios.filter(r => r.id !== id));
      addToast('Rateio removido com sucesso.');
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      
      const configUpdates = rateios.map(r => 
        supabase.from('rateios_config').update({
          nome: r.nome,
          conta_contabil: r.conta_contabil,
          conta_nome: r.conta_nome,
          conta_analise_fin: r.conta_analise_fin,
          conta_analise_nome: r.conta_analise_nome,
          is_parcelado: r.is_parcelado,
          parcela_total: parseInt(r.parcela_total) || 1,
          parcela_inicio: parseInt(r.parcela_inicio) || 1,
          mes_inicio: parseInt(r.mes_inicio) || 1,
          ordem: r.ordem
        }).eq('id', r.id)
      );

      // Coleta todos os valores para batch upsert
      const allValues = [];
      for (const r of rateios) {
        const vals = rateiosVals[r.id] || {};
        for (const m of months) {
          allValues.push({
            rateio_id: r.id,
            month: m,
            ano: selectedYear,
            valor: vals[m] || '0.00'
          });
        }
      }

      // 1. Atualiza as configurações dos rateios
      const results = await Promise.all(configUpdates);
      const hasConfigError = results.find(r => r && r.error);
      if (hasConfigError) throw new Error(hasConfigError.error.message);

      // 2. Salva os valores mensais (Delete + Insert para evitar problemas de constraint/duplicidade)
      const rateioIds = rateios.map(r => r.id);
      
      // Deleta valores existentes para este ano/rateios
      const { error: delErr } = await supabase.from('rateios_valores')
        .delete()
        .in('rateio_id', rateioIds)
        .eq('ano', selectedYear);
      
      if (delErr) throw delErr;

      // Insere os novos valores
      const { error: insErr } = await supabase.from('rateios_valores').insert(allValues);
      if (insErr) throw insErr;

      // Update Process Notes
      if (processo) {
        const { error: procErr } = await supabase.from('processos').update({ issue_notes: obsEmissao }).eq('id', processo.id);
        if (procErr) throw procErr;
      }

      addToast('Planilha salva com sucesso!', 'success');
    } catch (err) {
      addToast('Erro ao salvar algumas informações', 'error');
    } finally {
      setSaving(false);
    }
  };

  const [nivelAprovacao, setNivelAprovacao] = useState(1);

  const handleSend = async () => {
      if (!processo) {
          addToast('Status de processo não iniciado para este semestre', 'warning');
          return;
      }
      
      let initialStatus = 'Aguardando Gerente';
      if (nivelAprovacao === 2) {
          initialStatus = 'Aguardando Supervisora';
      }

      // Salva o nível escolhido no cadastro do condomínio
      await supabase.from('condominios').update({ fluxo: nivelAprovacao }).eq('id', condo.id);

      const { error } = await supabase.from('processos').update({ 
        status: initialStatus
      }).eq('id', processo.id);

      if (!error) {
          setProcesso({ ...processo, status: initialStatus });
          setShowConfirmSend(false);
          addToast(`Conferência enviada para aprovação!`, 'success');
      } else {
          addToast('Erro ao enviar para aprovação: ' + error.message, 'error');
      }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-20 animate-pulse">
        <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 text-xs font-black uppercase tracking-widest">Carregando Planilha...</p>
      </div>
    );
  }

  // Handler do novo modal (plano de contas do Supabase). Recebe o item completo do plano.
  const handleSelectContaItem = (rid, item) => {
      handleRateioChange(rid, 'plano_item_id', item.id);
      handleRateioChange(rid, 'conta_contabil', String(item.codigo_reduzido));
      handleRateioChange(rid, 'conta_nome', item.nome);
      setShowContaDropdown(null);
  };


  return (
    <div className="animate-fade-in w-full h-full pb-20">

      {/* ─── Banner bloqueio em nível de pagina (prazo expirado / status invalido) ─── */}
      {!canEdit && (
        <div className="mb-4 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 animate-fade-in">
          <Lock className="w-4 h-4 shrink-0" />
          <div className="flex-1">
            <p className="text-xs font-black uppercase tracking-widest">
              {prazoExpirado ? 'Prazo de devolução encerrado' : 'Planilha não disponível para edição'}
            </p>
            <p className="text-[11px] text-rose-400/80">
              {prazoExpirado
                ? `Período encerrado em ${prazoFim?.toLocaleString('pt-BR')}.`
                : 'Status atual não permite edição. Entre em contato com o administrador.'}
            </p>
          </div>
        </div>
      )}

      {/* ─── Banner informativo: lock automatico por mês ─── */}
      {canEdit && (
        <div className="mb-4 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-500/5 border border-amber-500/15 text-amber-300/80 animate-fade-in">
          <Lock className="w-3 h-3 shrink-0" />
          <p className="text-[10px] uppercase font-bold tracking-widest">
            Meses passados, com etapa "pronto p/ emitir" ou com emissão registrada ficam <strong>automaticamente bloqueados</strong> e não podem ser alterados.
          </p>
        </div>
      )}

      {/* ─── Banner prazo ativo (informativo para gerentes) ─── */}
      {periodoAtivo && prazoFim && user?.role !== 'master' && (
        <div className="mb-4 flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-amber-500/5 border border-amber-500/20 text-amber-300 animate-fade-in">
          <Timer className="w-4 h-4 shrink-0" />
          <p className="text-[11px]">
            Prazo para devolução da planilha:{' '}
            <span className="font-black">{prazoFim.toLocaleString('pt-BR')}</span>
          </p>
        </div>
      )}

      {/* ─── HEADER PREMIUM ─── */}
      <div className="glass-panel p-6 mb-8 rounded-2xl flex flex-col gap-4">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center w-full gap-4">
            <div className="flex items-center gap-5">
                <div className="w-14 h-14 bg-cyan-500/10 border border-cyan-500/20 rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(34,211,238,0.1)]">
                    <Building className="w-7 h-7 text-cyan-400" />
                </div>
                <div>
                    <h1 className="text-2xl font-black text-white tracking-tight uppercase leading-none">{condo?.name}</h1>
                    <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest flex items-center gap-1 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            Gerente: <span className="text-white">{condo?.gerente_name}</span>
                        </span>
                        <span className="text-[10px] font-black text-cyan-400 uppercase tracking-widest flex items-center gap-1 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                            Vencimento: <span className="text-white">DIA {condo?.due_day}</span>
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black text-slate-500 uppercase mb-1">Referência Anual</span>
                    <select 
                        value={selectedYear}
                        onChange={(e) => router.push(`/condominio/${condoId}/arrecadacoes?ano=${e.target.value}`)}
                        className="bg-slate-900/50 border-white/5 text-sm font-black text-white px-4 py-2 rounded-xl focus:ring-1 focus:ring-cyan-500 outline-none"
                    >
                        {[...Array(6)].map((_, i) => (
                            <option key={i} value={2024 + i}>{2024 + i}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>

        {/* TAB NAVIGATION SIMPLES */}
        <div className="flex justify-between items-end border-t border-white/5 pt-4 mt-2">
            <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                    <button className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg bg-cyan-500 text-slate-900 shadow-[0_0_15px_rgba(34,211,238,0.5)]">
                        Arrecadações
                    </button>
                    <Link href={`/condominio/${condoId}/emissoes`} className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
                        Emissões (Arquivos)
                    </Link>
                </div>
                
                {/* HUD EMISSOR MOVIDO PARA O TOPO */}
                {isEmissor && (
                    <div className="flex items-center gap-2 bg-slate-900/80 p-2 rounded-full border border-white/5 shadow-inner w-max">
                        <span className="text-[9px] font-black uppercase text-slate-500 mr-2 ml-2">Timeline (Emissor):</span>
                        {['Em edição', 'Edição finalizada'].map(st => (
                            <button
                                key={st}
                                onClick={() => handleForceStatus(st)}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-all ${
                                  processo?.status === st
                                    ? st === 'Edição finalizada'
                                      ? 'bg-rose-500 text-white shadow-[0_0_15px_rgba(244,63,94,0.3)]'
                                      : 'bg-cyan-500 text-slate-950 shadow-[0_0_15px_rgba(34,211,238,0.3)]'
                                    : 'text-slate-400 hover:bg-white/5'
                                }`}
                            >
                                {st}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            <StatusBadge status={processo?.status} flow="processo" />
        </div>
      </div>

      {/* ─── GRID SPREADSHEET ─── */}
      <div className="glass-panel rounded-2xl overflow-hidden border-white/5 relative shadow-2xl">
        <div className="overflow-x-auto overflow-y-visible scrollbar-thin">
            <table className="w-full border-collapse">
                <thead className="bg-black/40">
                    <tr>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-white/5 min-w-[200px] sticky left-0 z-30 bg-slate-950/95 backdrop-blur-md">
                            Conta Contábil
                        </th>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-white/5 min-w-[220px] sticky left-[200px] z-30 bg-slate-950/95 backdrop-blur-md">
                            Verbas / Descritivo
                        </th>
                        {months.map(m => (
                            <th key={m} className="px-2 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-white/5 min-w-[120px] bg-black/20">
                                {MESES[m]} / {String(selectedYear).slice(-2)}
                            </th>
                        ))}
                        <th className="px-2 py-4 w-12 bg-black/40"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                    {rateios.map((r) => (
                        <tr key={r.id} className="group hover:bg-white/[0.02] transition-colors relative">
                            {/* COL: CONTA */}
                            <td className="p-2 border-r border-white/5 sticky left-0 z-20 bg-slate-900/90 backdrop-blur-sm group-hover:bg-slate-800 transition-colors shadow-xl relative">
                                <div className="w-full text-left p-2 rounded-lg text-xs">
                                    <div className="text-[10px] font-black text-cyan-400 mb-0.5 truncate" title="Conta Contábil e Nome">
                                        CT. {r.conta_contabil || '—'} {r.conta_nome ? `- ${r.conta_nome}` : ''}
                                    </div>
                                    <div className="text-[9px] font-black text-violet-400 mb-0.5" title="Análise Financeira">
                                        AN. {r.conta_analise_fin || '—'}
                                    </div>
                                </div>
                            </td>

                            {/* COL: VERBA */}
                            <td className="p-3 border-r border-white/5 sticky left-[200px] z-20 bg-slate-900/90 backdrop-blur-sm group-hover:bg-slate-800 transition-colors shadow-2xl">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1">
                                        <input 
                                            value={r.nome}
                                            onChange={e => handleRateioChange(r.id, 'nome', e.target.value)}
                                            className="w-full bg-transparent border-none p-0 text-xs font-black uppercase text-slate-100 placeholder:text-slate-600 focus:ring-0"
                                            placeholder="Ex: Fundo de Obras"
                                        />
                                        <div className="text-[9px] font-bold text-slate-500 truncate mt-1 max-w-[150px]">{r.conta_nome || 'Conta não vinculada'}</div>
                                    </div>
                                    {canEdit && (
                                        <button onClick={() => setEditingRateioId(r.id)} className="p-1.5 text-slate-500 hover:text-cyan-400 bg-slate-800/50 hover:bg-cyan-500/10 rounded-lg transition-all" title="Configurações Avançadas">
                                            <Settings className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                {r.is_parcelado && (
                                    <div className="flex items-center gap-1 mt-2 text-[8px] font-black uppercase tracking-wider text-slate-400">
                                        <Layers className="w-3 h-3 text-cyan-500" />
                                        Parcelado ({r.parcela_inicio}/{r.parcela_total}) a partir do Mês {r.mes_inicio}
                                    </div>
                                )}
                            </td>

                            {/* MONTHS VALUES */}
                            {months.map(m => {
                                const val = rateiosVals[r.id]?.[m] || '0.00';
                                const mesTravado = isLocked(m);
                                const cellDisabled = !canEdit || mesTravado;
                                const reason = reasonFor(m);
                                return (
                                    <td key={m} className={`p-1 border-r border-white/5 min-w-[120px] relative ${mesTravado ? 'bg-rose-500/[0.04]' : ''}`}
                                        title={mesTravado ? `Mês bloqueado: ${reasonLabel(reason)}` : undefined}>
                                        <input
                                            value={val}
                                            onChange={e => handleValueChange(r.id, m, e.target.value)}
                                            disabled={cellDisabled}
                                            className={`w-full text-right bg-transparent border-none text-xs font-bold px-2 py-2 focus:bg-white/5 transition-colors focus:ring-0
                                                ${val === 'PLANILHA' ? 'text-indigo-400 font-black text-center' : 'text-slate-300'}
                                                ${cellDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                                                ${mesTravado ? 'text-rose-300/70' : ''}
                                            `}
                                        />
                                        {mesTravado && (
                                          <span className="absolute top-0.5 right-1 text-[8px] font-black uppercase tracking-tighter text-rose-400/70 pointer-events-none">
                                            <Lock className="w-2.5 h-2.5" />
                                          </span>
                                        )}
                                        <div className="text-center h-4">
                                            {getParcelaBadge(r, m)}
                                        </div>
                                    </td>
                                );
                            })}

                            {/* ACÕES */}
                            <td className="p-2 text-center bg-black/20">
                                <button onClick={() => handleDelete(r.id)} className="text-red-500/60 hover:text-red-400 p-1.5 hover:bg-red-400/10 rounded-lg transition-all" title="Excluir rateio">
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </td>
                        </tr>
                    ))}
                    
                    {/* Botão Adicionar Row */}
                    {canEdit && (
                        <tr>
                            <td colSpan={15} className="p-4 bg-black/40">
                                <button onClick={handleAddNew} className="flex items-center gap-2 px-6 py-2 border-2 border-dashed border-white/10 hover:border-cyan-500/50 rounded-xl text-[10px] font-black text-slate-500 hover:text-cyan-400 transition-all uppercase tracking-widest mx-auto group">
                                    <PlusCircle className="w-5 h-5 group-hover:scale-110 transition-transform" />
                                    Adicionar Nova Verba (Rateio)
                                </button>
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </div>

      {/* ─── FOOTER & SIGNATURES ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mt-10 items-start">
        <div className="lg:col-span-12 glass-panel p-8 rounded-3xl">
            <div className="mb-10">
                <div className="flex items-center gap-2 mb-4">
                    <Info className="w-4 h-4 text-cyan-400" />
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observações de Emissão</span>
                </div>
                <textarea 
                    value={obsEmissao}
                    onChange={e => setObsEmissao(e.target.value)}
                    disabled={!canEdit}
                    rows={4}
                    className="w-full glass-panel bg-black/30 border-white/5 rounded-2xl p-5 text-sm font-medium text-slate-300 shadow-inner focus:border-cyan-500/50 transition-all resize-none"
                    placeholder="Digite observações importantes para a emissão deste semestre..."
                />
            </div>

            {/* ASSINATURAS (LAYOUT PDF) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mt-20 border-t border-white/10 pt-16">
                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-cyan-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Gerente de Carteira</span>
                        </div>
                    </div>
                    <div className="text-lg font-black text-white uppercase tracking-tighter">{condo?.gerente_name}</div>
                    <div className="text-[8px] font-black text-slate-600 mt-1 uppercase tracking-widest italic">Responsável Direto</div>
                </div>

                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-violet-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Validação Administrativa</span>
                        </div>
                    </div>
                    <div className="text-xs font-black text-slate-500 uppercase tracking-widest italic mt-2">Visto em ___/___/___</div>
                </div>

                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-emerald-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-slate-900 px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Entrega / Expedição</span>
                        </div>
                    </div>
                    <div className="flex justify-center gap-2">
                        <div className="w-10 h-10 glass-panel border-white/5 rounded-lg flex items-center justify-center text-slate-500 font-black text-xs">/</div>
                        <div className="w-10 h-10 glass-panel border-white/5 rounded-lg flex items-center justify-center text-slate-500 font-black text-xs">/</div>
                        <div className="w-16 h-10 glass-panel border-white/5 rounded-lg flex items-center justify-center text-slate-500 font-black text-xs">{selectedYear}</div>
                    </div>
                </div>
            </div>

            {/* ACÕES FINAIS */}
            <div className="flex flex-wrap justify-between items-center gap-4 mt-20 pt-8 border-t border-white/5">
                <Link href="/dashboard" className="text-xs font-black text-slate-500 hover:text-white transition-colors uppercase tracking-widest flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
                </Link>


                <div className="flex gap-4">
                    <button className="p-3 text-slate-400 hover:text-white glass-panel hover:bg-white/5 rounded-xl transition-all" title="Imprimir Planilha">
                        <Printer className="w-5 h-5" />
                    </button>
                    
                    {canEdit && (
                        <>
                            <button 
                                onClick={handleSave}
                                disabled={saving}
                                className="px-8 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-black text-white rounded-xl uppercase tracking-widest transition-all shadow-xl flex items-center gap-2"
                            >
                                <Save className="w-4 h-4 text-cyan-400" /> {saving ? 'SALVANDO...' : 'SALVAR RASCUNHO'}
                            </button>

                            <button 
                                onClick={() => setShowConfirmSend(true)}
                                className="px-10 py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-black rounded-xl uppercase tracking-widest transition-all shadow-[0_0_30px_rgba(34,211,238,0.3)] shadow-cyan-500/20 flex items-center gap-2 active:scale-95"
                            >
                                <Send className="w-4 h-4" /> ENVIAR CONFERÊNCIA
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
      </div>

      {/* ─── MODAL EDIÇÃO AVANÇADA DE VERBA ─── */}
      {editingRateioId && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
             <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingRateioId(null)} />
             
             {rateios.filter(r => r.id === editingRateioId).map(r => (
                 <div key={r.id} className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl">
                     <div className="flex justify-between items-center mb-6 pb-4 border-b border-white/10 pr-12">
                         <h4 className="flex items-center gap-2 text-sm font-black text-white uppercase tracking-widest">
                            <Settings className="w-5 h-5 text-cyan-400" />
                            Configurações da Verba
                         </h4>
                         <button 
                             type="button" 
                             onClick={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                                 setEditingRateioId(null);
                             }} 
                             className="absolute top-6 right-6 p-2 bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white rounded-lg transition-all cursor-pointer z-[200]"
                         >
                             <X className="w-5 h-5"/>
                         </button>
                     </div>
                     
                     <div className="grid grid-cols-12 gap-6 mb-6">
                         {/* CONTA CONTABIL */}
                         <div className="col-span-12 md:col-span-8 space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Conta contábil</label>
                             <div className="flex gap-2">
                                <div className="w-1/3">
                                    <input 
                                        value={r.conta_contabil || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_contabil', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-cyan-400 font-black outline-none focus:border-cyan-500" 
                                    />
                                </div>
                                <div className="w-2/3 relative flex items-center">
                                    <input 
                                        value={r.conta_nome || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_nome', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 font-bold outline-none focus:border-cyan-500 pr-10" 
                                    />
                                    <button 
                                        onClick={() => setShowContaDropdown(r.id)}
                                        className="absolute right-2 p-1 text-slate-400 hover:text-cyan-400 bg-slate-700 rounded transition-colors"
                                    >
                                        <Search className="w-4 h-4"/>
                                    </button>
                                </div>
                             </div>
                         </div>
                         
                         {/* CTA ANALISE FINANCEIRA */}
                         <div className="col-span-12 md:col-span-8 space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Cta. análise financ.</label>
                             <div className="flex gap-2">
                                <div className="w-1/3">
                                    <input 
                                        value={r.conta_analise_fin || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_analise_fin', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                    />
                                </div>
                                <div className="w-2/3">
                                    <input 
                                        value={r.conta_analise_nome || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_analise_nome', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 font-bold outline-none focus:border-violet-500" 
                                    />
                                </div>
                             </div>
                         </div>

                         {/* HISTORICO */}
                         <div className="col-span-12 space-y-1">
                             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Histórico / Descritivo (Verba)</label>
                             <input 
                                 value={r.nome || ''}
                                 onChange={e => handleRateioChange(r.id, 'nome', e.target.value)}
                                 className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-sm text-white font-black uppercase outline-none focus:border-cyan-500" 
                             />
                         </div>
                     </div>

                     <div className="pt-6 border-t border-white/5">
                         <h5 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">Configuração de Parcelamento</h5>
                         
                         <label className="flex items-center gap-2 cursor-pointer w-max mb-4">
                            <input 
                                type="checkbox" 
                                checked={r.is_parcelado}
                                onChange={e => handleRateioChange(r.id, 'is_parcelado', e.target.checked)}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-xs font-bold text-slate-300">Cobrar em múltiplas parcelas</span>
                         </label>

                         {r.is_parcelado && (
                             <div className="flex flex-wrap gap-4 items-end bg-black/20 p-4 rounded-xl border border-white/5">
                                 <div>
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Parcela Atual/Inicial</label>
                                     <input 
                                        type="number" min="1"
                                        value={r.parcela_inicio} 
                                        onChange={e => handleRateioChange(r.id, 'parcela_inicio', e.target.value)} 
                                        className="w-24 bg-slate-800 border border-slate-700 rounded p-2 text-sm text-cyan-400 font-black outline-none focus:border-cyan-500" 
                                     />
                                 </div>
                                 <span className="text-xl font-light text-slate-600 self-center pb-2">/</span>
                                 <div>
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total de Parcelas</label>
                                     <input 
                                        type="number" min="1"
                                        value={r.parcela_total} 
                                        onChange={e => handleRateioChange(r.id, 'parcela_total', e.target.value)} 
                                        className="w-24 bg-slate-800 border border-slate-700 rounded p-2 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                     />
                                 </div>
                                 <div className="ml-0 md:ml-4 flex-1">
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Iniciando no Mês</label>
                                     <select 
                                        value={r.mes_inicio} 
                                        onChange={e => handleRateioChange(r.id, 'mes_inicio', e.target.value)}
                                        className="w-full bg-slate-800 border border-slate-700 rounded p-2 text-sm text-slate-200 font-bold outline-none focus:border-cyan-500"
                                     >
                                         {months.map(m => (
                                             <option key={m} value={m}>{MESES[m]}</option>
                                         ))}
                                     </select>
                                 </div>
                             </div>
                         )}
                     </div>

                     <div className="mt-8 flex justify-end gap-3">
                         <button onClick={() => setEditingRateioId(null)} className="px-6 py-2.5 text-xs font-black text-slate-900 bg-cyan-500 hover:bg-cyan-400 rounded-lg uppercase tracking-widest transition-colors shadow-lg shadow-cyan-500/20">
                             Concluído
                         </button>
                     </div>
                 </div>
             ))}
         </div>
      )}

      {/* ─── MODAL SELEÇÃO CONTA CONTÁBIL (novo, vinculado ao plano do condomínio) ─── */}
      {showContaDropdown && (
        <ModalSelecionarConta
          planoId={condo?.plano_contas_id || null}
          selectedId={(rateios.find(r => r.id === showContaDropdown) || {}).plano_item_id}
          onSelect={(item) => handleSelectContaItem(showContaDropdown, item)}
          onClose={() => setShowContaDropdown(null)}
        />
      )}

      {/* ─── MODAL CONFIRMAÇÃO ENVIO ─── */}
      {showConfirmSend && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
              <div className="absolute inset-0 bg-brand-bg/80 backdrop-blur-md" onClick={() => setShowConfirmSend(false)}></div>
              <div className="glass-panel max-w-2xl w-full p-8 rounded-3xl relative animate-fade-up shadow-[0_0_100px_rgba(0,0,0,0.5)] border border-white/5">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 bg-cyan-500/20 border border-cyan-500/30 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.2)]">
                        <Send className="w-8 h-8 text-cyan-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-white uppercase tracking-tight">Enviar para Aprovação</h3>
                        <p className="text-slate-400 text-sm font-medium">Escolha o fluxo de validação deste condomínio.</p>
                    </div>
                  </div>

                  <div className="space-y-3 mb-8">
                      <button
                        onClick={() => setNivelAprovacao(1)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 1 
                            ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10' 
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 1 && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">Nível 1 - Fração</p>
                          <p className="text-[10px] text-gray-400">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                        </div>
                      </button>

                      <button
                        onClick={() => setNivelAprovacao(2)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 2 
                            ? 'border-cyan-500 bg-cyan-500/10 shadow-lg shadow-cyan-500/10' 
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-cyan-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 2 && <div className="w-2 h-2 rounded-full bg-cyan-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">Nível 2 - Sem consumos</p>
                          <p className="text-[10px] text-gray-400">Passa direto para a Supervisora</p>
                        </div>
                      </button>

                      <button
                        onClick={() => setNivelAprovacao(3)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 3 
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' 
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-emerald-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 3 && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-white">Nível 3 - Com empresas terceirizadas</p>
                          <p className="text-[10px] text-gray-400">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                        </div>
                      </button>
                  </div>

                  <div className="flex gap-3">
                      <button 
                        onClick={() => setShowConfirmSend(false)}
                        className="flex-1 py-4 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                      >
                          Cancelar
                      </button>
                      <button 
                        onClick={() => handleSend()}
                        className="flex-[2] py-4 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black uppercase tracking-widest rounded-xl transition-all shadow-[0_0_20px_rgba(34,211,238,0.2)] active:scale-95"
                      >
                          Confirmar Envio
                      </button>
                  </div>

                  <div className="flex justify-between items-center pt-6 border-t border-white/5 mt-6">
                      <p className="text-[10px] text-red-400/80 font-bold uppercase tracking-widest max-w-[250px]">
                        * A planilha será bloqueada para edição após o envio.
                      </p>
                      <button onClick={() => setShowConfirmSend(false)} className="px-6 py-2 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-white transition-colors">Voltar</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
