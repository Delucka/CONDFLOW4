'use client';
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
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
// Componentes de pacotes/registro (migrados da Central de Emissoes para Aprovacoes)
import VisaoGerente from '@/app/central-emissoes/components/VisaoGerente';
import VisaoMaster from '@/app/central-emissoes/components/VisaoMaster';
import RegistroEmissoes from '@/app/central-emissoes/components/RegistroEmissoes';
import { Package, Archive } from 'lucide-react';

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
  const { user, profile } = useAuth();
  const { addToast } = useToast();
  const supabase = createClient();

  // Quem NAO eh master nem departamento (emissor) ve aqui tambem as abas
  // que antes ficavam na Central de Emissoes (Meus Pacotes + Registro)
  const role = profile?.role;
  const isMaster = role === 'master';
  const isDepartamento = role === 'departamento';
  const isGerente = role === 'gerente';
  const isSupervisor = ['supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'].includes(role);
  const verAbasPacotes = !isMaster && !isDepartamento && (isGerente || isSupervisor);

  const [aba, setAba] = useState('fila'); // 'fila' | 'auditoria' | 'pacotes' | 'registro'

  // Permite abrir uma aba via ?tab=...
  const searchParams = useSearchParams();
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && ['fila', 'auditoria', 'pacotes', 'registro'].includes(t)) setAba(t);
  }, [searchParams]);
  const { count: minhasPendenciasEmissao } = usePendingCount();
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [arquivoConferencia, setArquivoConferencia] = useState(null);

  // Filtros da auditoria
  const [search, setSearch]       = useState('');
  const [filtroDate, setFiltroDate] = useState({ from: '', to: '' });
  const [showFiltros, setShowFiltros] = useState(false);

  // ── Fila de aprovações (processos legados, mantido para retro) ──
  const { data: filaData, error: filaError, isLoading: filaLoading, mutate: mutateF } =
    useSWR('/api/aprovacoes', apiFetcher, { revalidateOnFocus: true, refreshInterval: 30000 });

  // ── Edicoes Mensais (novo ciclo: gerente libera condos do mes alvo) ──
  const { data: edicoesData, isLoading: edicoesLoading, mutate: mutateE } =
    useSWR('/api/edicoes-mensais', apiFetcher, { revalidateOnFocus: false, refreshInterval: 60000 });
  const edicoes = edicoesData?.edicoes || [];
  const edicoesEmEdicao    = edicoes.filter(e => e.status === 'em_edicao');
  const edicoesFinalizadas = edicoes.filter(e => e.status === 'edicao_finalizada');
  const edicoesReaberturas = edicoes.filter(e => e.status === 'reabertura_solicitada');

  // Modal de motivo de reabertura
  const [showReaberturaModal, setShowReaberturaModal] = useState(null); // edicao obj
  const [motivoReabertura, setMotivoReabertura] = useState('');
  const [executandoEdicao, setExecutandoEdicao] = useState(null);

  async function handleLiberar(edicao) {
    setExecutandoEdicao(edicao.id);
    try {
      await apiPost(`/api/edicoes-mensais/${edicao.id}/liberar`, {});
      addToast(`Liberado: ${edicao.condominios?.name || 'condomínio'}`, 'success');
      mutateE();
    } catch (e) {
      addToast(e.message || 'Erro ao liberar', 'error');
    } finally {
      setExecutandoEdicao(null);
    }
  }
  async function handleLiberarTodos() {
    if (edicoesEmEdicao.length === 0) return;
    if (!confirm(`Liberar todos os ${edicoesEmEdicao.length} condomínios deste mês?`)) return;
    setExecutandoEdicao('all');
    try {
      const res = await apiPost('/api/edicoes-mensais/liberar-todos', {});
      addToast(`${res.liberados} condomínios liberados`, 'success');
      mutateE();
    } catch (e) {
      addToast(e.message || 'Erro ao liberar todos', 'error');
    } finally {
      setExecutandoEdicao(null);
    }
  }
  async function handleSolicitarReabertura() {
    if (!motivoReabertura.trim()) { addToast('Informe o motivo', 'warning'); return; }
    setExecutandoEdicao(showReaberturaModal.id);
    try {
      await apiPost(`/api/edicoes-mensais/${showReaberturaModal.id}/solicitar-reabertura`, { motivo: motivoReabertura.trim() });
      addToast('Solicitação enviada ao master/emissor', 'success');
      setShowReaberturaModal(null);
      setMotivoReabertura('');
      mutateE();
    } catch (e) {
      addToast(e.message || 'Erro ao solicitar', 'error');
    } finally {
      setExecutandoEdicao(null);
    }
  }
  async function handleResponderReabertura(edicao, aprovar) {
    setExecutandoEdicao(edicao.id);
    try {
      await apiPost(`/api/edicoes-mensais/${edicao.id}/responder-reabertura`, { aprovar });
      addToast(aprovar ? 'Reabertura aprovada' : 'Reabertura negada', 'success');
      mutateE();
    } catch (e) {
      addToast(e.message || 'Erro', 'error');
    } finally {
      setExecutandoEdicao(null);
    }
  }

  const mesAtual = new Date();
  const mesAlvo = mesAtual.getMonth() === 11 ? 1 : mesAtual.getMonth() + 2; // M+1 (getMonth = 0-based)
  const anoAlvo = mesAtual.getMonth() === 11 ? mesAtual.getFullYear() + 1 : mesAtual.getFullYear();
  const MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

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
      let allFiles = [], signedUrl = null, pacote = null;
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
          {!verAbasPacotes && (
            <p className="text-slate-600 text-[10px] tracking-wider mt-1">
              Aprovação de emissões mensais → <Link href="/central-emissoes" className="text-cyan-400 hover:underline">Central de Emissões → Painel de Gestão</Link>
            </p>
          )}
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

      {/* ── Atalho pra aprovação de emissões ── */}
      {minhasPendenciasEmissao > 0 && (
        verAbasPacotes ? (
          <button onClick={() => setAba('pacotes')}
            className="w-full text-left block glass-panel p-5 rounded-2xl border border-cyan-500/30 hover:border-cyan-400/50 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all group">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center shrink-0">
                  <FileUp className="w-6 h-6 text-cyan-400" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400">Aprovação de emissões</p>
                  <p className="text-white font-bold mt-0.5">
                    <span className="text-2xl font-black text-cyan-300">{minhasPendenciasEmissao}</span>
                    <span className="ml-2 text-sm">pacote{minhasPendenciasEmissao !== 1 ? 's' : ''} esperando você em Meus Pacotes</span>
                  </p>
                </div>
              </div>
              <div className="text-cyan-400 group-hover:translate-x-1 transition-transform">
                <ArrowRight className="w-6 h-6" />
              </div>
            </div>
          </button>
        ) : (
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
        )
      )}

      {/* ── Tabs ── */}
      <div className="flex flex-wrap gap-2 bg-white/[0.03] p-1.5 rounded-2xl border border-white/5 w-fit">
        {[
          { id: 'fila',      label: 'Fila de Planilhas',        icon: Clock,   show: true,           badge: pendentes.length },
          { id: 'pacotes',   label: 'Meus Pacotes',             icon: Package, show: verAbasPacotes, badge: minhasPendenciasEmissao },
          { id: 'registro',  label: 'Registro de Emissões',     icon: Archive, show: verAbasPacotes, badge: 0 },
          { id: 'auditoria', label: 'Histórico de Atividades',  icon: History, show: true,           badge: 0 },
        ].filter(t => t.show).map(({ id, label, icon: Icon, badge }) => (
          <button key={id} onClick={() => setAba(id)}
            className={`relative flex items-center gap-2 px-5 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
              aba === id ? 'bg-violet-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
            {badge > 0 && (
              <span className="ml-1 bg-rose-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[20px] text-center shadow-[0_0_10px_rgba(244,63,94,0.6)]">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ABA: MEUS PACOTES (vindo da Central de Emissoes)           */}
      {/* ══════════════════════════════════════════════════════════ */}
      {aba === 'pacotes' && verAbasPacotes && (
        <div className="space-y-4">
          {(isGerente || isSupervisor) && <VisaoGerente profile={profile} />}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ABA: REGISTRO DE EMISSOES                                  */}
      {/* ══════════════════════════════════════════════════════════ */}
      {aba === 'registro' && verAbasPacotes && (
        <div className="space-y-4">
          <RegistroEmissoes profile={profile} />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════ */}
      {/* ABA: FILA DE PLANILHAS (Edicoes Mensais)                   */}
      {/* ══════════════════════════════════════════════════════════ */}
      {aba === 'fila' && (
        <div className="space-y-6">
          {/* Cabecalho do periodo + botão liberar todos (gerente) */}
          <div className="glass-panel p-5 rounded-[2rem] border border-white/5 flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-cyan-400 mb-1">Ciclo atual</p>
              <h3 className="text-xl font-black text-white">{MESES[mesAlvo]} / {anoAlvo}</h3>
              <p className="text-xs text-slate-500 mt-0.5">Edições mensais em andamento</p>
            </div>
            {isGerente && edicoesEmEdicao.length > 0 && (
              <button
                onClick={handleLiberarTodos}
                disabled={executandoEdicao === 'all'}
                className="px-5 py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-[11px] font-black uppercase tracking-widest disabled:opacity-50 shadow-lg shadow-emerald-500/20"
              >
                {executandoEdicao === 'all' ? 'Liberando…' : `Liberar todos (${edicoesEmEdicao.length})`}
              </button>
            )}
          </div>

          {/* Reaberturas pendentes (master/emissor) */}
          {(isMaster || isDepartamento) && edicoesReaberturas.length > 0 && (
            <div className="glass-panel p-5 rounded-[2rem] border border-amber-500/30">
              <h4 className="text-sm font-black uppercase tracking-widest text-amber-400 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> Reaberturas pendentes ({edicoesReaberturas.length})
              </h4>
              <div className="space-y-2">
                {edicoesReaberturas.map(e => (
                  <div key={e.id} className="flex items-center justify-between gap-4 p-3 bg-amber-500/5 border border-amber-500/20 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white">{e.condominios?.name}</p>
                      <p className="text-[11px] text-slate-400">{MESES[e.mes_referencia]}/{e.ano_referencia} · motivo: {e.reabertura_motivo}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleResponderReabertura(e, true)} disabled={executandoEdicao === e.id}
                        className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-[10px] font-black uppercase">Aprovar</button>
                      <button onClick={() => handleResponderReabertura(e, false)} disabled={executandoEdicao === e.id}
                        className="px-3 py-1.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-[10px] font-black uppercase">Negar</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Em edicao (acoes do gerente) */}
          {edicoesEmEdicao.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-2">Em edição</h4>
              {edicoesEmEdicao.map(e => (
                <div key={e.id} className="glass-panel p-5 rounded-[1.5rem] border border-violet-500/20 flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-12 h-12 bg-violet-500/10 rounded-2xl flex items-center justify-center border border-violet-500/30 shrink-0">
                      <Building2 className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base font-black text-white truncate">{e.condominios?.name}</h3>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400">{MESES[e.mes_referencia]} / {e.ano_referencia}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/condominio/${e.condominio_id}/arrecadacoes?ano=${e.ano_referencia}&mes=${e.mes_referencia}&edicao=${e.id}`}
                      className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 hover:text-white text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                      <FileText className="w-3.5 h-3.5" /> Ver planilha
                    </Link>
                    {(isGerente || isMaster) && (
                      <button onClick={() => handleLiberar(e)} disabled={executandoEdicao === e.id}
                        className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 disabled:opacity-50 flex items-center gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Liberar
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Finalizadas (gerente pode pedir reabertura) */}
          {edicoesFinalizadas.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2">Finalizadas</h4>
              {edicoesFinalizadas.map(e => (
                <div key={e.id} className="p-4 rounded-[1.5rem] border border-white/5 bg-white/[0.02] flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-300 truncate">{e.condominios?.name}</p>
                      <p className="text-[10px] text-slate-600 uppercase tracking-widest">{MESES[e.mes_referencia]}/{e.ano_referencia} · liberado {e.liberado_em ? new Date(e.liberado_em).toLocaleDateString('pt-BR') : ''}</p>
                    </div>
                  </div>
                  {isGerente && (
                    <button onClick={() => { setShowReaberturaModal(e); setMotivoReabertura(''); }}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded-lg text-rose-400 text-[10px] font-black uppercase tracking-widest">
                      Solicitar reabertura
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Aguardando resposta da reabertura */}
          {isGerente && edicoesReaberturas.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-amber-500 px-2">Reabertura solicitada (aguardando)</h4>
              {edicoesReaberturas.map(e => (
                <div key={e.id} className="p-4 rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5">
                  <p className="text-sm font-bold text-white">{e.condominios?.name}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{MESES[e.mes_referencia]}/{e.ano_referencia} · motivo: {e.reabertura_motivo}</p>
                </div>
              ))}
            </div>
          )}

          {/* Estado vazio */}
          {!edicoesLoading && edicoes.length === 0 && (
            <div className="text-center py-20 glass-panel rounded-[2.5rem] border border-white/5">
              <CheckCircle2 className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <h3 className="text-lg font-black text-slate-400 uppercase tracking-tighter">Nenhuma edição em andamento</h3>
              <p className="text-slate-600 text-xs mt-2">O master ainda não abriu o período deste mês.</p>
            </div>
          )}

          {/* Processos legados (mostra se houver) */}
          {pendentes.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 px-2">Processos legados</h4>
              {/* legacy code abaixo */}
            </div>
          )}
        </div>
      )}

      {/* Bloco legacy condicional - so renderiza se houver pendentes em processos antigos */}
      {aba === 'fila' && false && (
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

      {/* ── Modal Solicitar Reabertura ── */}
      {showReaberturaModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md" onClick={() => setShowReaberturaModal(null)} />
          <div className="glass-panel max-w-lg w-full p-8 rounded-[2.5rem] relative border border-rose-500/30 shadow-3xl">
            <button onClick={() => setShowReaberturaModal(null)} className="absolute top-4 right-4 text-slate-500 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-black text-white mb-2">Solicitar reabertura</h3>
            <p className="text-sm text-slate-400 mb-1">{showReaberturaModal.condominios?.name}</p>
            <p className="text-[10px] uppercase tracking-widest text-rose-400/80 mb-5">{MESES[showReaberturaModal.mes_referencia]}/{showReaberturaModal.ano_referencia}</p>
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Motivo da reabertura <span className="text-rose-400">*</span>
            </label>
            <textarea
              value={motivoReabertura}
              onChange={e => setMotivoReabertura(e.target.value)}
              rows={4}
              placeholder="Ex: Identifiquei um valor errado no condomínio, preciso corrigir o mês de julho."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 outline-none focus:ring-1 focus:ring-rose-500 placeholder-slate-600 resize-none mb-4"
            />
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowReaberturaModal(null)}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-slate-800 text-slate-300 hover:bg-slate-700">
                Cancelar
              </button>
              <button
                onClick={handleSolicitarReabertura}
                disabled={!motivoReabertura.trim() || executandoEdicao === showReaberturaModal.id}
                className="px-5 py-2 rounded-lg text-sm font-bold bg-rose-600 text-white hover:bg-rose-500 disabled:opacity-50 flex items-center gap-2">
                {executandoEdicao === showReaberturaModal.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Enviar solicitação
              </button>
            </div>
          </div>
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
