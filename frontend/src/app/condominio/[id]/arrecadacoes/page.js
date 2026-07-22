'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { apiPost, apiFetch } from '@/lib/api';
import { createClient } from '@/utils/supabase/client';
import StatusBadge from '@/components/StatusBadge';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  Save, Lock, ArrowLeft, PlusCircle, X, Search,
  ChevronDown, ChevronRight, Layers, Building, Calendar, Info,
  Printer, Send, Trash2, CheckCircle2, Settings, Timer, FileWarning,
  Copy, Minus, Plus
} from 'lucide-react';
import Link from 'next/link';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { usePipelineConfig } from '@/lib/usePipelineConfig';
import ModalSelecionarConta from '@/components/ModalSelecionarConta';
import { useLockedMonths, reasonLabel } from '@/lib/useLockedMonths';
import { useAlteracoesRateio } from '@/lib/useAlteracoesRateio';
import ModalAlteracoesRateio from '@/components/ModalAlteracoesRateio';

const MESES = {
    1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
    7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
};

// ─── Helpers de formatação BRL ─────────────────────────────────────────
function parseValorNumerico(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (!s || s === 'PLANILHA' || s === '-' || s === '—') return 0;
  const limpo = s.replace(/R\$\s?/gi, '').replace(/\s/g, '');
  if (limpo.includes(',')) {
    const num = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
    return isNaN(num) ? 0 : num;
  }
  const num = parseFloat(limpo);
  return isNaN(num) ? 0 : num;
}

function formatBRL(v) {
  if (v === 'PLANILHA') return v;
  const n = parseValorNumerico(v);
  return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Pega os dígitos e converte para valor (centavos acumulam à direita)
// Ex: digita "5300000" → retorna 53000.00
//     digita "1" → 0.01
function digitosParaValor(rawString) {
  const digits = String(rawString || '').replace(/\D/g, '');
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

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

  // ── Celular: edita um mês por vez + atalho "aplicar valor a N meses" ──
  const isMobile = useIsMobile();
  const [mesSelMobile, setMesSelMobile] = useState(() => new Date().getMonth() + 1);
  const [aplicarMesesFor, setAplicarMesesFor] = useState(null); // { rid, valor } | null
  const [aplicarCount, setAplicarCount] = useState(1);

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

  // Edicoes mensais ativas neste condominio (em_edicao / edicao_finalizada / reabertura_solicitada)
  const [edicoesCondo, setEdicoesCondo] = useState([]);
  const [edicaoLoading, setEdicaoLoading] = useState(false);
  const [pacotesDatas, setPacotesDatas] = useState([]);   // p/ preencher as assinaturas (registro/expedição)

  async function fetchEdicoes() {
    try {
      const res = await apiFetch(`/api/edicoes-mensais?ano=${selectedYear}`);
      setEdicoesCondo((res?.edicoes || []).filter(e => e.condominio_id === condoId));
    } catch {}
  }

  useEffect(() => {
    fetchEdicoes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condoId, selectedYear]);

  // Datas do pacote (lacrada_em = registro; status 'expedida' = expedição) p/ as assinaturas
  useEffect(() => {
    if (!condoId || !selectedYear) return;
    (async () => {
      try {
        const { data } = await supabase.from('emissoes_pacotes')
          .select('mes_referencia, status, lacrada, lacrada_em, atualizado_em')
          .eq('condominio_id', condoId).eq('ano_referencia', selectedYear);
        setPacotesDatas(data || []);
      } catch {}
    })();
  }, [condoId, selectedYear, supabase]);

  // Assinaturas automáticas: gerente liberou · emissão registrada · expedição (eventos mais recentes do ano)
  const assinaturas = useMemo(() => {
    const ult = arr => (arr.filter(Boolean).sort().slice(-1)[0]) || null;
    const liberadoEm = ult(edicoesCondo.map(e => e.liberado_em));
    const registradoEm = ult(pacotesDatas
      .filter(p => p.lacrada || ['registrado', 'expedida'].includes((p.status || '').toLowerCase()))
      .map(p => p.lacrada_em));
    const expedidoEm = ult(pacotesDatas
      .filter(p => (p.status || '').toLowerCase() === 'expedida')
      .map(p => p.atualizado_em || p.lacrada_em));
    return { liberadoEm, registradoEm, expedidoEm };
  }, [edicoesCondo, pacotesDatas]);

  async function liberarEdicaoMensal(edicao) {
    setEdicaoLoading(true);
    try {
      // Salva as alterações da planilha ANTES de finalizar (senão o gerente perderia o que editou)
      const ok = await handleSave(true);
      if (!ok) { addToast('Não consegui salvar as alterações — corrija e tente de novo.', 'error'); return; }
      await apiPost(`/api/edicoes-mensais/${edicao.id}/liberar`, {});
      addToast(`Salvo e liberado: ${edicao.condominios?.name || 'mês'} - ${String(edicao.mes_referencia).padStart(2,'0')}/${edicao.ano_referencia}`, 'success');
      await fetchEdicoes();
    } catch (e) {
      addToast(e.message || 'Erro ao liberar', 'error');
    } finally {
      setEdicaoLoading(false);
    }
  }

  // ── Liberar VÁRIOS meses de uma vez (a previsão que o gerente preencheu) ──
  const mesesAbertos = useMemo(
    () => edicoesCondo.filter(e => e.status === 'em_edicao').sort((a, b) => a.mes_referencia - b.mes_referencia),
    [edicoesCondo],
  );
  const [showLiberarTodos, setShowLiberarTodos] = useState(false);
  async function liberarTodosMesesAbertos() {
    setEdicaoLoading(true);
    try {
      // Salva antes de liberar (mesmo cuidado do "Liberar este mês")
      const ok = await handleSave(true);
      if (!ok) { addToast('Não consegui salvar as alterações — corrija e tente de novo.', 'error'); return; }
      const ids = mesesAbertos.map(e => e.id);
      const res = await apiPost('/api/edicoes-mensais/liberar-todos', { ids });
      const n = res?.liberados ?? ids.length;
      addToast(`${n} ${n === 1 ? 'mês liberado' : 'meses liberados'} — não precisa confirmar de novo.`, 'success');
      setShowLiberarTodos(false);
      await fetchEdicoes();
    } catch (e) {
      addToast(e.message || 'Erro ao liberar', 'error');
    } finally {
      setEdicaoLoading(false);
    }
  }

  // ── Aviso ao sair com mês preenchido e NÃO liberado (avisa, não trava) ──
  const [avisoSaida, setAvisoSaida] = useState(false);
  useEffect(() => {
    if (mesesAbertos.length === 0) return;
    const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);   // fechar/recarregar a aba
    return () => window.removeEventListener('beforeunload', handler);
  }, [mesesAbertos.length]);
  const tentarSair = () => {
    if (mesesAbertos.length > 0) setAvisoSaida(true);
    else router.push('/dashboard');
  };

  // Locks visuais por mes adicionais — edicao_finalizada bloqueia o mes pro gerente
  const edicoesLockedMeses = useMemo(() => {
    const map = {};
    edicoesCondo.forEach(e => {
      if (e.status === 'edicao_finalizada') map[e.mes_referencia] = true;
    });
    return map;
  }, [edicoesCondo]);

  // Meses que o MASTER abriu/reabriu no painel (edicoes_mensais = em_edicao).
  // Essa decisão explícita VENCE as travas automáticas "soft" (prazo do dia 16 e
  // 'pronto p/ emitir') — mas NÃO vence a trava "hard" de pacote já emitido (use retificação).
  const mesesReabertos = useMemo(() => {
    const s = new Set();
    edicoesCondo.forEach(e => { if (e.status === 'em_edicao') s.add(e.mes_referencia); });
    return s;
  }, [edicoesCondo]);

  // Lock por mês — passado, etapa 'pronto p/ emitir' ou pacote registrado
  const { isLocked, reasonFor } = useLockedMonths(condoId, selectedYear);

  // Alterações de rateio (AGO/AGE/Reuniao) — indicador no cabeçalho do mês
  const { porMes: alteracoesPorMes } = useAlteracoesRateio(condoId, selectedYear);
  const [modalAlteracoesMes, setModalAlteracoesMes] = useState(null); // null | número do mês

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

  // ── Auto-save: salva sozinho enquanto o gerente digita (nada se perde) ──
  const autoSaveTimer = useRef(null);
  const [autoSaveState, setAutoSaveState] = useState('idle'); // idle | saving | saved
  const agendarAutoSave = () => {
    if (!canEdit) return;
    setAutoSaveState('saving');
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const ok = await handleSave(true);   // modo silencioso (sem toast)
      setAutoSaveState(ok ? 'saved' : 'idle');
      if (ok) setTimeout(() => setAutoSaveState(s => (s === 'saved' ? 'idle' : s)), 1800);
    }, 1500);
  };
  useEffect(() => () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); }, []);

  // Logic Helpers
  const handleRateioChange = (id, field, value) => {
    setRateios(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    agendarAutoSave();
  };

  const handleValueChange = (rid, month, value) => {
    setRateiosVals(prev => ({
      ...prev,
      [rid]: { ...prev[rid], [month]: value }
    }));
    agendarAutoSave();
  };

  // Mascara de moeda em tempo real: extrai digitos do input e converte
  const handleCurrencyInput = (rid, month, rawValue) => {
    const num = digitosParaValor(rawValue);
    // Armazena sempre com 2 casas como string "53000.00"
    handleValueChange(rid, month, num.toFixed(2));
  };

  // Seleciona tudo ao focar (facilita substituir o valor)
  const handleCurrencyFocus = (e) => {
    setTimeout(() => e.target.select(), 0);
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
          <span className="inline-block text-[8px] font-black text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-full px-1.5 mt-0.5">
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

  const handleSave = async (silent = false) => {
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

      if (!silent) addToast('Planilha salva com sucesso!', 'success');
      return true;
    } catch (err) {
      addToast('Erro ao salvar algumas informações', 'error');
      return false;
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
        <div className="w-12 h-12 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
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

  // ─── Trava de um mês (mesma regra da célula do desktop) ───
  const mesTravadoInfo = (m) => {
    const edicaoFinalizadaMes = !!edicoesLockedMeses[m];
    const lockReason = reasonFor(m);
    const hardLock = lockReason === 'emitido';
    const reaberto = mesesReabertos.has(m);
    const softLock = isLocked(m) && !hardLock && !reaberto;
    const mesTravado = hardLock || edicaoFinalizadaMes || softLock;
    const reason = edicaoFinalizadaMes ? 'Edição finalizada (liberada). Solicite reabertura para alterar.' : lockReason;
    return { mesTravado, reason, cellDisabled: !canEdit || mesTravado };
  };

  // ─── Atalho do celular: aplicar um valor a N meses a partir do mês selecionado ───
  const aplicarValorMeses = (rid, valor, count) => {
    const start = mesSelMobile;
    let aplicados = 0;
    setRateiosVals(prev => {
      const next = { ...prev, [rid]: { ...(prev[rid] || {}) } };
      for (let k = 0; k < count; k++) {
        const mm = start + k;
        if (mm > 12) break;
        if (mesTravadoInfo(mm).mesTravado) continue; // não sobrescreve mês travado
        next[rid][mm] = valor;
        aplicados++;
      }
      return next;
    });
    setAplicarMesesFor(null);
    addToast(
      aplicados > 0 ? `Valor aplicado a ${aplicados} ${aplicados > 1 ? 'meses' : 'mês'}.` : 'Nenhum mês editável no intervalo.',
      aplicados > 0 ? 'success' : 'warning'
    );
  };

  // ═══════════ PLANILHA — versão de celular (um mês por vez) ═══════════
  const renderPlanilhaMobile = () => {
    const m = mesSelMobile;
    const totalMes = rateios.reduce((acc, r) => acc + parseValorNumerico(rateiosVals[r.id]?.[m]), 0);
    const edicaoAberta = edicoesCondo.find(e => e.status === 'em_edicao');
    const podeLiberarMensal = edicaoAberta && (profile?.role === 'gerente' || profile?.role === 'master');
    const parcelaTxt = (r, mm) => {
      if (!r.is_parcelado) return null;
      const mesIni = parseInt(r.mes_inicio || 1), total = parseInt(r.parcela_total || 1), startNum = parseInt(r.parcela_inicio || 1);
      if (mm >= mesIni) { const cur = startNum + (mm - mesIni); if (cur > 0 && cur <= total) return `${String(cur).padStart(2, '0')}/${String(total).padStart(2, '0')}`; }
      return null;
    };

    return (
      <div className="space-y-4">

        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 -ml-1">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Painel
        </Link>

        {/* Cabeçalho do condomínio */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-black text-slate-900 uppercase tracking-tight leading-tight break-words">{condo?.name}</h1>
            <p className="text-[11px] text-slate-500 font-medium mt-0.5">
              Gerente: {condo?.gerente_name} · venc. dia {condo?.due_day}{condo?.due_day_2 ? ` e ${condo.due_day_2}` : ''}
            </p>
            <div className="mt-1.5"><StatusBadge status={processo?.status} flow="processo" /></div>
          </div>
          <select
            value={selectedYear}
            onChange={(e) => router.push(`/condominio/${condoId}/arrecadacoes?ano=${e.target.value}`)}
            aria-label="Ano de referência"
            className="shrink-0 text-xs font-black bg-white border border-slate-200 rounded-xl px-3 py-2 text-slate-900 outline-none focus:border-violet-500"
          >
            {[...Array(6)].map((_, i) => <option key={i} value={2024 + i}>{2024 + i}</option>)}
          </select>
        </div>

        {/* Banner: sem permissão de edição */}
        {!canEdit && (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200">
            <Lock className="w-4 h-4 text-rose-500 shrink-0" aria-hidden="true" />
            <p className="text-[11px] font-bold text-rose-600">
              {prazoExpirado ? 'Prazo de devolução encerrado.' : 'Planilha bloqueada para edição.'}
            </p>
          </div>
        )}

        {/* Banners de edição mensal (finalizada / reabertura) */}
        {edicoesCondo.filter(e => e.status !== 'em_edicao').map(ed => {
          const mesNome = MESES[ed.mes_referencia];
          if (ed.status === 'edicao_finalizada') return (
            <div key={ed.id} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-50 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" aria-hidden="true" />
              <p className="text-[11px] font-bold text-emerald-600">{mesNome}/{ed.ano_referencia} liberado · edição bloqueada.</p>
            </div>
          );
          if (ed.status === 'reabertura_solicitada') return (
            <div key={ed.id} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
              <Timer className="w-3.5 h-3.5 text-amber-500 shrink-0" aria-hidden="true" />
              <p className="text-[11px] font-bold text-amber-600">{mesNome}/{ed.ano_referencia} · reabertura solicitada.</p>
            </div>
          );
          return null;
        })}

        {/* Timeline do emissor */}
        {isEmissor && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest">Emissor:</span>
            {['Em edição', 'Edição finalizada'].map(st => (
              <button key={st} onClick={() => handleForceStatus(st)}
                className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-full transition-all ${processo?.status === st ? (st === 'Edição finalizada' ? 'bg-rose-500 text-white' : 'bg-violet-600 text-white') : 'bg-slate-100 text-slate-500'}`}>
                {st}
              </button>
            ))}
          </div>
        )}

        {/* Fita de meses */}
        <div className="flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1 scrollbar-thin">
          {months.map(mm => {
            const { mesTravado } = mesTravadoInfo(mm);
            const sel = mm === m;
            return (
              <button key={mm} onClick={() => setMesSelMobile(mm)}
                aria-pressed={sel}
                className={`shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-full text-xs font-bold transition-colors ${sel ? 'bg-violet-600 text-white' : mesTravado ? 'bg-rose-50 text-rose-500' : 'bg-slate-100 text-slate-600'}`}>
                {mesTravado && <Lock className="w-3 h-3" aria-hidden="true" />}
                {MESES[mm].slice(0, 3)}
              </button>
            );
          })}
        </div>

        {/* Total do mês */}
        <div className="flex items-center justify-between bg-violet-50 rounded-2xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-violet-600">Total de {MESES[m]}</p>
            <p className="text-xl font-black text-violet-700 tabular-nums truncate">{formatBRL(totalMes)}</p>
          </div>
          <span className="text-[11px] text-slate-500 font-bold shrink-0 ml-2">{rateios.length} verba{rateios.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Lista de verbas do mês */}
        {rateios.length === 0 ? (
          <div className="py-12 text-center">
            <Layers className="w-10 h-10 text-slate-300 mx-auto mb-2" aria-hidden="true" />
            <p className="text-slate-500 font-bold text-sm">Nenhuma verba cadastrada</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {rateios.map(r => {
              const val = rateiosVals[r.id]?.[m] || '0.00';
              const { mesTravado, reason, cellDisabled } = mesTravadoInfo(m);
              const isPlanilhaSpecial = val === 'PLANILHA';
              const displayValue = isPlanilhaSpecial ? val : formatBRL(val);
              const parc = parcelaTxt(r, m);
              return (
                <div key={r.id} className={`bg-white rounded-2xl border p-3 ${mesTravado ? 'border-rose-200' : 'border-slate-200'}`}>
                  <div className="flex items-start gap-2 mb-2.5">
                    <div className="flex-1 min-w-0">
                      <input value={r.nome || ''} onChange={e => handleRateioChange(r.id, 'nome', e.target.value)} disabled={!canEdit}
                        placeholder="Nome da verba"
                        className="w-full bg-transparent border-none p-0 text-[13px] font-black uppercase text-slate-800 placeholder:text-slate-400 focus:ring-0 disabled:cursor-default" />
                      <p className="text-[10px] font-bold text-slate-400 mt-0.5 truncate">
                        CT. {r.conta_contabil || '—'}{r.conta_nome ? ` · ${r.conta_nome}` : ''}{parc && <span className="text-violet-500"> · parcela {parc}</span>}
                      </p>
                    </div>
                    {canEdit && (
                      <button onClick={() => setEditingRateioId(r.id)} className="tap shrink-0 -mt-1 -mr-1 text-slate-400" aria-label="Configurar verba">
                        <Settings className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="text" inputMode="numeric" value={displayValue}
                      onChange={isPlanilhaSpecial ? (e) => handleValueChange(r.id, m, e.target.value) : (e) => handleCurrencyInput(r.id, m, e.target.value)}
                      onFocus={isPlanilhaSpecial ? undefined : handleCurrencyFocus} disabled={cellDisabled} placeholder="R$ 0,00"
                      aria-label={`Valor de ${r.nome || 'verba'} em ${MESES[m]}`}
                      className={`flex-1 min-w-0 text-right bg-slate-50 border rounded-xl text-base font-black px-3 py-2.5 outline-none transition-colors focus:border-violet-500
                        ${isPlanilhaSpecial ? 'text-violet-500 text-center' : 'text-slate-800'}
                        ${mesTravado ? 'border-rose-200 text-rose-400' : 'border-slate-200'}
                        ${cellDisabled ? 'opacity-60 cursor-not-allowed' : ''}`} />
                    {canEdit && !cellDisabled && !isPlanilhaSpecial && (
                      <button onClick={() => { setAplicarMesesFor({ rid: r.id, valor: val }); setAplicarCount(Math.max(1, 12 - m + 1)); }}
                        className="tap shrink-0 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center" aria-label="Aplicar valor a vários meses">
                        <Copy className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => handleDelete(r.id)} className="tap shrink-0 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center" aria-label="Excluir verba">
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  {mesTravado && (
                    <p className="text-[10px] font-bold text-rose-400 mt-1.5 flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" /> {reasonLabel(reason)}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Adicionar verba */}
        {canEdit && (
          <button onClick={handleAddNew} className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-200 rounded-2xl text-[11px] font-black text-slate-500 uppercase tracking-widest active:opacity-70">
            <PlusCircle className="w-4 h-4" aria-hidden="true" /> Adicionar verba
          </button>
        )}

        {/* Alterações (AGO/AGE) do mês */}
        {canEdit && (
          <button onClick={() => setModalAlteracoesMes(m)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-amber-50 text-amber-600 text-[11px] font-black uppercase tracking-widest active:opacity-70">
            <FileWarning className="w-4 h-4" aria-hidden="true" /> Alterações de {MESES[m]} (AGO/AGE)
          </button>
        )}

        {/* Observações */}
        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-1.5">
            <Info className="w-3.5 h-3.5 text-violet-400" aria-hidden="true" /> Observações para o emissor
          </label>
          <textarea value={obsEmissao} onChange={e => setObsEmissao(e.target.value)} disabled={!canEdit} rows={3}
            className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-sm font-medium text-slate-700 outline-none focus:border-violet-500 resize-none"
            placeholder="Observações importantes para a emissão..." />
        </div>

        {/* Ações */}
        {canEdit && (
          <div className="flex gap-2 pt-1">
            <button onClick={() => handleSave()} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-slate-100 border border-slate-200 text-xs font-black text-slate-900 uppercase tracking-widest active:opacity-70 disabled:opacity-50">
              <Save className="w-4 h-4 text-violet-500" aria-hidden="true" /> {saving ? 'Salvando...' : 'Salvar'}
            </button>
            {podeLiberarMensal ? (
              <button onClick={() => liberarEdicaoMensal(edicaoAberta)} disabled={edicaoLoading}
                className="flex-[1.3] flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-500 text-white text-xs font-black uppercase tracking-widest active:opacity-70 disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Liberar {MESES[edicaoAberta.mes_referencia].slice(0, 3)}
              </button>
            ) : edicoesCondo.length === 0 && (
              <button onClick={() => setShowConfirmSend(true)}
                className="flex-[1.3] flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest active:opacity-70">
                <Send className="w-4 h-4" aria-hidden="true" /> Enviar
              </button>
            )}
          </div>
        )}

        {/* Folha: aplicar valor a N meses */}
        {aplicarMesesFor && (() => {
          const start = m;
          const alvo = [];
          for (let k = 0; k < aplicarCount; k++) { const mm = start + k; if (mm > 12) break; alvo.push(mm); }
          const maxCount = 12 - start + 1;
          return (
            <div className="fixed inset-0 z-[90] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Aplicar valor a vários meses">
              <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm animate-fade-in" onClick={() => setAplicarMesesFor(null)} />
              <div className="relative bg-white rounded-t-3xl px-5 pt-3 animate-slide-up" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
                <div className="mx-auto w-10 h-1.5 rounded-full bg-slate-300 mb-4" aria-hidden="true" />
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Aplicar valor</p>
                <p className="text-2xl font-black text-slate-900 mb-1 tabular-nums">{formatBRL(aplicarMesesFor.valor)}</p>
                <p className="text-xs text-slate-500 font-medium mb-5">A partir de <strong className="text-slate-700">{MESES[start]}</strong>, em quantos meses aplicar?</p>

                <div className="flex items-center justify-center gap-5 mb-4">
                  <button onClick={() => setAplicarCount(c => Math.max(1, c - 1))} disabled={aplicarCount <= 1}
                    className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40 active:opacity-70" aria-label="Menos um mês">
                    <Minus className="w-5 h-5" aria-hidden="true" />
                  </button>
                  <div className="text-center min-w-[64px]">
                    <p className="text-4xl font-black text-violet-600 tabular-nums leading-none">{aplicarCount}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">{aplicarCount > 1 ? 'meses' : 'mês'}</p>
                  </div>
                  <button onClick={() => setAplicarCount(c => Math.min(maxCount, c + 1))} disabled={aplicarCount >= maxCount}
                    className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 disabled:opacity-40 active:opacity-70" aria-label="Mais um mês">
                    <Plus className="w-5 h-5" aria-hidden="true" />
                  </button>
                </div>

                <p className="text-center text-[11px] font-bold text-slate-500 mb-5 leading-relaxed">
                  Preenche: <span className="text-violet-600">{alvo.map(mm => MESES[mm].slice(0, 3)).join(' · ')}</span>
                  <br /><span className="text-[10px] text-slate-400 font-medium">Meses travados são ignorados.</span>
                </p>

                <div className="flex gap-2">
                  <button onClick={() => setAplicarMesesFor(null)} className="flex-1 py-3.5 rounded-2xl bg-slate-100 text-xs font-black text-slate-600 uppercase tracking-widest active:opacity-70">Cancelar</button>
                  <button onClick={() => aplicarValorMeses(aplicarMesesFor.rid, aplicarMesesFor.valor, aplicarCount)}
                    className="flex-[1.5] py-3.5 rounded-2xl bg-violet-600 text-white text-xs font-black uppercase tracking-widest active:opacity-70">Aplicar</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    );
  };


  return (
    <div className="animate-fade-in w-full h-full pb-20">

      {isMobile ? renderPlanilhaMobile() : (<>

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
            Cada mês pode ser editado até <strong>dia 15</strong>. A partir do dia 16, fecha automaticamente.
            Também fica travado quando a etapa é marcada como <strong>"pronto p/ emitir"</strong> ou a <strong>emissão é registrada</strong>.
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
                <div className="w-14 h-14 bg-violet-500/10 border border-violet-500/20 rounded-2xl flex items-center justify-center ">
                    <Building className="w-7 h-7 text-violet-400" />
                </div>
                <div>
                    {/* Deixa explícito que esta tela é a PLANILHA (etapa 1), não a EMISSÃO (etapa 2) */}
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <span className="text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg bg-violet-600 text-white">
                            Etapa 1 · Planilha (previsão)
                        </span>
                        <span className="text-[10px] text-slate-500">
                            Aqui você define os <b className="text-slate-700">valores</b>. Conferir/aprovar o documento da <b className="text-slate-700">emissão</b> é a etapa seguinte, em Aprovações.
                        </span>
                    </div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight uppercase leading-none">{condo?.name}</h1>
                    <div className="flex items-center gap-3 mt-2">
                        <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest flex items-center gap-1 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            Gerente: <span className="text-slate-900">{condo?.gerente_name}</span>
                        </span>
                        <span className="text-[10px] font-black text-violet-400 uppercase tracking-widest flex items-center gap-1 bg-violet-500/10 px-2 py-0.5 rounded border border-violet-500/20">
                            Vencimento: <span className="text-slate-900">DIA {condo?.due_day}{condo?.due_day_2 ? ` E ${condo.due_day_2}` : ''}</span>
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
                        className="bg-white border-slate-200 text-sm font-black text-slate-900 px-4 py-2 rounded-xl focus:ring-1 focus:ring-violet-500 outline-none"
                    >
                        {[...Array(6)].map((_, i) => (
                            <option key={i} value={2024 + i}>{2024 + i}</option>
                        ))}
                    </select>
                </div>
            </div>
        </div>

        {/* ── Banner Edição Mensal (gerente libera por mês daqui) ── */}
        {edicoesCondo.length > 0 && (
          <div className="space-y-2 mt-4">
            {/* Previsão: libera TODOS os meses preenchidos de uma vez (sem confirmar mês a mês) */}
            {mesesAbertos.length > 1 && (profile?.role === 'gerente' || profile?.role === 'master') && (
              <div className="flex items-center justify-between gap-4 px-5 py-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/30">
                <p className="text-xs font-bold text-slate-700">
                  Você tem <b>{mesesAbertos.length} meses</b> de planilha abertos. Pode liberar todos de uma vez.
                </p>
                <button onClick={() => setShowLiberarTodos(true)} disabled={edicaoLoading}
                  className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 disabled:opacity-50 shrink-0">
                  Liberar todos os meses abertos ({mesesAbertos.length})
                </button>
              </div>
            )}
            {edicoesCondo.map(ed => {
              const mesNome = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][ed.mes_referencia];
              if (ed.status === 'em_edicao') {
                return (
                  <div key={ed.id} className="flex items-center justify-between gap-4 px-5 py-4 rounded-2xl bg-violet-500/10 border border-violet-500/30">
                    <div className="flex items-center gap-3">
                      <div className="w-2.5 h-2.5 rounded-full bg-violet-400 animate-pulse" />
                      <div>
                        <p className="text-sm font-black text-slate-900">Planilha de {mesNome}/{ed.ano_referencia} · em edição (não liberada)</p>
                        <p className="text-[11px] text-violet-300/80">Revise os valores e libere para finalizar.</p>
                      </div>
                    </div>
                    {(profile?.role === 'gerente' || profile?.role === 'master') && (
                      <button onClick={() => liberarEdicaoMensal(ed)} disabled={edicaoLoading}
                        className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                        Liberar este mês
                      </button>
                    )}
                  </div>
                );
              }
              if (ed.status === 'edicao_finalizada') {
                return (
                  <div key={ed.id} className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <p className="text-xs font-bold text-emerald-300">Planilha de {mesNome}/{ed.ano_referencia} · liberada{ed.liberado_em ? ` em ${new Date(ed.liberado_em).toLocaleDateString('pt-BR')}` : ''}. Não volta pra você, a não ser que a administração reabra.</p>
                  </div>
                );
              }
              if (ed.status === 'reabertura_solicitada') {
                return (
                  <div key={ed.id} className="flex items-center gap-3 px-5 py-3 rounded-2xl bg-amber-500/5 border border-amber-500/30">
                    <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    <p className="text-xs font-bold text-amber-300">{mesNome}/{ed.ano_referencia} · reabertura solicitada, aguardando aprovação.</p>
                  </div>
                );
              }
              return null;
            })}
          </div>
        )}

        {/* TAB NAVIGATION SIMPLES */}
        <div className="flex justify-between items-end border-t border-slate-200 pt-4 mt-2">
            <div className="flex flex-col gap-4">
                <div className="flex gap-4">
                    <button className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg bg-violet-500 text-white ">
                        Arrecadações
                    </button>
                    <Link href={`/condominio/${condoId}/emissoes`} className="text-[10px] font-black uppercase tracking-widest px-4 py-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                        Emissões (Arquivos)
                    </Link>
                </div>
                
                {/* HUD EMISSOR MOVIDO PARA O TOPO */}
                {isEmissor && (
                    <div className="flex items-center gap-2 bg-white p-2 rounded-full border border-slate-200 shadow-inner w-max">
                        <span className="text-[9px] font-black uppercase text-slate-500 mr-2 ml-2">Timeline (Emissor):</span>
                        {['Em edição', 'Edição finalizada'].map(st => (
                            <button
                                key={st}
                                onClick={() => handleForceStatus(st)}
                                className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-full transition-all ${
                                  processo?.status === st
                                    ? st === 'Edição finalizada'
                                      ? 'bg-rose-500 text-white '
                                      : 'bg-violet-500 text-slate-950 '
                                    : 'text-slate-400 hover:bg-slate-100'
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
      <div className="glass-panel rounded-2xl overflow-hidden border-slate-200 relative shadow-2xl">
        <div className="overflow-x-auto overflow-y-visible scrollbar-thin">
            <table className="w-full border-collapse">
                <thead className="bg-slate-100">
                    <tr>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 min-w-[200px] sticky left-0 z-30 bg-slate-50 backdrop-blur-md">
                            Conta Contábil
                        </th>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 min-w-[220px] sticky left-[200px] z-30 bg-slate-50 backdrop-blur-md">
                            Verbas / Descritivo
                        </th>
                        {months.map(m => {
                            const altList = alteracoesPorMes[m] || [];
                            const temPrevista = altList.some(a => a.status === 'prevista');
                            const totalAlts = altList.length;
                            return (
                                <th key={m} className="px-2 py-3 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest border-r border-slate-200 min-w-[120px] bg-slate-100 relative">
                                    <div className="flex items-center justify-center gap-1.5">
                                        <span>{MESES[m]} / {String(selectedYear).slice(-2)}</span>
                                    </div>
                                    {canEdit && (
                                      <button onClick={() => setModalAlteracoesMes(m)}
                                        title={
                                          totalAlts > 0
                                            ? `${totalAlts} alteração${totalAlts > 1 ? 'ões' : ''} ${temPrevista ? '(há previstas)' : 'registrada(s)'}`
                                            : 'Marcar alteração (AGO/AGE/Reunião)'
                                        }
                                        className={`mt-1.5 mx-auto flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest transition-all ${
                                          totalAlts === 0
                                            ? 'bg-slate-50 hover:bg-amber-500/10 border border-slate-200 hover:border-amber-500/40 text-slate-500 hover:text-amber-400'
                                            : temPrevista
                                              ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 ring-1 ring-amber-500/30 animate-pulse'
                                              : 'bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                                        }`}>
                                        <FileWarning className="w-3 h-3" />
                                        {totalAlts === 0 ? '+ AGO/AGE/Reunião' : `${totalAlts} alt.`}
                                      </button>
                                    )}
                                </th>
                            );
                        })}
                        <th className="px-2 py-4 w-12 bg-slate-100"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                    {rateios.map((r) => (
                        <tr key={r.id} className="group hover:bg-slate-100 transition-colors relative">
                            {/* COL: CONTA */}
                            <td className="p-2 border-r border-slate-200 sticky left-0 z-20 bg-white backdrop-blur-sm group-hover:bg-slate-100 transition-colors shadow-xl relative">
                                <div className="w-full text-left p-2 rounded-lg text-xs">
                                    <div className="text-[10px] font-black text-violet-400 mb-0.5 truncate" title="Conta Contábil e Nome">
                                        CT. {r.conta_contabil || '—'} {r.conta_nome ? `- ${r.conta_nome}` : ''}
                                    </div>
                                    <div className="text-[9px] font-black text-violet-400 mb-0.5" title="Análise Financeira">
                                        AN. {r.conta_analise_fin || '—'}
                                    </div>
                                </div>
                            </td>

                            {/* COL: VERBA */}
                            <td className="p-3 border-r border-slate-200 sticky left-[200px] z-20 bg-white backdrop-blur-sm group-hover:bg-slate-100 transition-colors shadow-2xl">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1">
                                        <input
                                            value={r.nome}
                                            onChange={e => handleRateioChange(r.id, 'nome', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-full bg-transparent border-none p-0 text-xs font-black uppercase text-slate-800 placeholder:text-slate-600 focus:ring-0 disabled:cursor-default"
                                            placeholder="Ex: Fundo de Obras"
                                        />
                                        <div className="text-[9px] font-bold text-slate-500 truncate mt-1 max-w-[150px]">{r.conta_nome || 'Conta não vinculada'}</div>
                                    </div>
                                    {canEdit && (
                                        <button onClick={() => setEditingRateioId(r.id)} className="p-1.5 text-slate-500 hover:text-violet-400 bg-slate-100/50 hover:bg-violet-500/10 rounded-lg transition-all" title="Configurações Avançadas">
                                            <Settings className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>
                                {r.is_parcelado && (
                                    <div className="flex items-center gap-1 mt-2 text-[8px] font-black uppercase tracking-wider text-slate-400">
                                        <Layers className="w-3 h-3 text-violet-500" />
                                        Parcelado ({r.parcela_inicio}/{r.parcela_total}) a partir do Mês {r.mes_inicio}
                                    </div>
                                )}
                            </td>

                            {/* MONTHS VALUES */}
                            {months.map(m => {
                                const val = rateiosVals[r.id]?.[m] || '0.00';
                                const edicaoFinalizadaMes = !!edicoesLockedMeses[m];
                                const lockReason = reasonFor(m);
                                const hardLock = lockReason === 'emitido';        // pacote registrado -> só retificação
                                const reaberto = mesesReabertos.has(m);           // master abriu/reabriu este mês no painel
                                const softLock = isLocked(m) && !hardLock && !reaberto;  // prazo/preparação cedem à reabertura
                                const mesTravado = hardLock || edicaoFinalizadaMes || softLock;
                                const cellDisabled = !canEdit || mesTravado;
                                const reason = edicaoFinalizadaMes ? 'Edição finalizada (liberada). Solicite reabertura para alterar.' : lockReason;
                                const isPlanilhaSpecial = val === 'PLANILHA';
                                const isZero = !isPlanilhaSpecial && parseValorNumerico(val) === 0;
                                // Sempre mostra formatado em BRL (mascara em tempo real no onChange)
                                const displayValue = isPlanilhaSpecial ? val : formatBRL(val);
                                return (
                                    <td key={m} className={`p-1 border-r border-slate-200 min-w-[120px] relative ${mesTravado ? 'bg-rose-500/[0.04]' : ''}`}
                                        title={mesTravado ? `Mês bloqueado: ${reasonLabel(reason)}` : undefined}>
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={displayValue}
                                            onChange={isPlanilhaSpecial
                                                ? (e) => handleValueChange(r.id, m, e.target.value)
                                                : (e) => handleCurrencyInput(r.id, m, e.target.value)}
                                            onFocus={isPlanilhaSpecial ? undefined : handleCurrencyFocus}
                                            disabled={cellDisabled}
                                            placeholder="R$ 0,00"
                                            className={`w-full text-right bg-transparent border-none text-xs font-bold px-2 py-2 focus:bg-slate-50 transition-colors focus:ring-0
                                                ${isPlanilhaSpecial ? 'text-violet-400 font-black text-center' : isZero ? 'text-slate-600' : 'text-slate-800'}
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
                            <td className="p-2 text-center bg-slate-100">
                                {canEdit && (
                                  <button onClick={() => handleDelete(r.id)} className="text-rose-500/60 hover:text-rose-400 p-1.5 hover:bg-rose-400/10 rounded-lg transition-all" title="Excluir rateio">
                                      <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                            </td>
                        </tr>
                    ))}
                    
                    {/* Botão Adicionar Row */}
                    {canEdit && (
                        <tr>
                            <td colSpan={15} className="p-4 bg-slate-100">
                                <button onClick={handleAddNew} className="flex items-center gap-2 px-6 py-2 border-2 border-dashed border-slate-200 hover:border-violet-500/50 rounded-xl text-[10px] font-black text-slate-500 hover:text-violet-400 transition-all uppercase tracking-widest mx-auto group">
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
                    <Info className="w-4 h-4 text-violet-400" />
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Observações de Emissão</span>
                </div>
                <textarea 
                    value={obsEmissao}
                    onChange={e => setObsEmissao(e.target.value)}
                    disabled={!canEdit}
                    rows={4}
                    className="w-full glass-panel bg-slate-100 border-slate-200 rounded-2xl p-5 text-sm font-medium text-slate-700 shadow-inner focus:border-violet-500/50 transition-all resize-none"
                    placeholder="Digite observações importantes para a emissão deste semestre..."
                />
            </div>

            {/* ASSINATURAS (LAYOUT PDF) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mt-20 border-t border-slate-200 pt-16">
                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-violet-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Gerente de Carteira</span>
                        </div>
                    </div>
                    <div className="text-lg font-black text-slate-900 uppercase tracking-tighter">{condo?.gerente_name}</div>
                    <div className="text-[8px] font-black text-slate-600 mt-1 uppercase tracking-widest italic">Responsável Direto</div>
                    {assinaturas.liberadoEm && (
                      <div className="text-[9px] font-bold text-emerald-600 mt-1.5">
                        ✓ Liberado em {new Date(assinaturas.liberadoEm).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }).replace(',', ' às')}
                      </div>
                    )}
                </div>

                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-violet-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Validação Administrativa</span>
                        </div>
                    </div>
                    <div className={`text-xs font-black uppercase tracking-widest italic mt-2 ${assinaturas.registradoEm ? 'text-slate-800' : 'text-slate-500'}`}>
                      Visto em {assinaturas.registradoEm ? new Date(assinaturas.registradoEm).toLocaleDateString('pt-BR') : '___/___/___'}
                    </div>
                </div>

                <div className="text-center group">
                    <div className="w-full h-[1px] bg-slate-700 group-hover:bg-emerald-500 transition-colors mb-6 relative">
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-white px-3">
                            <span className="text-[9px] font-black text-slate-500 uppercase tracking-[0.2em]">Entrega / Expedição</span>
                        </div>
                    </div>
                    <div className="flex justify-center gap-2">
                        {(() => {
                          const exp = assinaturas.expedidoEm ? new Date(assinaturas.expedidoEm) : null;
                          const cls = `glass-panel rounded-lg flex items-center justify-center font-black text-xs ${exp ? 'text-slate-900 border-emerald-300 bg-emerald-50' : 'text-slate-500 border-slate-200'}`;
                          return (<>
                            <div className={`w-10 h-10 ${cls}`}>{exp ? String(exp.getDate()).padStart(2,'0') : '/'}</div>
                            <div className={`w-10 h-10 ${cls}`}>{exp ? String(exp.getMonth()+1).padStart(2,'0') : '/'}</div>
                            <div className={`w-16 h-10 ${cls}`}>{exp ? exp.getFullYear() : selectedYear}</div>
                          </>);
                        })()}
                    </div>
                </div>
            </div>

            {/* ACÕES FINAIS */}
            <div className="flex flex-wrap justify-between items-center gap-4 mt-20 pt-8 border-t border-slate-200">
                <button type="button" onClick={tentarSair} className="text-xs font-black text-slate-500 hover:text-slate-900 transition-colors uppercase tracking-widest flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
                </button>


                <div className="flex gap-4">
                    <button className="p-3 text-slate-400 hover:text-slate-900 glass-panel hover:bg-slate-100 rounded-xl transition-all" title="Imprimir Planilha">
                        <Printer className="w-5 h-5" />
                    </button>
                    
                    {canEdit && (
                        <>
                            <button
                                onClick={() => handleSave()}
                                disabled={saving}
                                className="px-8 py-3 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-black text-slate-900 rounded-xl uppercase tracking-widest transition-all shadow-xl flex items-center gap-2"
                            >
                                <Save className="w-4 h-4 text-violet-400" />
                                {saving || autoSaveState === 'saving' ? 'SALVANDO...'
                                  : autoSaveState === 'saved' ? '✓ SALVO'
                                  : 'SALVAR AGORA'}
                            </button>

                            {/* "Enviar Conferência" é o fluxo semestral antigo — no ciclo mensal quem finaliza é "Liberar este mês" (que já salva) */}
                            {edicoesCondo.length === 0 && (
                              <button
                                  onClick={() => setShowConfirmSend(true)}
                                  className="px-10 py-3 bg-violet-500 hover:bg-violet-400 text-slate-950 text-xs font-black rounded-xl uppercase tracking-widest transition-all  shadow-violet-500/20 flex items-center gap-2 active:scale-95"
                              >
                                  <Send className="w-4 h-4" /> ENVIAR CONFERÊNCIA
                              </button>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
      </div>
      </>)}

      {/* ─── MODAL: LIBERAR TODOS OS MESES ABERTOS ─── */}
      {showLiberarTodos && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowLiberarTodos(false)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-2xl">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-2">Liberar {mesesAbertos.length} meses</h4>
            <p className="text-xs text-slate-500 mb-4">
              Estes meses da planilha serão salvos e liberados de uma vez. Depois disso <b className="text-slate-700">não voltam pra você</b>, a não ser que a administração reabra.
            </p>
            <ul className="mb-5 space-y-1 max-h-52 overflow-y-auto">
              {mesesAbertos.map(ed => (
                <li key={ed.id} className="text-xs font-bold text-slate-700 flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  {MESES[ed.mes_referencia]}/{ed.ano_referencia}
                </li>
              ))}
            </ul>
            <div className="flex gap-3">
              <button onClick={() => setShowLiberarTodos(false)}
                className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">Cancelar</button>
              <button onClick={liberarTodosMesesAbertos} disabled={edicaoLoading}
                className="flex-[2] py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-xs disabled:opacity-50">
                {edicaoLoading ? 'Liberando…' : 'Salvar e liberar todos'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: AVISO AO SAIR SEM LIBERAR ─── */}
      {avisoSaida && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setAvisoSaida(false)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 p-6 rounded-2xl shadow-2xl">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-2">Você ainda não liberou</h4>
            <p className="text-xs text-slate-500 mb-4">
              {mesesAbertos.length === 1
                ? <>A planilha de <b className="text-slate-700">{MESES[mesesAbertos[0].mes_referencia]}/{mesesAbertos[0].ano_referencia}</b> está preenchida mas <b className="text-slate-700">não foi liberada</b>. Enquanto não liberar, ela continua pendente com você.</>
                : <>Você tem <b className="text-slate-700">{mesesAbertos.length} meses</b> preenchidos mas <b className="text-slate-700">não liberados</b>. Enquanto não liberar, continuam pendentes com você.</>}
              <br /><span className="text-slate-400">Seus valores já foram salvos automaticamente.</span>
            </p>
            <div className="flex gap-3">
              <button onClick={() => { setAvisoSaida(false); router.push('/dashboard'); }}
                className="flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">Sair mesmo assim</button>
              <button onClick={async () => { setAvisoSaida(false); if (mesesAbertos.length === 1) { await liberarEdicaoMensal(mesesAbertos[0]); } else { setShowLiberarTodos(true); } }}
                disabled={edicaoLoading}
                className="flex-[2] py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black uppercase tracking-widest text-xs disabled:opacity-50">
                Liberar agora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL EDIÇÃO AVANÇADA DE VERBA ─── */}
      {editingRateioId && (
         <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
             <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setEditingRateioId(null)} />
             
             {rateios.filter(r => r.id === editingRateioId).map(r => (
                 <div key={r.id} className="relative w-full max-w-2xl bg-white border border-slate-700 p-8 rounded-2xl shadow-2xl">
                     <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-200 pr-12">
                         <h4 className="flex items-center gap-2 text-sm font-black text-slate-900 uppercase tracking-widest">
                            <Settings className="w-5 h-5 text-violet-400" />
                            Configurações da Verba
                         </h4>
                         <button 
                             type="button" 
                             onClick={(e) => {
                                 e.stopPropagation();
                                 e.preventDefault();
                                 setEditingRateioId(null);
                             }} 
                             className="absolute top-6 right-6 p-2 bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white rounded-lg transition-all cursor-pointer z-[200]"
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
                                        className="w-full bg-slate-100 border border-slate-700 rounded-lg p-2.5 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                    />
                                </div>
                                <div className="w-2/3 relative flex items-center">
                                    <input 
                                        value={r.conta_nome || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_nome', e.target.value)}
                                        className="w-full bg-slate-100 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-800 font-bold outline-none focus:border-violet-500 pr-10" 
                                    />
                                    <button 
                                        onClick={() => setShowContaDropdown(r.id)}
                                        className="absolute right-2 p-1 text-slate-400 hover:text-violet-400 bg-slate-700 rounded transition-colors"
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
                                        className="w-full bg-slate-100 border border-slate-700 rounded-lg p-2.5 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                    />
                                </div>
                                <div className="w-2/3">
                                    <input 
                                        value={r.conta_analise_nome || ''}
                                        onChange={e => handleRateioChange(r.id, 'conta_analise_nome', e.target.value)}
                                        className="w-full bg-slate-100 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-800 font-bold outline-none focus:border-violet-500" 
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
                                 className="w-full bg-slate-100 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-900 font-black uppercase outline-none focus:border-violet-500" 
                             />
                         </div>
                     </div>

                     <div className="pt-6 border-t border-slate-200">
                         <h5 className="text-[11px] font-black text-slate-500 uppercase tracking-widest mb-4">Configuração de Parcelamento</h5>
                         
                         <label className="flex items-center gap-2 cursor-pointer w-max mb-4">
                            <input 
                                type="checkbox" 
                                checked={r.is_parcelado}
                                onChange={e => handleRateioChange(r.id, 'is_parcelado', e.target.checked)}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-100 text-violet-500 focus:ring-0 focus:ring-offset-0"
                            />
                            <span className="text-xs font-bold text-slate-700">Cobrar em múltiplas parcelas</span>
                         </label>

                         {r.is_parcelado && (
                             <div className="flex flex-wrap gap-4 items-end bg-slate-100 p-4 rounded-xl border border-slate-200">
                                 <div>
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Parcela Atual/Inicial</label>
                                     <input 
                                        type="number" min="1"
                                        value={r.parcela_inicio} 
                                        onChange={e => handleRateioChange(r.id, 'parcela_inicio', e.target.value)} 
                                        className="w-24 bg-slate-100 border border-slate-700 rounded p-2 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                     />
                                 </div>
                                 <span className="text-xl font-light text-slate-600 self-center pb-2">/</span>
                                 <div>
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Total de Parcelas</label>
                                     <input 
                                        type="number" min="1"
                                        value={r.parcela_total} 
                                        onChange={e => handleRateioChange(r.id, 'parcela_total', e.target.value)} 
                                        className="w-24 bg-slate-100 border border-slate-700 rounded p-2 text-sm text-violet-400 font-black outline-none focus:border-violet-500" 
                                     />
                                 </div>
                                 <div className="ml-0 md:ml-4 flex-1">
                                     <label className="block text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Iniciando no Mês</label>
                                     <select 
                                        value={r.mes_inicio} 
                                        onChange={e => handleRateioChange(r.id, 'mes_inicio', e.target.value)}
                                        className="w-full bg-slate-100 border border-slate-700 rounded p-2 text-sm text-slate-800 font-bold outline-none focus:border-violet-500"
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
                         <button onClick={() => setEditingRateioId(null)} className="px-6 py-2.5 text-xs font-black text-white bg-violet-500 hover:bg-violet-400 rounded-lg uppercase tracking-widest transition-colors shadow-lg shadow-violet-500/20">
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

      {/* ─── MODAL ALTERAÇÕES DE RATEIO (AGO/AGE/Reunião) ─── */}
      {modalAlteracoesMes !== null && (
        <ModalAlteracoesRateio
          condoId={condoId}
          ano={selectedYear}
          mesInicial={modalAlteracoesMes}
          onClose={() => setModalAlteracoesMes(null)}
        />
      )}

      {/* ─── MODAL CONFIRMAÇÃO ENVIO ─── */}
      {showConfirmSend && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 animate-fade-in">
              <div className="absolute inset-0 bg-brand-bg/80 backdrop-blur-md" onClick={() => setShowConfirmSend(false)}></div>
              <div className="glass-panel max-w-2xl w-full p-8 rounded-3xl relative animate-fade-up  border border-slate-200">
                  <div className="flex items-center gap-4 mb-8">
                    <div className="w-16 h-16 bg-violet-500/20 border border-violet-500/30 rounded-2xl flex items-center justify-center ">
                        <Send className="w-8 h-8 text-violet-400" />
                    </div>
                    <div>
                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Enviar para Aprovação</h3>
                        <p className="text-slate-400 text-sm font-medium">Escolha o fluxo de validação deste condomínio.</p>
                    </div>
                  </div>

                  <div className="space-y-3 mb-8">
                      <button
                        onClick={() => setNivelAprovacao(1)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 1 
                            ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10' 
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 1 ? 'border-violet-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 1 && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">Nível 1 - Fração</p>
                          <p className="text-[10px] text-slate-500">Passa por Gerente ➔ Supervisora da Contabilidade</p>
                        </div>
                      </button>

                      <button
                        onClick={() => setNivelAprovacao(2)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 2 
                            ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10' 
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 2 ? 'border-violet-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 2 && <div className="w-2 h-2 rounded-full bg-violet-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">Nível 2 - Sem consumos</p>
                          <p className="text-[10px] text-slate-500">Passa direto para a Supervisora</p>
                        </div>
                      </button>

                      <button
                        onClick={() => setNivelAprovacao(3)}
                        className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                          nivelAprovacao === 3 
                            ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' 
                            : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${nivelAprovacao === 3 ? 'border-emerald-500' : 'border-gray-600'}`}>
                          {nivelAprovacao === 3 && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
                        </div>
                        <div>
                          <p className="text-sm font-black text-slate-900">Nível 3 - Com empresas terceirizadas</p>
                          <p className="text-[10px] text-slate-500">Passa por Gerente ➔ Supervisor dos Gerentes ➔ Supervisora</p>
                        </div>
                      </button>
                  </div>

                  <div className="flex gap-3">
                      <button 
                        onClick={() => setShowConfirmSend(false)}
                        className="flex-1 py-4 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors"
                      >
                          Cancelar
                      </button>
                      <button 
                        onClick={() => handleSend()}
                        className="flex-[2] py-4 bg-violet-500 hover:bg-violet-400 text-slate-950 font-black uppercase tracking-widest rounded-xl transition-all  active:scale-95"
                      >
                          Confirmar Envio
                      </button>
                  </div>

                  <div className="flex justify-between items-center pt-6 border-t border-slate-200 mt-6">
                      <p className="text-[10px] text-rose-400/80 font-bold uppercase tracking-widest max-w-[250px]">
                        * A planilha será bloqueada para edição após o envio.
                      </p>
                      <button onClick={() => setShowConfirmSend(false)} className="px-6 py-2 text-xs font-black text-slate-500 uppercase tracking-widest hover:text-slate-900 transition-colors">Voltar</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}
