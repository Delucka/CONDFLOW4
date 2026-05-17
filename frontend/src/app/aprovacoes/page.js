'use client';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  CheckCircle2, AlertCircle, Clock, Search,
  MessageSquare, Building2, Loader2, Send,
  History, Inbox, Eye, ShieldCheck, Filter,
  FileText, Lock, Unlock, Globe, User, Calendar,
  ChevronDown, X, RefreshCw, FileUp, ArrowRight
} from 'lucide-react';
import { usePendingCount } from '@/lib/usePendingCount';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { createClient } from '@/utils/supabase/client';
import StatusBadge from '@/components/StatusBadge';
import Link from 'next/link';

// Cor e ícone por tipo de ação
function getActionStyle(action = '') {
  const a = action.toLowerCase();
  if (a.includes('aprovado') || a.includes('registr'))
    return { color: 'text-emerald-400', bg: 'bg-emerald-500', label: action };
  if (a.includes('correção') || a.includes('alteração') || a.includes('rejeita'))
    return { color: 'text-rose-400', bg: 'bg-rose-500', label: action };
  if (a.includes('edição finalizada') || a.includes('em processo'))
    return { color: 'text-orange-400', bg: 'bg-orange-500', label: action };
  if (a.includes('em edição') || a.includes('aberto'))
    return { color: 'text-cyan-400', bg: 'bg-cyan-500', label: action };
  if (a.includes('global'))
    return { color: 'text-violet-400', bg: 'bg-violet-500', label: action };
  if (a.includes('expedid') || a.includes('lacrad'))
    return { color: 'text-blue-400', bg: 'bg-blue-500', label: action };
  return { color: 'text-slate-400', bg: 'bg-slate-500', label: action };
}

export default function AprovacoesPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const supabase = createClient();

  const [aba, setAba] = useState('fila'); // 'fila' | 'auditoria'
  const { count: minhasPendenciasEmissao } = usePendingCount();
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [arquivoConferencia, setArquivoConferencia] = useState(null);

  // Filtros da auditoria
  const [search, setSearch]       = useState('');
  const [filtroDate, setFiltroDate] = useState({ from: '', to: '' });
  const [showFiltros, setShowFiltros] = useState(false);

  // ── Fila de aprovações ──
  const { data: filaData, error: filaError, isLoading: filaLoading, mutate: mutateF } =
    useSWR('/api/aprovacoes', apiFetcher, { revalidateOnFocus: true, refreshInterval: 30000 });

  // ── Auditoria ──
  const auditParams = new URLSearchParams();
  if (filtroDate.from) auditParams.set('date_from', filtroDate.from);
  if (filtroDate.to)   auditParams.set('date_to',   filtroDate.to);
  auditParams.set('limit', '100');

  const { data: auditData, isLoading: auditLoading, mutate: mutateA } =
    useSWR(aba === 'auditoria' ? `/api/auditoria?${auditParams}` : null, apiFetcher, {
      refreshInterval: 60000
    });

  const logsRaw   = auditData?.logs   || [];
  const totalLogs = auditData?.total  || 0;
  const hojeCount = auditData?.hoje   || 0;

  // Filtro client-side por busca de texto
  const logs = useMemo(() => {
    if (!search.trim()) return logsRaw;
    const s = search.toLowerCase();
    return logsRaw.filter(l =>
      (l.action || '').toLowerCase().includes(s) ||
      (l.comment || '').toLowerCase().includes(s) ||
      (l.approver?.full_name || '').toLowerCase().includes(s) ||
      (l.processo?.condominios?.name || '').toLowerCase().includes(s)
    );
  }, [logsRaw, search]);

  const pendentes = filaData?.pendentes || [];

  // ── Ações de aprovação ──
  const handleAction = async (processoId, action, comment = '') => {
    try {
      setProcessing(processoId);
      await apiPost(`/api/processo/${processoId}/acao`, { action, comment });
      addToast(action === 'approve' ? 'Processo aprovado!' : 'Correção solicitada.', 'success');
      setShowRejectModal(null);
      setRejectReason('');
      mutateF();
    } catch (err) {
      addToast(err.message || 'Erro ao processar ação', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const handleQuickView = async (condoId) => {
    try {
      const { data: fileData } = await supabase
        .from('emissoes_arquivos').select('*')
        .eq('condominio_id', condoId).order('criado_em', { ascending: false }).limit(1).maybeSingle();
      let allFiles = [], signedUrl = null;
      if (fileData) {
        if (fileData.pacote_id) {
          const { data: arquivos } = await supabase.from('emissoes_arquivos').select('*').eq('pacote_id', fileData.pacote_id);
          allFiles = arquivos || [];
        } else {
          allFiles = [fileData];
        }
        const { data: urlData } = await supabase.storage.from('emissoes').createSignedUrl(fileData.arquivo_url, 300);
        signedUrl = urlData?.signedUrl;
      }
      setArquivoConferencia({ id: fileData?.id || null, nome: fileData?.arquivo_nome || 'Documento', url: signedUrl, condominio_id: condoId, processo_id: fileData?.processo_id || null, arquivos: allFiles });
    } catch { addToast('Erro ao abrir prévia.', 'error'); }
  };

  const limparFiltros = () => { setSearch(''); setFiltroDate({ from: '', to: '' }); };
  const temFiltro = search || filtroDate.from || filtroDate.to;

  return (
    <div className="animate-fade-in space-y-6 pb-20">

      {/* ── Header ── */}
      <div className="glass-panel p-7 rounded-[2rem] border border-white/5 shadow-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-5">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tighter italic">Aprovações & Auditoria</h1>
          <p className="text-slate-500 text-xs font-bold tracking-widest mt-1 uppercase">
            Aprovação de planilhas semestrais + Histórico completo do sistema
          </p>
          <p className="text-slate-600 text-[10px] tracking-wider mt-1">
            Aprovação de emissões mensais → <Link href="/central-emissoes" className="text-cyan-400 hover:underline">Central de Emissões → Painel de Gestão</Link>
          </p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white/5 border border-white/10 px-5 py-3 rounded-2xl text-center shadow-inner min-w-[80px]">
            <p className="text-2xl font-black text-white leading-none">{pendentes.length}</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Pendentes</p>
          </div>
          <div className="bg-white/5 border border-white/10 px-5 py-3 rounded-2xl text-center shadow-inner min-w-[80px]">
            <p className="text-2xl font-black text-cyan-400 leading-none">{totalLogs}</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Total logs</p>
          </div>
          <div className="bg-white/5 border border-white/10 px-5 py-3 rounded-2xl text-center shadow-inner min-w-[80px]">
            <p className="text-2xl font-black text-violet-400 leading-none">{hojeCount}</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase mt-1">Hoje</p>
          </div>
        </div>
      </div>

      {/* ── Atalho pra aprovação de emissões (vive no Painel de Gestão) ── */}
      {minhasPendenciasEmissao > 0 && (
        <Link href="/central-emissoes"
          className="block glass-panel p-5 rounded-2xl border border-cyan-500/30 hover:border-cyan-400/50 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all group">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
                <FileUp className="w-6 h-6 text-cyan-400" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Aprovação de emissões</p>
                <p className="text-white font-bold mt-0.5">
                  <span className="text-2xl font-black text-cyan-300">{minhasPendenciasEmissao}</span>
                  <span className="ml-2 text-sm">pacote{minhasPendenciasEmissao !== 1 ? 's' : ''} esperando você no Painel de Gestão</span>
                </p>
              </div>
            </div>
            <div className="text-cyan-400 group-hover:translate-x-1 transition-transform">
              <ArrowRight className="w-6 h-6" />
            </div>
          </div>
        </Link>
      )}

      {/* ── Tabs ── */}
      <div className="flex gap-2 bg-white/[0.03] p-1.5 rounded-2xl border border-white/5 w-fit">
        {[
          { id: 'fila',      label: `Fila de Planilhas${pendentes.length > 0 ? ` (${pendentes.length})` : ''}`, icon: Clock },
          { id: 'auditoria', label: 'Histórico de Atividades', icon: History },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setAba(id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              aba === id ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ABA: FILA DE APROVAÇÕES                                    */}
      {/* ══════════════════════════════════════════════════════════ */}
      {aba === 'fila' && (
        <div className="space-y-4">
          {filaLoading ? (
            <div className="p-24 text-center glass-panel rounded-[2rem]">
              <div className="w-10 h-10 border-4 border-violet-500/20 border-t-violet-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">Carregando fila...</p>
            </div>
          ) : pendentes.length === 0 ? (
            <div className="text-center py-24 glass-panel rounded-[2.5rem] border border-white/5">
              <CheckCircle2 className="w-16 h-16 text-slate-800 mx-auto mb-6" />
              <h3 className="text-xl font-black text-slate-400 uppercase tracking-tighter">Fila Vazia</h3>
              <p className="text-slate-600 text-sm">Todos os processos foram validados com sucesso.</p>
            </div>
          ) : (
            pendentes.map((item) => (
              <div key={item.id} className="glass-panel p-6 rounded-[2rem] border border-white/5 group hover:border-violet-500/30 transition-all flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden shadow-xl">
                <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-violet-700/30 group-hover:bg-violet-500 transition-colors rounded-l-[2rem]" />
                <div className="flex items-center gap-5 flex-1">
                  <div className="w-14 h-14 bg-slate-950 rounded-2xl flex items-center justify-center border border-white/5 shrink-0">
                    <Building2 className="w-6 h-6 text-slate-600 group-hover:text-violet-400 transition-colors" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-3 mb-1.5">
                      <h3 className="text-lg font-black text-white uppercase tracking-tight">{item.condominios?.name}</h3>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{item.year} — {item.semester === 1 ? '1º Semestre' : '2º Semestre'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleQuickView(item.condominio_id)}
                    className="p-3 bg-violet-500/10 hover:bg-violet-500 border border-violet-500/20 rounded-xl text-violet-400 hover:text-white transition-all" title="Visualizar">
                    <Eye className="w-4 h-4" />
                  </button>
                  <Link href={`/condominio/${item.condominio_id}/arrecadacoes?ano=${item.year}`}
                    className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-400 hover:text-white transition-all" title="Planilha">
                    <FileText className="w-4 h-4" />
                  </Link>
                  <button disabled={processing === item.id} onClick={() => setShowRejectModal(item)}
                    className="px-5 py-2.5 bg-transparent hover:bg-rose-500/10 text-rose-500/70 hover:text-rose-400 border border-rose-500/10 hover:border-rose-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50">
                    Corrigir
                  </button>
                  <button disabled={processing === item.id} onClick={() => handleAction(item.id, 'approve')}
                    className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all flex items-center gap-2 disabled:opacity-50">
                    {processing === item.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Aprovar
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ABA: HISTÓRICO DE ATIVIDADES                               */}
      {/* ══════════════════════════════════════════════════════════ */}
      {aba === 'auditoria' && (
        <div className="space-y-4">

          {/* Barra de filtros */}
          <div className="glass-panel p-4 rounded-2xl border border-white/5 space-y-3">
            <div className="flex flex-wrap gap-3 items-center">
              {/* Busca */}
              <div className="flex-1 min-w-[200px] relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar por condomínio, usuário, ação..."
                  className="w-full bg-slate-950/60 border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500/50 transition-all" />
              </div>

              {/* Datas */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 font-black uppercase">De</span>
                <input type="date" value={filtroDate.from} onChange={e => setFiltroDate(p => ({...p, from: e.target.value}))}
                  className="bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500/50 transition-all" />
                <span className="text-[10px] text-slate-500 font-black uppercase">Até</span>
                <input type="date" value={filtroDate.to} onChange={e => setFiltroDate(p => ({...p, to: e.target.value}))}
                  className="bg-slate-950/60 border border-white/5 rounded-xl px-3 py-2.5 text-xs text-slate-200 outline-none focus:border-violet-500/50 transition-all" />
              </div>

              {/* Limpar */}
              {temFiltro && (
                <button onClick={limparFiltros}
                  className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase hover:bg-rose-500/20 transition-all">
                  <X className="w-3.5 h-3.5" /> Limpar
                </button>
              )}
              <button onClick={() => mutateA()}
                className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all" title="Atualizar">
                <RefreshCw className={`w-4 h-4 ${auditLoading ? 'animate-spin' : ''}`} />
              </button>

              <span className="text-[10px] text-slate-600 font-bold ml-auto">
                {logs.length} registro{logs.length !== 1 ? 's' : ''}{temFiltro ? ' (filtrado)' : ''}
              </span>
            </div>
          </div>

          {/* Timeline */}
          {auditLoading ? (
            <div className="p-24 text-center glass-panel rounded-[2rem]">
              <div className="w-10 h-10 border-4 border-violet-500/20 border-t-violet-500 rounded-full animate-spin mx-auto mb-4"></div>
              <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">Carregando histórico...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-20 glass-panel rounded-[2rem] border border-white/5">
              <Inbox className="w-12 h-12 text-slate-800 mx-auto mb-4" />
              <p className="text-slate-500 font-bold">Nenhum registro encontrado</p>
              {temFiltro && <button onClick={limparFiltros} className="mt-3 text-[11px] text-violet-400 hover:text-white">Limpar filtros</button>}
            </div>
          ) : (
            <div className="glass-panel rounded-[2rem] border border-white/5 overflow-hidden">
              {/* Cabeçalho da tabela */}
              <div className="grid grid-cols-[16px_2fr_2fr_1fr_1fr] gap-4 px-6 py-3 border-b border-white/5 bg-white/[0.02]">
                {['', 'Ação', 'Condomínio', 'Usuário', 'Data/Hora'].map((h, i) => (
                  <span key={i} className="text-[9px] font-black text-slate-600 uppercase tracking-widest">{h}</span>
                ))}
              </div>

              {/* Linhas */}
              <div className="divide-y divide-white/5">
                {logs.map((log) => {
                  const style = getActionStyle(log.action);
                  const condo = log.processo?.condominios?.name;
                  const gerente = log.processo?.condominios?.gerentes?.profiles?.full_name;
                  const quem = log.approver?.full_name || '—';
                  const quando = log.created_at ? new Date(log.created_at).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
                  return (
                    <div key={log.id} className="grid grid-cols-[16px_2fr_2fr_1fr_1fr] gap-4 px-6 py-3.5 hover:bg-white/[0.02] transition-colors items-center group">
                      {/* Dot */}
                      <div className={`w-2 h-2 rounded-full ${style.bg} shadow-sm`} />
                      {/* Ação */}
                      <div>
                        <p className={`text-[11px] font-black uppercase tracking-wide ${style.color}`}>{log.action}</p>
                        {log.comment && (
                          <p className="text-[10px] text-slate-500 italic mt-0.5 truncate max-w-xs">&ldquo;{log.comment}&rdquo;</p>
                        )}
                      </div>
                      {/* Condomínio */}
                      <div>
                        <p className="text-[11px] font-bold text-slate-300 truncate">{condo || '—'}</p>
                        {gerente && <p className="text-[10px] text-slate-600 truncate">{gerente}</p>}
                      </div>
                      {/* Usuário */}
                      <div className="flex items-center gap-1.5">
                        <div className="w-5 h-5 rounded-full bg-violet-500/20 flex items-center justify-center shrink-0">
                          <User className="w-3 h-3 text-violet-400" />
                        </div>
                        <span className="text-[11px] text-slate-400 truncate">{quem}</span>
                      </div>
                      {/* Data */}
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-slate-600 shrink-0" />
                        <span className="text-[10px] text-slate-500 tabular-nums">{quando}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Modal Correção ── */}
      {showRejectModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowRejectModal(null)} />
          <div className="glass-panel max-w-lg w-full p-10 rounded-[2.5rem] relative border border-white/10 shadow-3xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-12 h-12 bg-rose-500/20 border border-rose-500/30 rounded-2xl flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white uppercase tracking-tighter">Solicitar Correção</h3>
                <p className="text-[10px] text-rose-400 font-black uppercase tracking-widest mt-0.5">{showRejectModal.condominios?.name}</p>
              </div>
            </div>
            <textarea autoFocus value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={4}
              className="w-full bg-slate-950 border border-white/10 rounded-2xl p-4 text-sm text-slate-200 focus:border-rose-500 outline-none transition-all placeholder:text-slate-700 mb-6 shadow-inner"
              placeholder="Descreva o que precisa ser corrigido..." />
            <div className="flex gap-3">
              <button onClick={() => setShowRejectModal(null)} className="flex-1 py-3.5 text-xs font-black text-slate-600 uppercase tracking-widest hover:text-white transition-colors">Cancelar</button>
              <button disabled={!rejectReason || processing}
                onClick={() => handleAction(showRejectModal.id, 'reject', rejectReason)}
                className="flex-1 py-3.5 bg-rose-500 hover:bg-rose-400 text-white text-xs font-black rounded-2xl uppercase tracking-widest transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                <Send className="w-4 h-4" /> Enviar Correção
              </button>
            </div>
          </div>
        </div>
      )}

      {arquivoConferencia && (
        <VisualizadorConferencia arquivo={arquivoConferencia} arquivos={arquivoConferencia.arquivos}
          currentUser={user} onClose={() => setArquivoConferencia(null)}
          onAction={() => { mutateF(); setArquivoConferencia(null); }} />
      )}
    </div>
  );
}
