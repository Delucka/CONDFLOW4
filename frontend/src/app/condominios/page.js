'use client';
import { useState, useEffect, useRef, memo, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { apiFetcher, apiPost } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { usePipelineConfig } from '@/lib/usePipelineConfig';
import { combina } from '@/lib/busca';
import { Building, PlusCircle, Pencil, Search, X, Loader2, User, Calendar, ShieldCheck, Eye, ChevronLeft, ChevronRight, Timer, Globe, Save, Lock, Unlock, Upload, Users, AlertTriangle, BellRing } from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/utils/supabase/client';

// Modal pesado: carrega sob demanda (fora do bundle inicial da página).
const VisualizadorConferencia = dynamic(() => import('@/components/VisualizadorConferencia'), { ssr: false });
import { getArquivoUrlSeguro } from '@/lib/arquivo';
import Modal from '@/components/Modal';
import TagConsumo from '@/components/TagConsumo';
import TagPrioritario from '@/components/TagPrioritario';
import { lerCondominios, MODELO_CSV } from '@/lib/importarCondominios';
import { btn, cn } from '@/lib/botoes';
import Botao from '@/components/Botao';
import { useAcao } from '@/lib/useAcao';
import { extrairTextoPdf, lerCondominos, exibirCnpj } from '@/lib/importarCondominos';
const PainelMoradores = dynamic(() => import('./PainelMoradores'), { ssr: false });
const PainelPrioridades = dynamic(() => import('@/components/PainelPrioridades'), { ssr: false });

// Estilos do formulário num lugar só — antes cada campo repetia a mesma
// sequência de classes, e mudar um espaçamento significava editar 6 linhas.
const LBL = 'block text-[10px] text-slate-500 font-medium';
const CAMPO = 'w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-sm text-slate-800 outline-none focus:border-violet-500 transition-colors';
const AJUDA = 'text-[11px] text-slate-400 leading-snug';

export default function CondominiosPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [prioridadesOpen, setPrioridadesOpen] = useState(false);
  // Clicar na tag abre o painel de prioridades já focado neste condomínio.
  // Guardado em estado (e não montado na hora) porque o painel é o mesmo da
  // marcação em massa: quem veio corrigir um pode marcar mais alguns sem sair.
  const [focoPrioridade, setFocoPrioridade] = useState(null);
  const abrirPrioridadeDe = (condo) => { setFocoPrioridade(condo); setPrioridadesOpen(true); };

  const [moradoresDe, setMoradoresDe] = useState(null);   // condomínio do painel de moradores
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({ id: '', name: '', due_day: '', due_day_2: '', gerente_id: '', cnpj: '', tem_consumo: false, prazo_expedicao_dia: '', prioridade_motivo: '', usa_filipeta: false });
  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const supabase = createClient();

  // A carteira aberta mora na URL (?carteira=Fulano), não em useState: assim o
  // Voltar do navegador sai da carteira em vez de sair da página, o link pode ser
  // compartilhado, e recarregar não joga o usuário de volta pro início.
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedGerente = searchParams.get('carteira') || null;
  const setSelectedGerente = useCallback((nome) => {
    const p = new URLSearchParams(Array.from(searchParams.entries()));
    if (nome) p.set('carteira', nome); else p.delete('carteira');
    const qs = p.toString();
    router.push(qs ? `/condominios?${qs}` : '/condominios', { scroll: false });
  }, [router, searchParams]);

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
  const [condoFilter, setCondoFilter]     = useState('');  // '' = todos (da seleção) · senão 1 condomínio
  const [mesEdicao, setMesEdicao]         = useState(() => { const m = new Date(); return m.getMonth() === 11 ? 1 : m.getMonth() + 2; }); // default M+1
  // Em massa NÃO reabre o que o gerente já liberou (a previsão dele fica de pé).
  // Marcar aqui força a reabertura mesmo assim.
  const [forcarReabertura, setForcarReabertura] = useState(false);


  // Edicao mensal — abre o ciclo para o mes seguinte
  const _now = new Date();
  const mesAlvoEdicao = _now.getMonth() === 11 ? 1 : _now.getMonth() + 2; // M+1 (getMonth = 0..11)
  const anoAlvoEdicao = _now.getMonth() === 11 ? _now.getFullYear() + 1 : _now.getFullYear();
  const _MESES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  const handleAbrirEdicaoMensal = async () => {
    setForcingAll(true);
    try {
      const payload = { mes: mesEdicao, ano: pipelineAno, forcar_reabertura: forcarReabertura };
      if (condoFilter) payload.condominio_id = condoFilter;
      else if (gerenteFilter) payload.gerente_id = gerenteFilter;
      const res = await apiPost('/api/edicoes-mensais/abrir', payload);
      const mantidos = res.mantidos_liberados || 0;
      const jaAbertos = res.ja_abertos || 0;
      const avisados = res.avisados || 0;
      // O fim do toast responde a pergunta que antes ficava sem resposta:
      // o comunicado saiu? Zero avisados com condomínio no alvo é problema,
      // e aparece na hora — não dias depois, pela boca do gerente.
      addToast(
        `${_MESES[mesEdicao]}/${pipelineAno} aberto · ${res.criados} novos + ${res.reabertos} reabertos`
        + (jaAbertos ? ` · ${jaAbertos} já aberto${jaAbertos !== 1 ? 's' : ''}` : '')
        + (mantidos ? ` · ${mantidos} mantido${mantidos !== 1 ? 's' : ''} liberado${mantidos !== 1 ? 's' : ''}` : '')
        + ` · aviso enviado a ${avisados} gerente${avisados !== 1 ? 's' : ''}`,
        avisados === 0 && (res.total_condos || 0) > 0 ? 'error' : 'success');
    } catch (err) {
      addToast('Erro: ' + err.message, 'error');
    } finally {
      setForcingAll(false);
    }
  };

  // ── Lembrar os gerentes ────────────────────────────────────────────────
  // Duas idas: a primeira só pergunta ao servidor quem vai receber (nada é
  // enviado); a segunda, depois de o master ver a lista, envia. Mandar e-mail
  // para pessoas de verdade merece o segundo clique.
  //
  // O lembrete é por GERENTE, então o filtro de condomínio não entra: vale o
  // filtro de gerente, ou todos.
  const [lembrete, setLembrete] = useState(null);   // prévia aberta no modal
  const payloadLembrete = (confirmar) => {
    const pl = { mes: mesEdicao, ano: pipelineAno, confirmar };
    if (gerenteFilter) pl.gerente_id = gerenteFilter;
    return pl;
  };
  const [pedirPreviaLembrete, buscandoLembrete] = useAcao(async () => {
    const r = await apiPost('/api/edicoes-mensais/lembrar', payloadLembrete(false));
    if (r.vao_receber?.length) { setLembrete(r); return; }
    // Ninguém para lembrar: diz POR QUÊ, em vez de abrir um modal vazio.
    const mesTxt = `${_MESES[r.mes]}/${r.ano}`;
    if (r.lembrados_agora?.length) {
      addToast(`Quem tem pendência em ${mesTxt} já foi lembrado há menos de ${r.intervalo_min} minutos.`);
    } else if (r.nao_abertos && !r.em_dia?.length) {
      addToast(`${mesTxt} ainda não foi aberto — abra o mês antes de lembrar.`, 'error');
    } else {
      addToast(`Ninguém com planilha pendente em ${mesTxt}: está todo mundo em dia.`, 'success');
    }
  });
  const [enviarLembrete, enviandoLembrete] = useAcao(async () => {
    const r = await apiPost('/api/edicoes-mensais/lembrar', payloadLembrete(true));
    setLembrete(null);
    return r;
  }, { sucesso: (r) => `Lembrete enviado a ${r.avisados} gerente${r.avisados !== 1 ? 's' : ''}.` });

  // SWR para Dados de Condomínios e Gerentes
  const { data: condosData, mutate: mutateCondos, isLoading: loadingCondos } = useSWR('/api/condominios', apiFetcher);
  const { data: usersData } = useSWR(user?.role === 'master' ? '/api/usuarios' : null, apiFetcher);

  const condos = condosData?.condos || [];
  const gerentes = (usersData?.usuarios || []).filter(u => u.role === 'gerente');

  // condos[].gerente_id é gerentes.id; o dropdown usa o id do PROFILE — então casamos pela carteira por NOME
  const selGerenteNome = gerentes.find(g => g.id === gerenteFilter)?.full_name || null;
  const condosDaSelecao = gerenteFilter ? condos.filter(c => (c.gerente_name || '') === selGerenteNome) : condos;

  // Quantos condomínios a ação em massa vai atingir, e como descrever isso.
  // Fica AQUI, depois de condosDaSelecao — declarar antes dava ReferenceError
  // (temporal dead zone), que o lint não acusa e só quebra em tempo de execução.
  const alvoCount = condoFilter ? 1 : condosDaSelecao.length;

  // O que vai acontecer se clicar — perguntado ao servidor, que é quem sabe.
  //
  // O botão dizia "abrir outubro para 30 condomínios" e vinha a pergunta certa:
  // "por que todos, se ela já preencheu?". Duas coisas se confundiam ali.
  // PREENCHIDO é a gerente ter digitado a previsão; LIBERADO é ela ter dito que
  // pode emitir. Ela pode ter preenchido dois e liberado nenhum — e aí abrir os
  // trinta está certo, mas o botão não dizia nada sobre os dois que já têm
  // valor esperando conferência.
  const previaUrl = `/api/edicoes-mensais/previa-abertura?mes=${mesEdicao}&ano=${pipelineAno}`
    + (condoFilter ? `&condominio_id=${condoFilter}` : gerenteFilter ? `&gerente_id=${gerenteFilter}` : '');
  const { data: previa } = useSWR(previaUrl, apiFetcher, { keepPreviousData: true });

  const jaLiberados = previa?.ja_liberados ?? 0;
  const jaPreenchidos = previa?.ja_preenchidos ?? 0;
  // Com "reabrir" marcado, os liberados voltam a ser mexidos — e aí o número
  // grande é o certo.
  const vaoAbrir = forcarReabertura ? (previa?.total ?? alvoCount) : (previa?.vao_abrir ?? alvoCount);

  const canEdit = user?.role === 'master';
  const filtered = condos.filter(c => combina(search, c.name, c.gerente_name));

  function openEdit(condo = null) {
    if (condo) {
      setFormData({ 
        id: condo.id,
        name: condo.name,
        due_day: condo.due_day || '',
        due_day_2: condo.due_day_2 || '',
        gerente_id: condo.gerente_id || '',
        cnpj: condo.cnpj || '',
        tem_consumo: !!condo.tem_consumo,
        prazo_expedicao_dia: condo.prazo_expedicao_dia ?? '',
        prioridade_motivo: condo.prioridade_motivo || '',
        usa_filipeta: !!condo.usa_filipeta
      });
    } else {
      setFormData({ id: '', name: '', due_day: '', due_day_2: '', gerente_id: '', cnpj: '', tem_consumo: false, prazo_expedicao_dia: '', prioridade_motivo: '', usa_filipeta: false });
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

  // Qual condominio esta abrindo a previa. Sao ate QUATRO idas ao banco em
  // sequencia aqui embaixo -- sem sinal, o usuario clica no olho, a tela
  // fica parada, e ele clica de novo.
  const [abrindoPrevia, setAbrindoPrevia] = useState(null);

  const handleQuickView = async (condoId) => {
    setAbrindoPrevia(condoId);
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
      let pacote = null;

      if (fileData) {
        if (fileData.pacote_id) {
          // Buscar todos os arquivos do mesmo pacote
          const { data: arquivos } = await supabase
            .from('emissoes_arquivos')
            .select('*')
            .eq('pacote_id', fileData.pacote_id);
          allFiles = arquivos || [];
          const { data: p } = await supabase.from('emissoes_pacotes').select('id, status, nivel_aprovacao, processo_id, mes_referencia, ano_referencia, eh_retificacao, comentario_correcao, correcao_arquivo_url, correcao_arquivo_nome, resposta_correcao_comentario, resposta_correcao_arquivo_url, resposta_correcao_arquivo_nome, resposta_correcao_em').eq('id', fileData.pacote_id).maybeSingle();
          pacote = p;
        } else {
          allFiles = [fileData];
        }

        signedUrl = await getArquivoUrlSeguro(fileData.arquivo_url);
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
      console.error(err);
      addToast('Não foi possível abrir a prévia.', 'error');
    } finally {
      setAbrindoPrevia(null);
    }
  };

  return (
    <div className="animate-fade-in w-full h-full relative space-y-8 pb-20">

      {/* ── Painel de Controle Global (só master) ── */}
      {user?.role === 'master' && (
        <div className="glass-panel p-4 md:p-6 rounded-2xl md:rounded-[2rem] border border-slate-200 shadow-2xl space-y-5">

          {/* Cabeçalho */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                <Globe className="w-4 h-4 text-violet-400" />
              </div>
              <div>
                <p className="text-[10px] font-semibold text-slate-500 ">Painel de Controle Global</p>
                <p className="text-xs font-bold text-slate-900">Período de Edição da Gerência</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              <button onClick={() => setPipelineAno(a => a - 1)} aria-label="Ano anterior"
                className="text-slate-400 hover:text-slate-900 transition-colors">
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <span className="text-xs font-semibold text-slate-800 min-w-[40px] text-center tabular-nums" aria-live="polite">{pipelineAno}</span>
              <button onClick={() => setPipelineAno(a => a + 1)} aria-label="Próximo ano"
                className="text-slate-400 hover:text-slate-900 transition-colors">
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Programação De / Até */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 ">Programar Período de Edição</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold text-slate-500  w-6">De</span>
              <input type="datetime-local" value={dataInicioLocal} onChange={e => setDataInicioLocal(e.target.value)}
                className="flex-1 min-w-[160px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-500/50 transition-all" />
              <span className="text-[10px] font-semibold text-slate-500  w-6">Até</span>
              <input type="datetime-local" value={dataFimLocal} onChange={e => setDataFimLocal(e.target.value)}
                className="flex-1 min-w-[160px] bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-500/50 transition-all" />
              <button onClick={handleSavePeriodo} disabled={savingPeriodo}
                className={cn(btn.pequeno, 'shrink-0')}>
                {savingPeriodo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Salvar
              </button>
              {(dataInicioLocal || dataFimLocal) && (
                <button onClick={() => { setDataInicioLocal(''); setDataFimLocal(''); updatePipeline({ data_inicio: null, prazo_edicao: null }); }}
                  aria-label="Limpar período de edição" title="Limpar período"
                  className={cn(btn.icone, 'shrink-0 border-rose-200 text-rose-500 hover:text-rose-700 hover:border-rose-300')}>
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
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
                    <p className="text-[10px] font-semibold text-rose-400 ">Período Encerrado</p>
                    <p className="text-[10px] text-slate-500">Edição da gerência finalizada</p>
                  </div>
                </>
              ) : (
                <>
                  <Timer className={`w-4 h-4 shrink-0 animate-pulse ${countdown.fase === 'agendado' ? 'text-violet-400' : 'text-emerald-400'}`} />
                  <div className="flex-1">
                    <p className={`text-xs font-medium mb-1 ${countdown.fase === 'agendado' ? 'text-violet-400' : 'text-emerald-400'}`}>
                      {countdown.fase === 'agendado' ? 'Abre em' : 'Fecha em'}
                    </p>
                    <div className="flex gap-3">
                      {[{ v: countdown.d, l: 'd' }, { v: countdown.h, l: 'h' }, { v: countdown.m, l: 'm' }, { v: countdown.s, l: 's' }].map(({ v, l }) => (
                        <div key={l} className="flex items-baseline gap-0.5">
                          <span className="text-sm font-semibold text-slate-900 tabular-nums">{String(v).padStart(2,'0')}</span>
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

          {/* Aplicar para: todos · por gerente · 1-a-1 por condomínio */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-slate-500 ">Aplicar para</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={gerenteFilter} onChange={e => { setGerenteFilter(e.target.value); setCondoFilter(''); }}
                aria-label="Restringir a um gerente"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-500/50 transition-all">
                <option value="">Todos os Gerentes</option>
                {gerentes.map(g => (<option key={g.id} value={g.id}>{g.full_name}</option>))}
              </select>
              <select value={condoFilter} onChange={e => setCondoFilter(e.target.value)}
                aria-label="Restringir a um condomínio"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-500/50 transition-all">
                <option value="">{gerenteFilter ? 'Todos da carteira' : 'Todos os condomínios'}</option>
                {condosDaSelecao.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-500 italic">
              {condoFilter ? <>Aplicando só a <b className="text-slate-700">{condos.find(c => c.id === condoFilter)?.name}</b>.</>
                : gerenteFilter ? <>Carteira de <b className="text-slate-700">{gerentes.find(g => g.id === gerenteFilter)?.full_name}</b>.</>
                : 'Aplicando a todos os condomínios.'}
            </p>
          </div>

          {/* ── AÇÃO PRINCIPAL: ciclo mensal ──────────────────────────────────
              A tela também tinha as ações do processo SEMESTRAL aqui, com o
              mesmo peso visual — origem da confusão de "edição finalizada" em
              mês que nem chegou. Foram removidas: o trabalho é todo mensal. */}
          <div className="rounded-2xl bg-violet-500/5 border border-violet-500/25 p-4 space-y-3">
            <div>
              <p className="text-[10px] font-semibold text-violet-600 ">Ciclo mensal · o dia a dia</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Abre o mês para os gerentes preencherem. O que já foi <b>liberado</b> continua liberado.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <label htmlFor="ciclo-mes" className="text-[10px] font-semibold text-slate-500  block">Mês</label>
                <select id="ciclo-mes" value={mesEdicao} onChange={e => setMesEdicao(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-bold text-slate-800 outline-none focus:border-violet-500 cursor-pointer">
                  {_MESES.slice(1).map((nome, i) => (<option key={i + 1} value={i + 1}>{nome}/{pipelineAno}</option>))}
                </select>
              </div>
              <button onClick={handleAbrirEdicaoMensal} disabled={forcingAll}
                className={cn(btn.primario, 'flex-1 min-w-[200px]')}>
                {forcingAll ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Unlock className="w-4 h-4" aria-hidden="true" />}
                Abrir {_MESES[mesEdicao]} para {vaoAbrir === 1 ? '1 condomínio' : `${vaoAbrir} condomínios`}
                {(jaLiberados > 0 || jaPreenchidos > 0) && (
                  <span className="ml-1 font-normal opacity-75">
                    ·{jaLiberados > 0 && !forcarReabertura
                        ? ` ${jaLiberados} já liberado${jaLiberados !== 1 ? 's' : ''}` : ''}
                    {jaLiberados > 0 && !forcarReabertura && jaPreenchidos > 0 ? ',' : ''}
                    {jaPreenchidos > 0
                        ? ` ${jaPreenchidos} já preenchido${jaPreenchidos !== 1 ? 's' : ''}` : ''}
                  </span>
                )}
              </button>
              <Botao variante="secundario" icone={BellRing} carregando={buscandoLembrete}
                onClick={pedirPreviaLembrete} className="min-w-[170px]"
                title="Manda um lembrete a quem ainda tem planilha para liberar neste mês. Não mexe no quadro.">
                {selGerenteNome ? `Lembrar ${selGerenteNome.split(' ')[0]}` : 'Lembrar gerentes'}
              </Botao>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-600 cursor-pointer select-none">
              <input type="checkbox" checked={forcarReabertura} onChange={e => setForcarReabertura(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-violet-600 focus:ring-violet-500" />
              <span>
                <b>Reabrir também os já liberados</b>
                <span className="block text-slate-400">
                  Desmarcado, a previsão que o gerente já entregou fica de pé. Marque só para forçar todo mundo a revisar.
                </span>
              </span>
            </label>
            <p className="text-[11px] text-slate-500">
              <b>Lembrar</b> só avisa quem ainda tem planilha para liberar, com a lista de cada um. Não mexe no quadro.
            </p>
          </div>


        </div>
      )}

      {/* Header com Busca e Ação */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6 glass-panel p-4 md:p-8 rounded-2xl md:rounded-[2rem] border-slate-200 shadow-2xl">
        <div className="flex-1 w-full max-w-md relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-violet-400 transition-colors" />
          <input
            type="text"
            placeholder="Pesquisar condomínio..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 md:py-4 pl-12 pr-6 text-sm text-slate-800 outline-none focus:border-violet-500/50 transition-all shadow-inner"
          />
        </div>

        {canEdit && (
          <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
            <button
              onClick={() => setPrioridadesOpen(true)}
              className={cn(btn.secundario, 'w-full sm:w-auto')}
              title="Marcar prazo e motivo em vários condomínios de uma vez"
            >
              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Prioridades
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className={cn(btn.secundario, 'w-full sm:w-auto')}
            >
              <Upload className="w-4 h-4" aria-hidden="true" /> Importar
            </button>
            <button
               onClick={() => openEdit()}
               className={cn(btn.primario, 'w-full sm:w-auto')}
            >
              <PlusCircle className="w-5 h-5" aria-hidden="true" /> Novo cadastro
            </button>
          </div>
        )}
      </div>

      {/* Breadcrumb / Back Button */}
      {selectedGerente && !search && (
        <div className="flex items-center gap-4 animate-fade-in">
          <button
            onClick={() => setSelectedGerente(null)}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-violet-600  transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            Voltar para gerentes
          </button>
          <div className="h-4 w-px bg-slate-200"></div>
          <span className="text-xs font-semibold text-violet-600 uppercase tracking-[0.2em]">
            Carteira: {selectedGerente}
          </span>
        </div>
      )}

      {/* Grid de Condomínios */}
      {loadingCondos ? (
        <div className="p-24 text-center">
           <div className="w-10 h-10 border-4 border-violet-500/20 border-t-cyan-500 rounded-full animate-spin mx-auto mb-4"></div>
           <p className="text-[10px] font-semibold text-slate-600 ">Sincronizando base…</p>
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
                        className="glass-panel p-8 rounded-[2.5rem] border-slate-200 hover:border-violet-500/30 transition-all group text-left flex flex-col gap-6 shadow-xl hover:-translate-y-1"
                      >
                        <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center border border-slate-200 group-hover:scale-110 transition-transform shadow-inner">
                           <User className="w-7 h-7 text-violet-400 group-hover:text-violet-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wider mb-2 leading-tight group-hover:text-violet-400 transition-colors">
                            {gName}
                          </h3>
                          <div className="flex items-center gap-2 text-slate-500">
                             <Building className="w-3 h-3" />
                             <span className="text-xs font-medium">{condos.length} Condomínios</span>
                          </div>
                        </div>
                        <div className="mt-auto pt-4 flex items-center gap-2 text-violet-500/50 group-hover:text-violet-400 text-xs font-medium transition-colors">
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
                    <CondoCard key={c.id} c={c} canEdit={canEdit} onEdit={openEdit} onQuickView={handleQuickView} onMoradores={setMoradoresDe} onPrioridade={abrirPrioridadeDe}
                      abrindo={abrindoPrevia === c.id} />
                  ))}
                </div>
              );
            }

            // Fallback para visualização simples (com busca ou para gerente)
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {filtered.map(c => (
                  <CondoCard key={c.id} c={c} canEdit={canEdit} onEdit={openEdit} onQuickView={handleQuickView} onMoradores={setMoradoresDe} onPrioridade={abrirPrioridadeDe}
                      abrindo={abrindoPrevia === c.id} />
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

      {/* Cadastro/Edição — usa o Modal acessível do projeto (Escape, foco preso,
          role="dialog", trava o scroll e vira bottom-sheet no celular). */}
      <Modal open={!!lembrete} onClose={() => setLembrete(null)} maxWidth="max-w-md"
        title={lembrete ? `Lembrar gerentes · ${_MESES[lembrete.mes]}/${lembrete.ano}` : ''}>
        {lembrete && (
          <div className="p-5 sm:p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Cada um recebe, no e-mail e no sino, a lista do que ainda falta liberar. Nada no quadro muda.
            </p>
            <ul className="rounded-xl border border-slate-200">
              {lembrete.vao_receber.map(g => (
                <li key={g.gerente} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm border-b border-slate-100 last:border-0">
                  <span className="font-semibold text-slate-800">{g.gerente}</span>
                  <span className="text-slate-600 tabular-nums">
                    {g.pendentes} para liberar{g.liberados > 0 && <span className="text-slate-400"> · {g.liberados} já liberado{g.liberados !== 1 ? 's' : ''}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {(lembrete.em_dia.length > 0 || lembrete.lembrados_agora.length > 0
              || lembrete.sem_login.length > 0 || lembrete.nao_abertos > 0) && (
              <div className="space-y-1 text-xs text-slate-500">
                {lembrete.em_dia.length > 0 && (
                  <p>Em dia, não recebem: {lembrete.em_dia.map(g => g.gerente).join(', ')}.</p>
                )}
                {lembrete.lembrados_agora.length > 0 && (
                  <p>Lembrados há menos de {lembrete.intervalo_min} min, ficam de fora agora: {lembrete.lembrados_agora.map(g => g.gerente).join(', ')}.</p>
                )}
                {lembrete.sem_login.length > 0 && (
                  <p>Sem acesso ao sistema, não há como avisar: {lembrete.sem_login.map(g => g.gerente).join(', ')}.</p>
                )}
                {lembrete.nao_abertos > 0 && (
                  <p>{lembrete.nao_abertos} condomínio{lembrete.nao_abertos !== 1 ? 's' : ''} ainda não aberto{lembrete.nao_abertos !== 1 ? 's' : ''} neste mês — não entra{lembrete.nao_abertos !== 1 ? 'm' : ''} no lembrete.</p>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Botao variante="discreto" onClick={() => setLembrete(null)}>Cancelar</Botao>
              <Botao variante="primario" icone={BellRing} carregando={enviandoLembrete} onClick={enviarLembrete}>
                Enviar a {lembrete.vao_receber.length} gerente{lembrete.vao_receber.length !== 1 ? 's' : ''}
              </Botao>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={formData.id ? 'Ajustar cadastro' : 'Novo condomínio'}
        maxWidth="max-w-xl"
      >
        <form onSubmit={handleSave} className="p-5 sm:p-6 space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="condo-nome" className={LBL}>
              Nome do condomínio <span className="text-rose-500">*</span>
            </label>
            <input
              id="condo-nome" required autoComplete="off" data-autofocus
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ex.: 480 — Cond. Ed. British"
              className={CAMPO}
            />
            <p className={AJUDA}>Comece pelo código: é por ele que a lista se ordena e a busca encontra.</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="condo-venc1" className={LBL}>Dia de vencimento</label>
            <div className="flex gap-2 max-w-[220px]">
              <input id="condo-venc1" type="number" inputMode="numeric" min="1" max="31" placeholder="1º"
                value={formData.due_day}
                onChange={e => setFormData({ ...formData, due_day: e.target.value })}
                className={CAMPO} aria-label="Primeiro dia de vencimento" />
              <input type="number" inputMode="numeric" min="1" max="31" placeholder="2º"
                value={formData.due_day_2}
                onChange={e => setFormData({ ...formData, due_day_2: e.target.value })}
                className={CAMPO} aria-label="Segundo dia de vencimento (opcional)" />
            </div>
            <p className={AJUDA}>Opcional. O 2º só para vencimento dividido.</p>
          </div>

          {/* Prioritário (0096). O prazo é de ENTREGA, não de pagamento: o
              condomínio pode vencer dia 5 e ter prazo de entrega no dia 20. */}
          <div className="space-y-1.5">
            <label className={LBL}>Prioridade</label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
              <div className="flex items-center gap-2">
                <label htmlFor="condo-prazo" className="text-sm text-slate-600 shrink-0">Entregar até o dia</label>
                <input id="condo-prazo" type="number" inputMode="numeric" min="1" max="31" placeholder="—"
                  value={formData.prazo_expedicao_dia}
                  onChange={e => setFormData({ ...formData, prazo_expedicao_dia: e.target.value })}
                  className={`${CAMPO} max-w-[90px]`} aria-label="Dia limite para expedir" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="condo-motivo" className="text-sm text-slate-600 block">Por que é prioritário</label>
                <textarea id="condo-motivo" rows={2}
                  value={formData.prioridade_motivo}
                  onChange={e => setFormData({ ...formData, prioridade_motivo: e.target.value })}
                  placeholder="Ex.: síndico cobra a entrega no dia 18; contrato exige boleto com 10 dias de antecedência"
                  className={`${CAMPO} resize-y`} />
              </div>
            </div>
            <p className={AJUDA}>
              Preencher qualquer um dos dois marca o condomínio como prioritário em todas as telas.
              O motivo aparece ao passar o mouse na tag — sem ele, &quot;prioritário&quot; vira aviso que todo mundo ignora.
            </p>
          </div>

          {/* Marcação manual do consumo (0091). A relação da operação entrou por
              migration, mas condomínio novo, cadastro duplicado ou mudança de
              contrato precisam de um lugar para ajustar sem passar por SQL. */}
          <div className="space-y-1.5">
            <label className={LBL}>Consumo</label>
            <label htmlFor="condo-consumo"
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer hover:border-slate-300 transition-colors">
              <input id="condo-consumo" type="checkbox"
                checked={!!formData.tem_consumo}
                onChange={e => setFormData({ ...formData, tem_consumo: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-sky-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">Depende de concessionária (água, gás ou energia)</span>
                <span className={AJUDA}>
                  Marca a tag <b>Consumo</b> no painel e faz a emissão perguntar pela fatura
                  e pelo relatório de leitura antes de abrir.
                </span>
              </span>
            </label>
          </div>

          {/* Filipeta (0110). Marcar aqui é o que faz a expedição RECLAMAR
              quando ela não vem — sem a marca, filipeta esquecida é igual a
              filipeta que nunca existiu. */}
          <div className="space-y-1.5">
            <label className={LBL}>Expedição</label>
            <label htmlFor="condo-filipeta"
              className="flex items-start gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 cursor-pointer hover:border-slate-300 transition-colors">
              <input id="condo-filipeta" type="checkbox"
                checked={!!formData.usa_filipeta}
                onChange={e => setFormData({ ...formData, usa_filipeta: e.target.checked })}
                className="mt-0.5 w-4 h-4 accent-amber-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm text-slate-800">Manda filipeta junto com o boleto</span>
                <span className={AJUDA}>
                  Abre a vaga da filipeta no <b>Expedir</b> e faz a fila de impressão avisar
                  quando a remessa chegar sem ela.
                </span>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-1.5">
              <label htmlFor="condo-gerente" className={LBL}>
                Gerente responsável <span className="text-rose-500">*</span>
              </label>
              <select id="condo-gerente" required value={formData.gerente_id}
                onChange={e => setFormData({ ...formData, gerente_id: e.target.value })}
                className={`${CAMPO} cursor-pointer`}>
                <option value="">Selecione um gerente…</option>
                {gerentes.map(g => <option key={g.id} value={g.id}>{g.full_name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="condo-cnpj" className={LBL}>CNPJ</label>
              <input id="condo-cnpj" inputMode="numeric" autoComplete="off"
                value={formData.cnpj}
                onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                placeholder="00.000.000/0001-00"
                className={CAMPO} />
              <p className={AJUDA}>Opcional. Pode preencher depois.</p>
            </div>
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
            <button type="button" onClick={() => setModalOpen(false)}
              className={cn(btn.discreto, 'sm:w-auto')}>
              Cancelar
            </button>
            <button type="submit" disabled={isSaving}
              className={cn(btn.primario, 'flex-1')}>
              {isSaving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="w-4 h-4" aria-hidden="true" />}
              {isSaving ? 'Salvando…' : formData.id ? 'Salvar alterações' : 'Cadastrar condomínio'}
            </button>
          </div>
        </form>
      </Modal>

      <PainelMoradores
        open={!!moradoresDe}
        condominio={moradoresDe}
        onClose={() => setMoradoresDe(null)}
      />

      <PainelPrioridades
        open={prioridadesOpen}
        onClose={() => { setPrioridadesOpen(false); setFocoPrioridade(null); }}
        condominios={condos}
        foco={focoPrioridade}
        onSalvo={() => mutateCondos()}
      />

      <ImportarCondominios
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onPronto={() => { setImportOpen(false); mutateCondos(); }}
        addToast={addToast}
      />
    </div>
  );
}

// ── Importação em lote ────────────────────────────────────────────────────────────
// Fluxo: cola/arquivo → prévia (o servidor simula, sem gravar) → confirmação.
// Nunca sobrescreve condomínio existente; quem já está lá é só reportado.
function ImportarCondominios({ open, onClose, onPronto, addToast }) {
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState(null);   // { resumo, resultados }
  const [linhas, setLinhas] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  // Modo PDF: "Relação de Condôminos" de UM condomínio (unidades + contatos).
  const [pdf, setPdf] = useState(null);         // { condominio, linhas }
  const [nomeCondo, setNomeCondo] = useState('');

  function limpar() {
    setTexto(''); setPrevia(null); setLinhas([]); setErro(null);
    setPdf(null); setNomeCondo('');
  }

  async function lerArquivo(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPrevia(null); setErro(null);

    const ehPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
    if (!ehPdf) { setTexto(await f.text()); setPdf(null); return; }

    // PDF é lido AQUI (pdfjs): a função do Vercel corta em 10s e o pdfplumber
    // levava 3,18s só no menor condomínio da base.
    setOcupado(true);
    try {
      const texto = await extrairTextoPdf(await f.arrayBuffer());
      const { condominio, linhas: lidas, erroGeral } = lerCondominos(texto);
      if (erroGeral) { setErro(erroGeral); return; }
      setPdf({ condominio, linhas: lidas });
      setNomeCondo(`${condominio.codigo} - ${condominio.nome}`);
      setTexto('');
    } catch (e2) {
      setErro('Não consegui ler esse PDF: ' + (e2.message || e2));
    } finally {
      setOcupado(false);
      e.target.value = '';   // permite reescolher o mesmo arquivo
    }
  }

  async function conferir() {
    setErro(null);
    setOcupado(true);
    try {
      if (pdf) {
        const r = await apiPost('/api/condominos/importar', {
          criar_condominio: { name: nomeCondo.trim(), cnpj: pdf.condominio.cnpj },
          linhas: pdf.linhas, confirmar: false,
        });
        setPrevia(r);
        return;
      }
      const { linhas: lidas, erroGeral } = lerCondominios(texto);
      if (erroGeral) { setErro(erroGeral); setPrevia(null); return; }
      setLinhas(lidas);
      const r = await apiPost('/api/condominios/importar', { itens: lidas, confirmar: false });
      setPrevia(r);
    } catch (e2) {
      setErro(e2.message || 'Não consegui conferir.');
    } finally {
      setOcupado(false);
    }
  }

  async function importar() {
    setOcupado(true);
    try {
      if (pdf) {
        const r = await apiPost('/api/condominos/importar', {
          criar_condominio: { name: nomeCondo.trim(), cnpj: pdf.condominio.cnpj },
          linhas: pdf.linhas, confirmar: true,
        });
        addToast(`${r.resumo.inseridos} condômino(s) gravado(s)${r.resumo.condominio_criado ? ' e condomínio criado' : ''}.`, 'success');
      } else {
        const r = await apiPost('/api/condominios/importar', { itens: linhas, confirmar: true });
        addToast(`${r.resumo.inseridos} condomínio(s) importado(s).`, 'success');
      }
      limpar();
      onPronto();
    } catch (e2) {
      addToast('Erro ao importar: ' + (e2.message || e2), 'error');
    } finally {
      setOcupado(false);
    }
  }

  function baixarModelo() {
    // BOM na frente para o Excel abrir com acento correto
    const blob = new Blob(['﻿' + MODELO_CSV], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'modelo-condominios.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const COR = { novo: 'text-emerald-600', novo_sem_email: 'text-amber-600', atualizado: 'text-violet-600', existe: 'text-slate-400', erro: 'text-rose-600' };

  return (
    <Modal open={open} onClose={() => { limpar(); onClose(); }} title="Importar condomínios" maxWidth="max-w-3xl">
      <div className="p-5 sm:p-6 space-y-4">
        {!previa && (
          <>
            {pdf ? (
              /* ── Modo PDF: Relação de Condôminos de um condomínio ── */
              <div className="space-y-3">
                <div className="rounded-xl bg-violet-500/5 border border-violet-500/25 p-4 space-y-3">
                  <p className="text-xs font-medium text-violet-600">Relação de condôminos lida</p>
                  <div className="space-y-1.5">
                    <label htmlFor="imp-nome" className={LBL}>Nome do condomínio</label>
                    <input id="imp-nome" value={nomeCondo} onChange={(e) => setNomeCondo(e.target.value)} className={CAMPO} />
                    <p className={AJUDA}>
                      O relatório traz <b>{pdf.condominio.codigo}</b>; a base usa 3 dígitos (ex.: <code>001 - Nome</code>). Ajuste se precisar.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-600">
                    <span>CNPJ: <b>{exibirCnpj(pdf.condominio.cnpj)}</b></span>
                    <span>Unidades: <b className="tabular-nums">{pdf.condominio.unidades}</b></span>
                    <span>Registros: <b className="tabular-nums">{pdf.linhas.length}</b> (um por e-mail)</span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500">
                  Este relatório não traz CPF, então a verificação de 2ª via continua indisponível — o resto entra normalmente.
                </p>
                <button type="button" onClick={limpar} className="text-[11px] font-bold text-slate-500 hover:text-violet-600">
                  Escolher outro arquivo
                </button>
              </div>
            ) : (
              <>
                <div className="text-[12px] text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
                  <p><b>Vários condomínios:</b> no Excel, selecione as células (com o cabeçalho), <b>Ctrl+C</b>, e cole abaixo.</p>
                  <p>Colunas reconhecidas: <b>Nome</b> (obrigatória), Vencimento, 2º Vencimento, CNPJ, Gerente.</p>
                  <p><b>Um condomínio com seus moradores:</b> escolha o PDF da <b>Relação de Condôminos</b> abaixo.</p>
                  <button type="button" onClick={baixarModelo} className="text-violet-600 hover:text-violet-500 font-bold underline">
                    Baixar modelo .csv
                  </button>
                </div>

                <textarea
                  data-autofocus
                  value={texto}
                  onChange={(e) => { setTexto(e.target.value); setErro(null); }}
                  rows={8}
                  placeholder={'Nome\tVencimento\tCNPJ\n001 - Cond. Ed. Exemplo\t10\t12.345.678/0001-90'}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-800 outline-none focus:border-violet-500 transition-colors"
                />

                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-[11px] font-bold text-slate-600 cursor-pointer hover:text-violet-600">
                    <input type="file" accept=".csv,.txt,text/csv,.pdf,application/pdf" onChange={lerArquivo} className="sr-only" />
                    …ou escolher um arquivo <b>.csv</b> ou <b>.pdf</b>
                  </label>
                  {ocupado && !previa && <span className="text-[11px] text-slate-500">Lendo o PDF…</span>}
                </div>
              </>
            )}

            {erro && (
              <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-xl p-3">{erro}</p>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" onClick={() => { limpar(); onClose(); }}
                className={cn(btn.discreto, 'sm:w-auto')}>
                Cancelar
              </button>
              <button type="button" onClick={conferir} disabled={ocupado || (!pdf && !texto.trim())}
                className={cn(btn.primario, 'flex-1')}>
                {ocupado ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                {ocupado ? 'Conferindo…' : 'Conferir antes de importar'}
              </button>
            </div>
          </>
        )}

        {previa && (
          <>
            {pdf && previa.resumo.condominio && (
              <div className="rounded-xl bg-violet-500/5 border border-violet-500/25 p-3 text-xs text-slate-700">
                <b>{previa.resumo.condominio}</b>{' '}
                <span className="text-slate-500">
                  {previa.resumo.condominio_novo ? '· será criado agora' : '· já existe, os condôminos entram nele'}
                </span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3">
                <p className="text-2xl font-semibold text-emerald-600 tabular-nums">{previa.resumo.novos}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Novos</p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                <p className="text-2xl font-semibold text-slate-500 tabular-nums">
                  {pdf ? previa.resumo.atualizados : previa.resumo.existentes}
                </p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {pdf ? 'Atualizados' : 'Já existem'}
                </p>
              </div>
              <div className="rounded-xl bg-rose-50 border border-rose-200 p-3">
                <p className="text-2xl font-semibold text-rose-600 tabular-nums">{previa.resumo.erros}</p>
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Com erro</p>
              </div>
            </div>

            <p className="text-[11px] text-slate-500">
              {pdf ? (
                <>Nada foi gravado ainda. Ninguém é apagado — quem está no banco e não veio no
                  relatório continua lá{previa.resumo.no_banco_fora_do_relatorio > 0
                    ? ` (${previa.resumo.no_banco_fora_do_relatorio} registro(s))` : ''}.
                  {previa.resumo.sem_email > 0 && ` ${previa.resumo.sem_email} unidade(s) sem e-mail entram mesmo assim.`}</>
              ) : (
                <>Nada foi gravado ainda. Só os <b className="text-emerald-600">novos</b> entram — quem já existe fica intacto.</>
              )}
            </p>

            <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
              {previa.resultados.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
                  <span className="truncate text-slate-700 min-w-0">
                    {pdf ? `${r.unidade}${r.email ? ` · ${r.email}` : ''}` : (r.name || <i>(sem nome)</i>)}
                  </span>
                  <span className={`shrink-0 font-bold ${COR[r.status] || 'text-slate-400'}`}>
                    {r.status === 'novo' ? 'novo'
                      : r.status === 'novo_sem_email' ? 'novo · sem e-mail'
                      : r.status === 'atualizado' ? 'atualizado'
                      : r.motivo}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" onClick={() => setPrevia(null)}
                className={cn(btn.discreto, 'sm:w-auto')}>
                Voltar
              </button>
              <button type="button" onClick={importar}
                disabled={ocupado || (previa.resumo.novos === 0 && !(pdf && previa.resumo.atualizados > 0))}
                className={cn(btn.primario, 'flex-1')}>
                {ocupado ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Upload className="w-4 h-4" aria-hidden="true" />}
                {ocupado ? 'Importando…'
                  : pdf ? `Importar ${previa.resumo.novos + previa.resumo.atualizados} registro(s)`
                  : `Importar ${previa.resumo.novos} condomínio(s)`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Componente Card para evitar repetição
function CondoCardBase({ c, canEdit, onEdit, onQuickView, onMoradores, onPrioridade, abrindo }) {
  return (
    <div className="glass-panel p-5 md:p-6 rounded-2xl md:rounded-[2rem] border-slate-200 hover:border-violet-500/30 transition-all group shadow-xl flex flex-col justify-between h-full">
        <div>
           <div className="flex items-start justify-between mb-6">
              <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center border border-slate-200 group-hover:scale-105 transition-transform shadow-inner">
                 <Building className="w-6 h-6 text-slate-500 group-hover:text-violet-400" />
              </div>
              {canEdit && (
                <button
                  onClick={() => onEdit(c)}
                  aria-label={`Editar cadastro de ${c.name}`}
                  title="Editar cadastro"
                  className="tap inline-flex items-center justify-center bg-slate-50 hover:bg-violet-500/10 text-slate-500 hover:text-violet-500 rounded-xl transition-colors border border-transparent hover:border-violet-500/20">
                   <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
           </div>
           
           <h3 className="text-xl font-semibold text-slate-900 uppercase tracking-tight mb-6 leading-tight group-hover:text-violet-400 transition-colors">
              {c.name}
           </h3>
           
           <div className="space-y-3 mb-8">
              <div className="flex items-center gap-3 text-slate-400">
                 <User className="w-4 h-4 text-violet-400" />
                 <span className="text-xs font-bold">{c.gerente_name || 'Gerente não definido'}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                 <Calendar className="w-4 h-4 text-violet-500" />
                 <span className="text-xs font-bold">Vencimento: Dia {c.due_day || '—'}{c.due_day_2 ? ` e ${c.due_day_2}` : ''}</span>
                 {c.tem_consumo && <TagConsumo />}
                 {c.usa_filipeta && (
                   <span title="Manda filipeta junto com o boleto"
                     className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                     FILIPETA
                   </span>
                 )}
                 <TagPrioritario condo={c} onEditar={onPrioridade} />
              </div>
              <div className="flex items-center gap-3 text-slate-400">
                 <ShieldCheck className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                 {/* Vem do vínculo assistente→gerente (0057), não de um campo do condomínio */}
                 <span className="text-xs font-bold">Assistente: {c.assistente_nome || 'Não vinculado'}</span>
              </div>
           </div>
        </div>

        {/* Navegação é NEUTRA: os quatro levam a lugares, nenhum é mais urgente
            que o outro. Antes um era azul preenchido e os outros cinza, sugerindo
            uma hierarquia que não existe. */}
        <div className="pt-6 border-t border-slate-200 flex gap-2">
           <Botao
             variante="icone"
             icone={Eye}
             onClick={() => onQuickView(c.id)}
             carregando={abrindo}
             aria-label={`Ver última emissão de ${c.name}`}
             title="Ver última emissão" />
           <Link href={`/condominio/${c.id}/arrecadacoes`}
             aria-label={`Abrir planilha de ${c.name}`}
             className={cn(btn.pequeno, 'flex-1')}>Planilha</Link>
           <Link href={`/carteiras/cobrancas?condo=${c.id}`}
             aria-label={`Abrir cobranças extras de ${c.name}`}
             className={cn(btn.pequeno, 'flex-1')}>Cobranças</Link>
           {/* O histórico de emissões do condomínio: mês a mês, com os arquivos
               e o caminho de volta para a emissão. */}
           <Link href={`/condominio/${c.id}/emissoes`}
             aria-label={`Ver histórico de emissões de ${c.name}`}
             className={cn(btn.pequeno, 'flex-1')}>Emissões</Link>
           {canEdit && (
             <button onClick={() => onMoradores(c)}
               aria-label={`Ver moradores de ${c.name}`}
               title="Moradores, CPFs e teste do WhatsApp"
               className={btn.icone}>
               <Users className="w-4 h-4" aria-hidden="true" />
             </button>
           )}
        </div>
    </div>
  );
}

// Memoizado: o pai re-renderiza a cada segundo (countdown) e a cada tecla na busca;
// sem isso, os ~300 cards re-renderizavam junto. Só re-renderiza se mudar o condo ou a permissão.
const CondoCard = memo(CondoCardBase, (prev, next) => prev.c === next.c && prev.canEdit === next.canEdit);
