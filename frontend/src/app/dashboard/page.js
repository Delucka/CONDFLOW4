'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt,
  AlertCircle, Eye, ShieldCheck, MessageSquare, Send, Loader2,
  FileCheck, User, Activity, Zap, Lock, Unlock, Timer, TrendingUp,
  ClipboardList, CalendarClock, BarChart3, ChevronRight, ArrowUpDown
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import FilaOcorrencias from '@/app/central-emissoes/components/FilaOcorrencias';
import { SkeletonTable } from '@/components/Skeleton';

const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function useCountdown(pipelineConfig) {
  const [countdown, setCountdown] = useState(null);

  useEffect(() => {
    if (!pipelineConfig) return;
    const tick = () => {
      const agora = Date.now();
      const ini = pipelineConfig.data_inicio ? new Date(pipelineConfig.data_inicio).getTime() : null;
      const fim = pipelineConfig.prazo_edicao ? new Date(pipelineConfig.prazo_edicao).getTime() : null;
      if (!fim) { setCountdown(null); return; }
      const diffIni = ini ? ini - agora : -1;
      const diffFim = fim - agora;
      if (diffIni > 0) {
        const total = diffIni;
        const d = Math.floor(total / 86400000);
        const h = Math.floor((total % 86400000) / 3600000);
        const m = Math.floor((total % 3600000) / 60000);
        const s = Math.floor((total % 60000) / 1000);
        setCountdown({ fase: 'agendado', d, h, m, s });
      } else if (diffFim > 0) {
        const total = diffFim;
        const d = Math.floor(total / 86400000);
        const h = Math.floor((total % 86400000) / 3600000);
        const m = Math.floor((total % 3600000) / 60000);
        const s = Math.floor((total % 60000) / 1000);
        setCountdown({ fase: 'ativo', d, h, m, s });
      } else {
        setCountdown({ fase: 'encerrado' });
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [pipelineConfig]);

  return countdown;
}

function PipelineWidget({ processos, condosTotal, pipelineConfig, countdown }) {
  const { emEdicao, finalizado, enviado, semProc, total } = useMemo(() => {
    const procs = Object.values(processos);
    const emEdicao   = procs.filter(p => ['Em edição', 'Solicitar alteração'].includes(p.status)).length;
    const finalizado = procs.filter(p => p.status === 'Edição finalizada').length;
    const enviado    = procs.filter(p => ['Enviado', 'Em aprovação', 'Aprovado', 'Emitido'].includes(p.status)).length;
    return {
      emEdicao,
      finalizado,
      enviado,
      semProc: condosTotal - emEdicao - finalizado - enviado,
      total: condosTotal || 1,
    };
  }, [processos, condosTotal]);

  const faseColor = {
    agendado:  { bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  text: 'text-violet-400', dot: 'bg-violet-400' },
    ativo:     { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-400', dot: 'bg-emerald-400 animate-pulse' },
    encerrado: { bg: 'bg-rose-500/10',    border: 'border-rose-500/30',    text: 'text-rose-400',    dot: 'bg-rose-400' },
  };
  const fase = countdown?.fase || (pipelineConfig?.prazo_edicao ? 'encerrado' : null);
  const style = fase ? faseColor[fase] : faseColor.ativo;

  const prazoFmt = pipelineConfig?.prazo_edicao
    ? new Date(pipelineConfig.prazo_edicao).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : null;
  const iniFmt = pipelineConfig?.data_inicio
    ? new Date(pipelineConfig.data_inicio).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : null;

  return (
    <div className={`${style.bg} border ${style.border} rounded-3xl p-5 flex flex-col gap-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${style.dot}`} />
          <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${style.text}`}>
            {fase === 'agendado' ? 'Período Agendado' : fase === 'ativo' ? 'Período Ativo' : fase === 'encerrado' ? 'Período Encerrado' : 'Pipeline de Edição'}
          </span>
        </div>
        <Link href="/condominios" className={`flex items-center gap-1 text-[10px] font-black uppercase tracking-wider ${style.text} hover:opacity-70 transition-opacity`}>
          Configurar <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      {countdown && fase !== 'encerrado' && (
        <div className="grid grid-cols-4 gap-2">
          {[
            { v: countdown.d, l: 'dias' },
            { v: countdown.h, l: 'horas' },
            { v: countdown.m, l: 'min' },
            { v: countdown.s, l: 'seg' },
          ].map(({ v, l }) => (
            <div key={l} className="bg-slate-100 rounded-2xl p-3 text-center border border-slate-200">
              <p className={`text-2xl font-black ${style.text} tabular-nums`}>{String(v).padStart(2, '0')}</p>
              <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">{l}</p>
            </div>
          ))}
        </div>
      )}

      {(iniFmt || prazoFmt) && (
        <div className="flex items-center gap-4 text-[10px] text-slate-500 font-bold">
          {iniFmt && <span className="flex items-center gap-1"><CalendarClock className="w-3 h-3" /> De {iniFmt}</span>}
          {prazoFmt && <span className="flex items-center gap-1"><Timer className="w-3 h-3" /> Até {prazoFmt}</span>}
        </div>
      )}

      {/* Barra de progresso dos status */}
      <div className="space-y-2">
        <div className="flex items-center gap-1 h-2 rounded-full overflow-hidden bg-slate-100">
          {emEdicao   > 0 && <div title="Em edição"   className="bg-amber-500 h-full transition-all" style={{ width: `${(emEdicao/total)*100}%` }} />}
          {finalizado > 0 && <div title="Finalizado"  className="bg-rose-500 h-full transition-all"  style={{ width: `${(finalizado/total)*100}%` }} />}
          {enviado    > 0 && <div title="Em fluxo"    className="bg-emerald-500 h-full transition-all" style={{ width: `${(enviado/total)*100}%` }} />}
          {semProc    > 0 && <div title="Sem processo" className="bg-slate-200 h-full transition-all" style={{ width: `${(semProc/total)*100}%` }} />}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1 text-[9px] text-amber-400 font-bold"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Em edição ({emEdicao})</span>
          <span className="flex items-center gap-1 text-[9px] text-rose-400 font-bold"><span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Finalizado ({finalizado})</span>
          <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-bold"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Em fluxo ({enviado})</span>
          {semProc > 0 && <span className="flex items-center gap-1 text-[9px] text-slate-500 font-bold"><span className="w-2 h-2 rounded-full bg-slate-200 inline-block" /> Sem processo ({semProc})</span>}
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [filtroGerente, setFiltroGerente] = useState('');
  const [mesEmissao, setMesEmissao] = useState(MES_ATUAL);
  const [ordemAsc, setOrdemAsc] = useState(true);

  // Persiste o mês escolhido: mantém ao sair/voltar; só muda quando o usuário troca
  useEffect(() => { const v = parseInt(localStorage.getItem('dash_mes') || '', 10); if (v >= 1 && v <= 12) setMesEmissao(v); }, []);
  useEffect(() => { try { localStorage.setItem('dash_mes', String(mesEmissao)); } catch {} }, [mesEmissao]);

  const { user } = useAuth();
  const supabase = createClient();
  const { addToast } = useToast();

  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const dashParams = new URLSearchParams();
  if (filtroGerente) dashParams.set('gerente_id', filtroGerente);
  dashParams.set('mes', String(mesEmissao));
  dashParams.set('ano', String(ANO_ATUAL));
  const { data, error, isLoading, mutate } = useSWR(`/api/dashboard?${dashParams.toString()}`, apiFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
    keepPreviousData: true,
    errorRetryCount: 4,
    errorRetryInterval: 4000,   // aguenta o cold start: re-tenta enquanto a função "esquenta"
  });

  // Single source: tudo vem do endpoint /api/dashboard agora
  const pipelineConfig      = data?.pipeline_config || null;
  const emissaoStats        = data?.emissao_stats   || { gerente: 0, supGerente: 0, supContabilidade: 0, aguardando: 0, registrada: 0 };
  const emissaoByCondominio = data?.emissao_by_condo || {};
  const countdown           = useCountdown(pipelineConfig);

  // Realtime: invalida o cache SWR quando emissoes_pacotes muda
  useEffect(() => {
    const channel = supabase.channel(`dash-realtime-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emissoes_pacotes' }, () => mutate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'processos' },         () => mutate())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pipeline_config' },   () => mutate())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [mutate, supabase]);

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData } = await supabase
        .from('emissoes_arquivos').select('*').eq('condominio_id', condoId)
        .order('criado_em', { ascending: false }).limit(1).maybeSingle();
      let allFiles = [];
      let signedUrl = null;
      let pacote = null;
      if (fileData) {
        if (fileData.pacote_id) {
          const { data: arquivos } = await supabase.from('emissoes_arquivos').select('*').eq('pacote_id', fileData.pacote_id);
          allFiles = arquivos || [];
          const { data: p } = await supabase.from('emissoes_pacotes').select('id, status, nivel_aprovacao, processo_id, mes_referencia, ano_referencia, eh_retificacao, comentario_correcao, correcao_arquivo_url, correcao_arquivo_nome, resposta_correcao_comentario, resposta_correcao_arquivo_url, resposta_correcao_arquivo_nome, resposta_correcao_em').eq('id', fileData.pacote_id).maybeSingle();
          pacote = p;
        } else {
          allFiles = [fileData];
        }
        const { data: urlData } = await supabase.storage.from('emissoes').createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }
      setArquivoConferencia({
        id: fileData?.id || null,
        nome: fileData?.arquivo_nome || 'Documento',
        url: signedUrl,
        condominio_id: condoId,
        processo_id: pacote?.processo_id || fileData?.processo_id || null,
        pacote_id: pacote?.id || null,
        pacote_status: pacote?.status || null,
        pacote_nivel: pacote?.nivel_aprovacao || null,
        comentario_correcao: pacote?.comentario_correcao || null,
        correcao_arquivo_url: pacote?.correcao_arquivo_url || null,
        correcao_arquivo_nome: pacote?.correcao_arquivo_nome || null,
        resposta_correcao_comentario: pacote?.resposta_correcao_comentario || null,
        resposta_correcao_arquivo_url: pacote?.resposta_correcao_arquivo_url || null,
        resposta_correcao_arquivo_nome: pacote?.resposta_correcao_arquivo_nome || null,
        resposta_correcao_em: pacote?.resposta_correcao_em || null,
        mes: pacote?.mes_referencia,
        ano: pacote?.ano_referencia,
        eh_retificacao: pacote?.eh_retificacao || false,
        arquivos: allFiles,
      });
    } catch (err) {
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      addToast(action === 'approve' ? 'Processo aprovado!' : 'Correção solicitada!', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      mutate();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  if (error && !data) {   // só bloqueia se NÃO houver nenhum dado (com cache, mostra os dados e revalida em silêncio)
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
        <h3 className="text-xl font-bold text-slate-900 mb-2">Erro de Conexão</h3>
        <p className="text-slate-400 mb-6">Não foi possível carregar os dados do painel. O servidor pode estar iniciando — tente de novo em alguns segundos.</p>
        <button onClick={() => mutate()} className="px-6 py-2 bg-violet-600 text-white rounded-xl font-bold">TENTAR NOVAMENTE</button>
      </div>
    );
  }

  const stats    = data?.stats    || { total: 0, em_edicao: 0, pendentes: 0, aprovados: 0 };
  const condos   = data?.condos   || [];
  const gerentes = data?.gerentes || [];
  const gerenteNomePorId = {};
  gerentes.forEach(g => { gerenteNomePorId[g.id] = g.profiles?.full_name || g.nome || null; });

  // Ordena por número do condomínio (prefixo do nome, ex: "411 - ...") asc/desc
  const condosOrdenados = useMemo(() => {
    const codeOf = (n) => { const m = String(n || '').match(/^\s*0*(\d+)/); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; };
    return [...condos].sort((a, b) => ordemAsc ? codeOf(a.name) - codeOf(b.name) : codeOf(b.name) - codeOf(a.name));
  }, [condos, ordemAsc]);
  const processos = data?.processos || {};

  const pendingProcesses = useMemo(() => {
    if (!data?.processos) return [];
    const out = [];
    for (const condoId of Object.keys(data.processos)) {
      const proc = data.processos[condoId];
      if (["Enviado", "Em aprovação"].includes(proc.status)) {
        out.push({ ...proc, condo: condos.find(c => c.id === condoId) });
      }
    }
    return out;
  }, [data?.processos, condos]);

  return (
    <div className="animate-fade-in w-full h-full relative space-y-4 pb-12">

      {/* ── TOPO: Tabela Situação Semestral + Fila de Conferência ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Tabela de Condomínios (Esquerda - 2/3) */}
        <div className="lg:col-span-2 glass-panel rounded-xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="border-l-2 border-violet-500 pl-3">
              <h3 className="text-xs font-black text-slate-900 leading-none uppercase tracking-tight">Situação Semestral</h3>
              <p className="text-[9px] uppercase tracking-widest text-violet-400 font-bold mt-1">
                {data?.year || ANO_ATUAL} · {data?.semester === 1 ? '1º' : '2º'} Semestre
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 w-full sm:w-auto">
              {/* Mês da emissão */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter shrink-0">Emissão de:</label>
                <select
                  value={mesEmissao}
                  onChange={(e) => setMesEmissao(Number(e.target.value))}
                  className="text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-violet-500 transition-all cursor-pointer flex-1 min-w-0 max-w-full sm:flex-none"
                >
                  {MESES.slice(1).map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}/{ANO_ATUAL}</option>
                  ))}
                </select>
              </div>
              {/* Filtro por gerente (oculto pro próprio gerente) */}
              {user?.role !== 'gerente' && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter shrink-0">Gerente:</label>
                  <select
                    value={filtroGerente}
                    onChange={(e) => setFiltroGerente(e.target.value)}
                    className="text-xs bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-800 outline-none focus:border-violet-500 transition-all cursor-pointer flex-1 min-w-0 max-w-full sm:flex-none"
                  >
                    <option value="">TODOS</option>
                    {gerentes.map((g) => (
                      <option key={g.id} value={g.id}>{g.profiles?.full_name || g.nome || '—'}{!g.profile_id && !g.profiles && g.nome ? ' (sem login)' : ''}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="p-6">
              <SkeletonTable rows={8} cols={4} />
            </div>
          ) : condos.length > 0 ? (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-[9px] uppercase tracking-widest font-black text-slate-500">
                    <th className="px-4 py-2.5">
                      <button onClick={() => setOrdemAsc(v => !v)}
                        className="inline-flex items-center gap-1 hover:text-violet-600 transition-colors uppercase tracking-widest"
                        title={ordemAsc ? 'Ordem: menor → maior (clique para inverter)' : 'Ordem: maior → menor (clique para inverter)'}>
                        Condomínio <ArrowUpDown className="w-3 h-3" />
                        <span className="text-[8px] text-violet-500 font-black">{ordemAsc ? '↑' : '↓'}</span>
                      </button>
                    </th>
                    <th className="px-3 py-2.5">Planilha</th>
                    <th className="px-3 py-2.5">Emissão</th>
                    <th className="px-4 py-2.5 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-slate-200">
                  {condosOrdenados.map((c) => {
                    const proc         = processos[c.id];
                    const procStatus   = proc?.status || null;
                    const emissaoStatus = emissaoByCondominio[c.id] || null;
                    const isLocked     = procStatus === 'Edição finalizada';

                    return (
                      <tr key={c.id} className="hover:bg-slate-100 transition-colors group">
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {isLocked
                              ? <Lock    className="w-3 h-3 text-rose-500 shrink-0" />
                              : <Unlock  className="w-3 h-3 text-emerald-500/50 shrink-0" />
                            }
                            <div>
                              <p className="font-bold text-slate-800 group-hover:text-violet-400 transition-colors uppercase tracking-tight text-[11px]">{c.name}</p>
                              <p className="text-[10px] text-slate-500 font-medium flex items-center gap-1.5 flex-wrap">
                                <span>{gerenteNomePorId[c.gerente_id] || c.gerente_name || '—'}</span>
                                {c.due_day && <span className="text-slate-400">· venc. dia {c.due_day}{c.due_day_2 ? ` e ${c.due_day_2}` : ''}</span>}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          {procStatus
                            ? <StatusBadge status={procStatus} flow="processo" />
                            : <span className="text-[10px] text-slate-400 font-bold">—</span>
                          }
                        </td>
                        <td className="px-3 py-2">
                          {emissaoStatus
                            ? <StatusBadge status={emissaoStatus} flow="emissao" />
                            : <span className="text-[10px] text-slate-400 font-bold">—</span>
                          }
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 justify-end">
                            <Link href={`/condominio/${c.id}/arrecadacoes`} className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500 hover:text-slate-950 transition-all" title="Arrecadações"><Layers className="w-3 h-3" /></Link>
                            <Link href={`/condominio/${c.id}/cobrancas`}    className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500 hover:text-slate-950 transition-all" title="Cobranças"><Receipt className="w-3 h-3" /></Link>
                            <button onClick={() => handleQuickView(c.id)}   className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400 hover:bg-violet-500 hover:text-slate-950 transition-all" title="Ver Info"><Eye className="w-3 h-3" /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-20 text-center flex-1">
              <Inbox className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-700 font-bold">Nenhum condomínio encontrado</p>
            </div>
          )}
        </div>

        {/* Fila de Ocorrências */}
        <div className="h-full">
          <FilaOcorrencias />
        </div>

      </div>

      {/* ── BASE: Stats Principais ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Total Condomínios"  value={stats.total}            icon={Building}   color="cyan"    loading={isLoading} />
        <StatsCard title="Em Edição"          value={stats.em_edicao}        icon={FileEdit}   color="orange"  loading={isLoading} />
        <StatsCard title="Aguard. Registro"   value={emissaoStats.aguardando} icon={Clock}      color="emerald" loading={isLoading} />
        <StatsCard title="Emissão Registrada" value={emissaoStats.registrada} icon={FileCheck}  color="blue"    loading={isLoading} />
      </div>

      {/* ── BASE: Emissões em Andamento ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Emissões em Andamento</h4>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatsCard title="Com o Gerente"    value={emissaoStats.gerente}           icon={User}       color="indigo" loading={isLoading} />
          <StatsCard title="Sup. Gerentes"    value={emissaoStats.supGerente}        icon={Activity}   color="cyan"   loading={isLoading} />
          <StatsCard title="Sup. Contab."     value={emissaoStats.supContabilidade}  icon={ShieldCheck} color="orange" loading={isLoading} />
        </div>
      </div>

      {arquivoConferencia && (
        <VisualizadorConferencia
          arquivo={arquivoConferencia}
          arquivos={arquivoConferencia.arquivos}
          currentUser={user}
          onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutate(); setArquivoConferencia(null); }}
        />
      )}

      {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-md" onClick={() => setShowRejectModal(null)} />
          <div className="glass-panel max-w-lg w-full p-10 rounded-[2.5rem] relative animate-fade-up border border-slate-200 shadow-3xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-14 h-14 bg-rose-500/20 border border-rose-500/30 rounded-2xl flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-rose-400" />
              </div>
              <div>
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Solicitar Ajuste</h3>
                <p className="text-[10px] text-rose-400 font-black uppercase tracking-widest mt-1">Devolução p/ Emissor</p>
              </div>
            </div>
            <p className="text-slate-400 text-sm font-medium mb-6">
              Descreva o motivo da devolução para <strong>{showRejectModal.condo?.name || 'o condomínio'}</strong>.
            </p>
            <textarea
              autoFocus
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4}
              className="w-full bg-white border border-slate-200 rounded-2xl p-5 text-sm text-slate-800 focus:border-rose-500 outline-none transition-all placeholder:text-slate-700 mb-8 shadow-inner"
              placeholder="Ex: Valor da taxa condominial não condiz com a ata..."
            />
            <div className="flex gap-4">
              <button onClick={() => setShowRejectModal(null)} className="flex-1 py-4 text-xs font-black text-slate-600 uppercase tracking-widest hover:text-slate-900 transition-colors">Cancelar</button>
              <button
                disabled={!rejectReason || processing}
                onClick={() => handleAction(showRejectModal.id, 'reject', rejectReason)}
                className="flex-2 py-4 bg-rose-500 hover:bg-rose-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all shadow-2xl shadow-rose-500/30 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50"
              >
                {processing === showRejectModal.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} ENVIAR CORREÇÃO
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
