'use client';
import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import useSWR from 'swr';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import { apiFetcher, apiPost, apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getArquivoUrlSeguro } from '@/lib/arquivo';
import { mesAnoVigente } from '@/lib/mesVigente';
import { useRealtime } from '@/lib/realtime';
import { useRouter } from 'next/navigation';
import TagConsumo from '@/components/TagConsumo';
import TagPrioritario, { ehPrioritario } from '@/components/TagPrioritario';
import dynamic from 'next/dynamic';
const PainelPrioridades = dynamic(() => import('@/components/PainelPrioridades'), { ssr: false });
import { combina } from '@/lib/busca';
import {
  Building, FileEdit, Clock, CheckCircle2, Inbox, Layers, Receipt,
  AlertCircle, Eye, ShieldCheck, MessageSquare, Send, Loader2,
  FileCheck, User, Activity, Zap, Lock, Unlock, Timer, TrendingUp,
  ClipboardList, CalendarClock, BarChart3, ChevronRight, ArrowUpDown, Search, X, Ban
} from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
// A fila dispara até 8 consultas próprias (ocorrências, profiles, condomínios e
// contagens de pacotes). Carregada junto, ela competia com a lista de
// condomínios — que é o que a pessoa veio ver. Agora entra depois, sem segurar
// a primeira pintura da tela.
const FilaOcorrencias = dynamic(
  () => import('@/app/central-emissoes/components/FilaOcorrencias'),
  { ssr: false, loading: () => <div className="h-40 rounded-2xl bg-slate-100 animate-pulse" /> },
);
import { SkeletonTable } from '@/components/Skeleton';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { btn, cn } from '@/lib/botoes';
import { tipo, raio } from '@/lib/tipografia';

// Trabalhamos 1 mês à frente: o padrão das telas é o mês VIGENTE (M+1).
// O cálculo fica DENTRO do componente (useState), não aqui no escopo do módulo:
// aqui ele congelaria no carregamento do bundle — numa aba deixada aberta na virada
// do mês, o painel seguiria no mês velho. Dentro, recalcula a cada montagem.
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
  const [buscaCondo, setBuscaCondo] = useState('');
  // Recalculado a cada montagem da tela (ver nota no topo do arquivo)
  const [vigente] = useState(mesAnoVigente);
  const [mesEmissao, setMesEmissao] = useState(vigente.mes);
  const [ordemAsc, setOrdemAsc] = useState(true);
  const [situacao, setSituacao] = useState('todos');
  const [prioridadesOpen, setPrioridadesOpen] = useState(false);
  // Clicar na tag abre o painel de prioridades já focado neste condomínio.
  // Guardado em estado (e não montado na hora) porque o painel é o mesmo da
  // marcação em massa: quem veio corrigir um pode marcar mais alguns sem sair.
  const [focoPrioridade, setFocoPrioridade] = useState(null);
  const abrirPrioridadeDe = (condo) => { setFocoPrioridade(condo); setPrioridadesOpen(true); };

  const isMobile = useIsMobile();

  // Persiste o mês escolhido: mantém ao sair/voltar; só muda quando o usuário troca
  useEffect(() => { const v = parseInt(localStorage.getItem('dash_mes') || '', 10); if (v >= 1 && v <= 12) setMesEmissao(v); }, []);
  useEffect(() => { try { localStorage.setItem('dash_mes', String(mesEmissao)); } catch {} }, [mesEmissao]);

  const { user, profile } = useAuth();
  const supabase = createClient();
  const { addToast } = useToast();
  const router = useRouter();

  // Quem FAZ a emissão vê esta tela de outro jeito. O gerente precisa da
  // planilha e das cobranças à mão; a emissão vê a planilha dentro da própria
  // emissão, e cobrança extra é esporádica — mora no menu da esquerda. Aqui a
  // linha inteira é um atalho para montar a emissão daquele condomínio.
  // O master faz as duas coisas, então escolhe a visão. O departamento só emite;
  // o gerente e o assistente nunca veem esse alternador.
  const [visaoMaster, setVisaoMaster] = useState('emissao');   // 'emissao' | 'gerencia'
  useEffect(() => {
    const v = localStorage.getItem('dash_visao');
    if (v === 'emissao' || v === 'gerencia') setVisaoMaster(v);
  }, []);
  useEffect(() => { try { localStorage.setItem('dash_visao', visaoMaster); } catch {} }, [visaoMaster]);

  const podeAlternarVisao = profile?.role === 'master';
  const fazEmissao = profile?.role === 'departamento'
    || (profile?.role === 'master' && visaoMaster === 'emissao');

  // Clicar na linha abre a emissão para QUEM EMITE, nas duas visões.
  //
  // Antes isso dependia do alternador: o master que um dia escolheu "Gerência"
  // ficava com a escolha gravada no navegador, e a partir daí clicar na linha
  // não fazia nada. Sem retorno nenhum na tela, a conclusão natural era "o
  // atalho não funciona" — e a pessoa passava a ir pelo menu, caindo no Painel
  // de Gestão em vez da emissão.
  //
  // O alternador continua valendo para o que MOSTRA (os atalhos de planilha e
  // cobranças na linha). O que ele não faz mais é desligar o clique.
  const podeEmitir = profile?.role === 'departamento' || profile?.role === 'master';

  // Concessionárias por condomínio (0036) — quem tem água/gás/energia precisa de
  // fatura e relatório antes de emitir, e é o que a tela pergunta ao abrir.


  // Confirmação antes de sair para a emissão: { condo, concessionarias }
  const [confirmarConsumo, setConfirmarConsumo] = useState(null);
  // O que a API sabe das contas daquele mês: se já foi anexada, quando é a
  // leitura, e se já existe cobrança. É a informação que decide se dá para
  // emitir agora ou se é hora de cobrar.
  const [contasDoModal, setContasDoModal] = useState(null);   // null = carregando
  const [cobrandoConta, setCobrandoConta] = useState(null);

  useEffect(() => {
    if (!confirmarConsumo) { setContasDoModal(null); return; }
    let vivo = true;
    (async () => {
      try {
        const r = await apiFetch(`/api/contas-esperadas?condominio_id=${confirmarConsumo.condo.id}&mes=${mesEmissao}&ano=${vigente.ano}`);
        if (vivo) setContasDoModal(r?.contas || []);
      } catch {
        if (vivo) setContasDoModal([]);   // sem isto o modal ficaria girando para sempre
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmarConsumo, mesEmissao]);

  async function cobrarConta(conc) {
    setCobrandoConta(conc);
    try {
      const r = await apiPost('/api/cobrancas-contas/cobrar-direto', {
        condominio_id: confirmarConsumo.condo.id,
        concessionaria: conc,
        mes_referencia: mesEmissao,
        ano_referencia: vigente.ano,
      });
      const para = (r?.enviados_para || []).join(', ');
      addToast(para ? `Cobrança enviada para ${para}.` : 'Cobrança enviada.', 'success');
      const novo = await apiFetch(`/api/contas-esperadas?condominio_id=${confirmarConsumo.condo.id}&mes=${mesEmissao}&ano=${vigente.ano}`);
      setContasDoModal(novo?.contas || []);
    } catch (e) {
      addToast('Não consegui cobrar: ' + (e.message || e), 'error');
    } finally {
      setCobrandoConta(null);
    }
  }

  function irParaEmissao(condo) {
    const q = `condo=${condo.id}&mes=${mesEmissao}&ano=${vigente.ano}&tab=upload`;
    router.push(`/central-emissoes?${q}`);
  }

  // Tem consumo, pergunta antes: abrir a emissão sem a fatura em mãos é o
  // começo de um pacote que vai ficar parado esperando.
  //
  // Quem decide é `condominios.tem_consumo` (0091), a relação que a operação
  // usa. `condominios_concessionarias` (0036) entra só para DIZER quais são —
  // ela veio de uma planilha de 2025 e nem sempre tem todas.
  function abrirEmissao(condo) {
    if (condo.tem_consumo) {
        // eslint-disable-next-line no-use-before-define -- roda no clique, depois do render
      setConfirmarConsumo({ condo, concessionarias: concessionariasPorCondo[condo.id] || [] });
    } else {
      irParaEmissao(condo);
    }
  }

  const [arquivoConferencia, setArquivoConferencia] = useState(null);
  const [processing, setProcessing] = useState(null);
  const [showRejectModal, setShowRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const dashParams = new URLSearchParams();
  if (filtroGerente) dashParams.set('gerente_id', filtroGerente);
  dashParams.set('mes', String(mesEmissao));
  dashParams.set('ano', String(vigente.ano));
  const { data, error, isLoading, mutate } = useSWR(`/api/dashboard?${dashParams.toString()}`, apiFetcher, {
    // Sem isto o painel ficava congelado ao voltar de outra janela. O dedupe de
    // 30s + o throttle do provider já seguram a rajada de alt-tab.
    revalidateOnFocus: true,
    dedupingInterval: 30000,
    keepPreviousData: true,
    errorRetryCount: 4,
    errorRetryInterval: 4000,   // aguenta o cold start: re-tenta enquanto a função "esquenta"
  });

  // Single source: tudo vem do endpoint /api/dashboard agora
  const pipelineConfig      = data?.pipeline_config || null;
  const emissaoStats        = data?.emissao_stats   || { gerente: 0, supGerente: 0, supContabilidade: 0, aguardando: 0, registrada: 0 };
  const emissaoByCondominio = data?.emissao_by_condo || {};
  // Quantas emissões canceladas cada condomínio tem no mês. Separado do
  // status porque a cancelada perde a vaga para a emissão que a substituiu:
  // sem este contador, ela some justamente da tela onde se decide o mês.
  const canceladasPorCondo = data?.canceladas_by_condo || {};
  // Vem dentro do painel. Era uma consulta direta do navegador ao Supabase para
  // um mapa que a resposta já podia trazer.
  //
  // Fica AQUI, e não lá em cima junto do estado que ela substituiu: `data` só
  // existe a partir do useSWR acima, e ler antes disso é a zona morta do
  // const — o build passa, e a tela morre no navegador com "Cannot access
  // before initialization". Foi exatamente o que aconteceu.
  const concessionariasPorCondo = data?.concessionarias_por_condo || {};
  // Sobe para cá porque o `useMemo` do filtro lê isto durante o render — e
  // useMemo executa na hora. Declarado depois, cairia na zona morta do const
  // e derrubaria o painel no primeiro clique de filtro.
  const processos = data?.processos || {};
  const countdown           = useCountdown(pipelineConfig);

  // Status da edição mensal (edicoes_mensais) por condomínio — VENCE o status
  // semestral no painel: quando o gerente "libera este mês", o painel reflete.
  // Usa o endpoint que JÁ existe na VPS (sem precisar de deploy do backend).
  // As edicoes ja vem dentro de /api/dashboard. Enquanto a API nova nao estiver
  // no ar (o deploy dela e separado, na VPS), o endpoint antigo cobre a falta —
  // por isso a chamada continua aqui, condicional: some sozinha quando o campo
  // aparece na resposta, sem versao quebrada no meio do caminho.
  const edicoesJuntas = data?.edicoes;
  // Enquanto o painel nao respondeu, `data` e undefined — e a condicao anterior
  // (`edicoesJuntas ? null : url`) disparava a chamada antiga nesse instante,
  // que e justamente o instante da abertura. O pedido so faz sentido DEPOIS de
  // saber que a resposta veio sem o campo, ou seja, com a API antiga no ar.
  const precisaEdicoesSeparadas = !!data && data.edicoes === undefined;
  const { data: edicoesData, mutate: mutateEdicoes } = useSWR(
    precisaEdicoesSeparadas ? `/api/edicoes-mensais?ano=${vigente.ano}` : null,
    apiFetcher,
    { revalidateOnFocus: true, dedupingInterval: 30000, keepPreviousData: true },
  );
  const EDI_TO_PROC = { em_edicao: 'Em edição', edicao_finalizada: 'Edição finalizada', reabertura_solicitada: 'Solicitar alteração' };
  // Indexado por condomínio + MÊS. Antes pegava só a edição mais recente do condomínio,
  // qualquer que fosse o mês: quem adiantou a previsão de nov/dez e liberou aparecia como
  // "Edição finalizada" mesmo com o painel mostrando setembro — meses que nem chegaram.
  const edicaoByCondoMes = useMemo(() => {
    const m = {};
    // Vem de dentro do painel quando a API ja manda junto; do endpoint antigo
    // enquanto nao mandar.
    for (const e of (edicoesJuntas || edicoesData?.edicoes || [])) {
      const k = `${e.condominio_id}|${e.mes_referencia}`;
      if (!(k in m)) m[k] = e.status;   // rows já vêm desc por aberto_em → 1ª = mais recente do mês
    }
    return m;
  }, [edicoesJuntas, edicoesData]);
  // Status efetivo da Planilha DO MÊS EXIBIDO; sem edição no mês, cai no semestral.
  const statusPlanilha = (condoId) => EDI_TO_PROC[edicaoByCondoMes[`${condoId}|${mesEmissao}`]] || null;

  // Realtime compartilhado: uma assinatura por tabela na aba inteira, em vez de
  // uma por componente. Antes, aprovar um pacote disparava rebusca aqui, na
  // Central, na fila, no sino e nos meses travados — tudo ao mesmo tempo.
  useRealtime(['emissoes_pacotes', 'processos', 'pipeline_config'], () => mutate());
  useRealtime(['edicoes_mensais'], () => mutateEdicoes());

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
      addToast('Não foi possível abrir a prévia.', 'error');
    }
  };

  // Os arquivos da emissão cancelada.
  //
  // Cancelar não apaga: os anexos continuam lá, presos ao pacote cancelado. Só
  // que a prévia do painel abre o arquivo MAIS RECENTE do condomínio, que é da
  // emissão nova — então a cancelada era a única cujos arquivos não tinham
  // porta de entrada nenhuma nesta tela.
  const handleVerCancelada = async (condoId) => {
    try {
      const { data: p, error } = await supabase
        .from('emissoes_pacotes')
        .select('id, status, nivel_aprovacao, processo_id, mes_referencia, ano_referencia, eh_retificacao, cancelamento_motivo, cancelada_por_nome, cancelada_em')
        .eq('condominio_id', condoId)
        .eq('mes_referencia', mesEmissao)
        .eq('ano_referencia', vigente.ano)
        .eq('status', 'cancelada')
        .order('cancelada_em', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) { addToast('Não foi possível abrir a cancelada: ' + error.message, 'error'); return; }
      if (!p) { addToast('Emissão cancelada não encontrada neste mês.', 'warning'); return; }

      const { data: arquivos } = await supabase
        .from('emissoes_arquivos').select('*').eq('pacote_id', p.id);
      const lista = arquivos || [];
      if (!lista.length) { addToast('A emissão cancelada não tem arquivos anexados.', 'warning'); return; }

      const url = await getArquivoUrlSeguro(lista[0].arquivo_url);
      setArquivoConferencia({
        id: lista[0].id,
        nome: lista[0].arquivo_nome || 'Documento',
        url,
        condominio_id: condoId,
        processo_id: p.processo_id || null,
        pacote_id: p.id,
        pacote_status: p.status,
        pacote_nivel: p.nivel_aprovacao,
        mes: p.mes_referencia,
        ano: p.ano_referencia,
        eh_retificacao: p.eh_retificacao || false,
        arquivos: lista,
      });
    } catch (err) {
      addToast('Não foi possível abrir os arquivos da emissão cancelada.', 'error');
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

  // Hooks SEMPRE antes de qualquer return condicional (Regras dos Hooks)
  const condos = data?.condos || [];
  const temCanceladasNoMes = Object.keys(canceladasPorCondo).length > 0;
  // Cadastrados que ainda vao entrar. Nao aparecem na lista de trabalho, mas
  // aparecem no contador e num filtro proprio: 259 condominios parados sao uma
  // boa pergunta para alguem fazer todo mes, e um numero que ninguem ve e um
  // numero que ninguem confere.
  // Quantos esperam entrar. Só o número: a lista alimentava uma aba que não
  // existe mais, porque quem libera o condomínio é a liberação do gerente.
  const aEntrarTotal = data?.a_entrar_total || 0;

  // Filtro por situação — o mesmo de Fazer Emissões, porque o painel virou a
  // tela de trabalho de quem emite: a linha inteira já leva para a emissão.
  const SITUACOES = [
    { id: 'todos',       rotulo: 'Todos' },
    { id: 'liberados',   rotulo: 'Liberados' },
    { id: 'com_gerente', rotulo: 'Com o gerente' },
    { id: 'sem_emissao', rotulo: 'Sem emissão' },
    { id: 'em_emissao',  rotulo: 'Em emissão' },
    { id: 'prioritarios', rotulo: 'Prioritários' },
    // Só aparece quando existe alguma no mês: um filtro que nunca acha nada é
    // pior do que não existir — ensina que a busca não funciona.
    ...(temCanceladasNoMes ? [{ id: 'canceladas', rotulo: 'Canceladas' }] : []),
    // A aba "A entrar" saiu.
    //
    // Quem libera o condomínio é a liberação do GERENTE: o condomínio vem
    // vinculado a ele e entra junto. Uma aba separada, visível para todo mundo,
    // oferecia uma segunda porta para a mesma decisão — e quem não decide isso
    // não tem o que fazer com ela.
  ];

  const condosOrdenados = useMemo(() => {
    const codeOf = (n) => { const m = String(n || '').match(/^\s*0*(\d+)/); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; };

    const passa = (c) => {
      if (situacao === 'todos') return true;
      const plan = statusPlanilha(c.id) || processos[c.id]?.status || null;
      const emis = emissaoByCondominio[c.id] || null;
      switch (situacao) {
        // O gerente terminou e passou para nós. 'Edição finalizada' é o estado
        // do mês liberado; 'Entregue' é como o badge o chama na tela.
        case 'liberados':    return plan === 'Edição finalizada';
        case 'com_gerente':  return plan === 'Em edição' || plan === 'Solicitar alteração';
        case 'sem_emissao':  return !emis;
        case 'em_emissao':   return !!emis;
        case 'prioritarios': return ehPrioritario(c);
        case 'canceladas':   return (canceladasPorCondo[c.id] || 0) > 0;
        default: return true;
      }
    };

    const achados = condos
      .filter(passa)
      .filter(c => combina(buscaCondo, c.name, c.gerente_name));

    // SEMPRE por código. O filtro muda o que aparece, nunca a ordem — a lista é
    // percorrida de cima a baixo no dia a dia, e ordem que se reorganiza sozinha
    // faz perder o lugar. Para ver só os prioritários existe o filtro.
    return achados.sort((a, b) => (
      ordemAsc ? codeOf(a.name) - codeOf(b.name) : codeOf(b.name) - codeOf(a.name)
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [condos, ordemAsc, buscaCondo, situacao, processos, emissaoByCondominio, canceladasPorCondo]);
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

  if (error && !data) {   // só bloqueia se NÃO houver nenhum dado (com cache, mostra os dados e revalida em silêncio)
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center glass-panel rounded-3xl">
        <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
        <h3 className={`${tipo.titulo} mb-2`}>Erro de conexão</h3>
        <p className="text-slate-400 mb-6">Não foi possível carregar os dados do painel. O servidor pode estar iniciando — tente de novo em alguns segundos.</p>
        <button onClick={() => mutate()} className={btn.primario}>Tentar novamente</button>
      </div>
    );
  }

  const statsBase = data?.stats || { total: 0, em_edicao: 0, pendentes: 0, aprovados: 0 };
  // Recalcula as contagens considerando a edição mensal (que vence o semestral),
  // pra o contador "Em edição" bater com os badges das linhas.
  const stats = (() => {
    const procs = data?.processos || {};
    if (!condos.length) return statsBase;
    let em_edicao = 0, pendentes = 0, aprovados = 0;
    for (const c of condos) {
      const eff = statusPlanilha(c.id) || procs[c.id]?.status || null;
      if (eff === 'Em edição' || eff === 'Solicitar alteração') em_edicao++;
      else if (eff === 'Enviado' || eff === 'Em aprovação') pendentes++;
      else if (eff === 'Aprovado' || eff === 'Emitido') aprovados++;
      else if (!eff) em_edicao++;
      // 'Edição finalizada' → não conta em nenhum bucket
    }
    return { ...statsBase, em_edicao, pendentes, aprovados };
  })();
  const gerentes = data?.gerentes || [];
  const gerenteNomePorId = {};
  gerentes.forEach(g => { gerenteNomePorId[g.id] = g.profiles?.full_name || g.nome || null; });

  // ═══════════════ INÍCIO — versão de celular (layout de app) ═══════════════
  if (isMobile) {
    return (
      <div className="animate-fade-in space-y-4">

        {/* Cabeçalho: mês da emissão */}
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Emissões de</p>
            <p className="text-2xl font-black text-slate-900 leading-tight truncate">
              {MESES[mesEmissao]} <span className="text-slate-400">{vigente.ano}</span>
            </p>
          </div>
          <select
            value={mesEmissao}
            onChange={(e) => setMesEmissao(Number(e.target.value))}
            aria-label="Mês da emissão"
            className="shrink-0 text-xs font-bold bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-slate-700 outline-none focus:border-violet-500"
          >
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </div>

        {/* Resumo em 3 números */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-2xl bg-amber-50 p-3">
            <p className="text-2xl font-black text-amber-600 leading-none tabular-nums">{isLoading ? '·' : stats.em_edicao}</p>
            <p className="text-[10px] font-bold text-slate-500 mt-1.5 leading-tight">Em edição</p>
          </div>
          <div className="rounded-2xl bg-slate-100 p-3">
            <p className="text-2xl font-black text-slate-700 leading-none tabular-nums">{isLoading ? '·' : emissaoStats.aguardando}</p>
            <p className="text-[10px] font-bold text-slate-500 mt-1.5 leading-tight">Aguard. registro</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3">
            <p className="text-2xl font-black text-emerald-600 leading-none tabular-nums">{isLoading ? '·' : emissaoStats.registrada}</p>
            <p className="text-[10px] font-bold text-slate-500 mt-1.5 leading-tight">Registradas</p>
          </div>
        </div>

        {/* Busca por condomínio (código ou nome) ou gerente */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            value={buscaCondo}
            onChange={(e) => setBuscaCondo(e.target.value)}
            placeholder="Buscar condomínio ou gerente…"
            aria-label="Buscar condomínio"
            className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-9 pr-9 py-3 text-slate-700 outline-none focus:border-violet-500"
          />
          {buscaCondo && (
            <button onClick={() => setBuscaCondo('')} aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtro por gerente (oculto pro próprio gerente) */}
        {user?.role !== 'gerente' && gerentes.length > 0 && (
          <select
            value={filtroGerente}
            onChange={(e) => setFiltroGerente(e.target.value)}
            aria-label="Filtrar por gerente"
            className="w-full text-sm font-bold bg-white border border-slate-200 rounded-xl px-3 py-3 text-slate-700 outline-none focus:border-violet-500"
          >
            <option value="">Todos os gerentes</option>
            {gerentes.map((g) => (
              <option key={g.id} value={g.id}>{g.profiles?.full_name || g.nome || '—'}</option>
            ))}
          </select>
        )}

        {/* Cabeçalho da lista + ordenação */}
        <div className="flex items-center justify-between px-0.5 pt-1">
          <h3 className="text-sm font-black text-slate-900">
            Condomínios <span className="text-slate-400">({condosOrdenados.length})</span>
          </h3>
          <button
            onClick={() => setOrdemAsc(v => !v)}
            className="tap inline-flex items-center gap-1 text-[11px] font-bold text-slate-500"
            aria-label="Inverter ordem"
          >
            <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" /> {ordemAsc ? 'Menor → maior' : 'Maior → menor'}
          </button>
        </div>

        {/* Lista de condomínios (cards) */}
        {isLoading ? (
          <div className="space-y-2.5">
            {[...Array(6)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : condosOrdenados.length === 0 ? (
          <div className="py-16 text-center">
            <Inbox className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-bold">Nenhum condomínio encontrado</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {condosOrdenados.map((c) => {
              const proc          = processos[c.id];
              const procStatus    = statusPlanilha(c.id) || proc?.status || null;
              const emissaoStatus = emissaoByCondominio[c.id] || null;
              const isLocked      = procStatus === 'Edição finalizada';
              return (
                <div key={c.id} className="bg-white rounded-2xl border border-slate-200 p-3.5">
                  {(canceladasPorCondo[c.id] || 0) > 0 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleVerCancelada(c.id); }}
                      title="Ver os arquivos da emissão cancelada"
                      className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 active:bg-rose-100">
                      <Ban className="h-3 w-3" aria-hidden="true" />
                      {(canceladasPorCondo[c.id] || 0) === 1 ? 'Há emissão cancelada neste mês' : `Há ${canceladasPorCondo[c.id]} emissões canceladas neste mês`}
                      <span className="font-bold normal-case tracking-normal opacity-80">· ver arquivos</span>
                    </button>
                  )}
                  {/* Nome */}
                  <div className="flex items-center gap-2.5 mb-1">
                    {isLocked
                      ? <Lock className="w-4 h-4 text-rose-500 shrink-0" aria-label="Edição finalizada" />
                      : <Unlock className="w-4 h-4 text-emerald-500 shrink-0" aria-label="Edição aberta" />}
                    <p className="flex-1 min-w-0 font-black text-slate-900 text-[13px] uppercase tracking-tight break-words">{c.name}</p>
                  </div>
                  {/* Gerente + vencimento */}
                  <p className="text-[11px] text-slate-500 font-medium mb-2.5 pl-[26px]">
                    {gerenteNomePorId[c.gerente_id] || c.gerente_name || '—'}
                    {c.due_day && <span className="text-slate-400"> · venc. dia {c.due_day}{c.due_day_2 ? ` e ${c.due_day_2}` : ''}</span>}
                  </p>
                  {/* Status */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 pl-[26px]">
                    <div className="flex items-center gap-1.5">
                      <span className={tipo.rotulo}>Planilha</span>
                      {procStatus ? <StatusBadge status={procStatus} flow="processo" /> : <span className="text-[10px] text-slate-400 font-bold">—</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={tipo.rotulo}>Emissão</span>
                      {emissaoStatus ? <StatusBadge status={emissaoStatus} flow="emissao" /> : <span className="text-[10px] text-slate-400 font-bold">—</span>}
                    </div>
                  </div>
                  {/* Ações — navegação é neutra: os três só levam a lugares */}
                  <div className="grid grid-cols-3 gap-2">
                    <Link href={`/condominio/${c.id}/arrecadacoes`} className={cn(btn.pequeno, 'py-2.5')}>
                      <Layers className="w-3.5 h-3.5" aria-hidden="true" /> Planilha
                    </Link>
                    <Link href={`/carteiras/cobrancas?condo=${c.id}`} className={cn(btn.pequeno, 'py-2.5')}>
                      <Receipt className="w-3.5 h-3.5" aria-hidden="true" /> Cobranças
                    </Link>
                    <button onClick={() => handleQuickView(c.id)} className={cn(btn.pequeno, 'py-2.5')}>
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" /> Ver
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Prévia/conferência (botão "Ver") */}
        {arquivoConferencia && (
          <VisualizadorConferencia
            arquivo={arquivoConferencia}
            arquivos={arquivoConferencia.arquivos}
            currentUser={user}
            onClose={() => setArquivoConferencia(null)}
            onAction={() => { mutate(); setArquivoConferencia(null); }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in w-full h-full relative space-y-4 pb-12">

      {/* ── TOPO: Tabela Situação Semestral + Fila de Conferência ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Tabela de Condomínios (Esquerda - 2/3) */}
        <div className="lg:col-span-2 glass-panel rounded-xl overflow-hidden flex flex-col">
          {/* Cabeçalho + busca. Antes eram três controles do mesmo tamanho lado a
              lado, o placeholder cortava no meio ("Buscar condomínio (código ou no…")
              e nada dizia quantos resultados sobraram. Agora a BUSCA é larga e
              sozinha na linha; mês e gerente ficam abaixo, menores, com o total. */}
          <div className="px-4 py-3.5 border-b border-slate-200 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className={tipo.secao}>Condomínios</h3>
                <p className={tipo.auxiliar}>
                  Planilha e emissão de {MESES[mesEmissao]}/{vigente.ano}
                </p>
              </div>
              <p className={tipo.auxiliar}>
                <span className="tabular-nums font-medium text-slate-600">{condosOrdenados.length}</span>
                {condosOrdenados.length !== condos.length && (
                  <span className="tabular-nums"> de {condos.length}</span>
                )} {condosOrdenados.length === 1 ? 'condomínio' : 'condomínios'}
              </p>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              <input
                value={buscaCondo}
                onChange={(e) => setBuscaCondo(e.target.value)}
                placeholder="Buscar por código, nome ou gerente"
                aria-label="Buscar condomínio"
                className={`w-full text-sm bg-white border border-slate-200 ${raio.controle} pl-9 pr-9 py-2.5 text-slate-800 outline-none focus:border-violet-500 transition-colors`}
              />
              {buscaCondo && (
                <button onClick={() => setBuscaCondo('')} aria-label="Limpar busca"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* O master trabalha dos dois lados: emitindo, a linha leva à
                  emissão; na gerência, voltam os atalhos de planilha e cobrança. */}
              <button
                type="button"
                onClick={() => setPrioridadesOpen(true)}
                title="Marcar prazo e motivo em vários condomínios de uma vez"
                className={`inline-flex items-center gap-1.5 border border-slate-200 bg-white ${raio.controle} px-2.5 py-1.5 text-[13px] text-slate-700 hover:bg-slate-100 transition-colors`}
              >
                <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" /> Prioridades
              </button>

              {podeAlternarVisao && (
                <div className={`inline-flex border border-slate-200 ${raio.controle} overflow-hidden`} role="group" aria-label="Visão do painel">
                  {[
                    { id: 'emissao',  rotulo: 'Emissão',  dica: 'Linha limpa, focada em montar a emissão' },
                    { id: 'gerencia', rotulo: 'Gerência', dica: 'Mostra também atalhos de planilha e cobranças (clicar na linha continua abrindo a emissão)' },
                  ].map(v => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVisaoMaster(v.id)}
                      title={v.dica}
                      aria-pressed={visaoMaster === v.id}
                      className={`px-2.5 py-1.5 text-[13px] transition-colors ${
                        visaoMaster === v.id
                          ? 'bg-violet-600 text-white font-semibold'
                          : 'bg-white text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {v.rotulo}
                    </button>
                  ))}
                </div>
              )}

              <select
                value={mesEmissao}
                onChange={(e) => setMesEmissao(Number(e.target.value))}
                aria-label="Mês de referência"
                className={`text-[13px] bg-white border border-slate-200 ${raio.controle} px-2.5 py-1.5 text-slate-700 outline-none focus:border-violet-500 cursor-pointer`}
              >
                {MESES.slice(1).map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}/{vigente.ano}</option>
                ))}
              </select>

              <span className="w-full flex flex-wrap gap-1.5 order-last">
                {SITUACOES.map(f => (
                  <button key={f.id} type="button" onClick={() => setSituacao(f.id)} aria-pressed={situacao === f.id}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                      situacao === f.id
                        ? 'border-violet-600 bg-violet-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'}`}>
                    {f.rotulo}
                  </button>
                ))}
              </span>

              {user?.role !== 'gerente' && (
                <select
                  value={filtroGerente}
                  onChange={(e) => setFiltroGerente(e.target.value)}
                  aria-label="Filtrar por gerente"
                  className={`text-[13px] bg-white border ${filtroGerente ? 'border-violet-400 text-violet-700' : 'border-slate-200 text-slate-700'} ${raio.controle} px-2.5 py-1.5 outline-none focus:border-violet-500 cursor-pointer max-w-[190px]`}
                >
                  <option value="">Todos os gerentes</option>
                  {gerentes.map((g) => (
                    <option key={g.id} value={g.id}>{g.profiles?.full_name || g.nome || '—'}{!g.profile_id && !g.profiles && g.nome ? ' (sem login)' : ''}</option>
                  ))}
                </select>
              )}

              {(filtroGerente || buscaCondo) && (
                <button onClick={() => { setFiltroGerente(''); setBuscaCondo(''); }}
                  className="text-[13px] text-slate-500 hover:text-violet-600 underline underline-offset-2">
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Busca sem resultado — evita a tabela ficar vazia sem explicação */}
          {!isLoading && buscaCondo && condosOrdenados.length === 0 && (
            <div className="px-6 py-12 text-center">
              <Search className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-bold text-slate-700">Nenhum condomínio encontrado para &ldquo;{buscaCondo}&rdquo;</p>
              <p className="text-xs text-slate-500 mt-1">Tente o código (ex.: 002) ou parte do nome.</p>
              <button onClick={() => setBuscaCondo('')}
                className="mt-3 text-[10px] font-black uppercase tracking-widest text-violet-600 hover:text-violet-500">
                Limpar busca
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="p-6">
              <SkeletonTable rows={8} cols={4} />
            </div>
          ) : condos.length > 0 && condosOrdenados.length > 0 ? (
            <>
            {/* Desktop: tabela */}
            <div className="hidden md:block overflow-x-auto flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                    <th className="px-4 py-2.5">
                      <button onClick={() => setOrdemAsc(v => !v)}
                        className="inline-flex items-center gap-1 hover:text-violet-600 transition-colors"
                        title={ordemAsc ? 'Ordem: menor → maior (clique para inverter)' : 'Ordem: maior → menor (clique para inverter)'}>
                        Condomínio <ArrowUpDown className="w-3 h-3" />
                        <span className="text-[11px] text-violet-600">{ordemAsc ? '↑' : '↓'}</span>
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
                    const procStatus   = statusPlanilha(c.id) || proc?.status || null;
                    const emissaoStatus = emissaoByCondominio[c.id] || null;
                    const isLocked     = procStatus === 'Edição finalizada';

                    const nCanceladas = canceladasPorCondo[c.id] || 0;

                    return (
                      <Fragment key={c.id}>
                      {nCanceladas > 0 && (
                        <tr>
                          <td colSpan={99} className="px-4 pt-2">
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); handleVerCancelada(c.id); }}
                              title="Ver os arquivos da emissão cancelada"
                              className="inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 transition-colors hover:bg-rose-100">
                              <Ban className="h-3 w-3" aria-hidden="true" />
                              {nCanceladas === 1 ? 'Há emissão cancelada neste mês' : `Há ${nCanceladas} emissões canceladas neste mês`}
                              <span className="font-bold normal-case tracking-normal opacity-80">· ver arquivos</span>
                            </button>
                          </td>
                        </tr>
                      )}
                      <tr
                        onClick={podeEmitir ? () => abrirEmissao(c) : undefined}
                        role={podeEmitir ? 'button' : undefined}
                        tabIndex={podeEmitir ? 0 : undefined}
                        onKeyDown={podeEmitir ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirEmissao(c); } } : undefined}
                        title={podeEmitir ? `Montar a emissão de ${c.name}` : undefined}
                        className={`hover:bg-slate-100 transition-colors group ${podeEmitir ? 'cursor-pointer' : ''}`}>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-2">
                            {isLocked
                              ? <Lock    className="w-3 h-3 text-rose-500 shrink-0" />
                              : <Unlock  className="w-3 h-3 text-emerald-500/50 shrink-0" />
                            }
                            <div>
                              <p className={`${tipo.item} group-hover:text-violet-600 transition-colors truncate flex items-center gap-1.5`}>
                                {c.name}
                                {c.tem_consumo && <TagConsumo concessionarias={concessionariasPorCondo[c.id]} />}
                                <TagPrioritario condo={c} mes={mesEmissao} ano={vigente.ano} onEditar={abrirPrioridadeDe} />
                              </p>
                              <p className={`${tipo.apoio} flex items-center gap-1.5 flex-wrap`}>
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
                        {/* stopPropagation: sem isto, clicar num ícone dispara
                            TAMBÉM o clique da linha e a pessoa acaba na emissão. */}
                        <td className="px-4 py-2" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            {!fazEmissao && (
                              <>
                                <Link href={`/condominio/${c.id}/arrecadacoes`} className={btn.iconeDiscreto} title="Arrecadações" aria-label="Arrecadações"><Layers className="w-4 h-4" aria-hidden="true" /></Link>
                                <Link href={`/carteiras/cobrancas?condo=${c.id}`}    className={btn.iconeDiscreto} title="Cobranças" aria-label="Cobranças"><Receipt className="w-4 h-4" aria-hidden="true" /></Link>
                              </>
                            )}
                            <button onClick={() => handleQuickView(c.id)}   className={btn.iconeDiscreto} title="Ver última emissão" aria-label="Ver última emissão"><Eye className="w-4 h-4" aria-hidden="true" /></button>
                          </div>
                        </td>
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards empilhados (mesma info, layout próprio do celular) */}
            <div className="md:hidden flex-1 overflow-y-auto divide-y divide-slate-200">
              {condosOrdenados.map((c) => {
                const proc          = processos[c.id];
                const procStatus    = statusPlanilha(c.id) || proc?.status || null;
                const emissaoStatus = emissaoByCondominio[c.id] || null;
                const isLocked      = procStatus === 'Edição finalizada';
                return (
                  <div key={c.id}
                    onClick={podeEmitir ? () => abrirEmissao(c) : undefined}
                    className={`p-3 active:bg-slate-100 transition-colors ${podeEmitir ? 'cursor-pointer' : ''}`}>
                    {(canceladasPorCondo[c.id] || 0) > 0 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleVerCancelada(c.id); }}
                        title="Ver os arquivos da emissão cancelada"
                        className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-rose-700 active:bg-rose-100">
                        <Ban className="h-3 w-3" aria-hidden="true" />
                        {(canceladasPorCondo[c.id] || 0) === 1 ? 'Há emissão cancelada neste mês' : `Há ${canceladasPorCondo[c.id]} emissões canceladas neste mês`}
                        <span className="font-bold normal-case tracking-normal opacity-80">· ver arquivos</span>
                      </button>
                    )}
                    <div className="flex items-start gap-2">
                      {isLocked
                        ? <Lock className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-1" />
                        : <Unlock className="w-3.5 h-3.5 text-emerald-500/50 shrink-0 mt-1" />}
                      <div className="flex-1 min-w-0">
                        <p className={`${tipo.item} break-words flex items-center gap-1.5 flex-wrap`}>
                          {c.name}
                          {c.tem_consumo && <TagConsumo concessionarias={concessionariasPorCondo[c.id]} />}
                                <TagPrioritario condo={c} mes={mesEmissao} ano={vigente.ano} onEditar={abrirPrioridadeDe} />
                        </p>
                        <p className={tipo.apoio}>
                          {gerenteNomePorId[c.gerente_id] || c.gerente_name || '—'}
                          {c.due_day && <span className="text-slate-400"> · venc. dia {c.due_day}{c.due_day_2 ? ` e ${c.due_day_2}` : ''}</span>}
                        </p>
                      </div>
                      <div className="flex gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {!fazEmissao && (
                          <>
                            <Link href={`/condominio/${c.id}/arrecadacoes`} className={btn.icone} title="Arrecadações" aria-label="Arrecadações"><Layers className="w-4 h-4" aria-hidden="true" /></Link>
                            <Link href={`/carteiras/cobrancas?condo=${c.id}`} className={btn.icone} title="Cobranças" aria-label="Cobranças"><Receipt className="w-4 h-4" aria-hidden="true" /></Link>
                          </>
                        )}
                        <button onClick={() => handleQuickView(c.id)} className={btn.icone} title="Ver última emissão" aria-label="Ver última emissão"><Eye className="w-4 h-4" aria-hidden="true" /></button>
                      </div>
                    </div>
                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 pl-6">
                      <div className="flex items-center gap-1.5">
                        <span className={tipo.rotulo}>Planilha</span>
                        {procStatus ? <StatusBadge status={procStatus} flow="processo" /> : <span className="text-[10px] text-slate-400 font-bold">—</span>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={tipo.rotulo}>Emissão</span>
                        {emissaoStatus ? <StatusBadge status={emissaoStatus} flow="emissao" /> : <span className="text-[10px] text-slate-400 font-bold">—</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          ) : (
            <div className="p-20 text-center flex-1">
              <Inbox className="w-12 h-12 text-slate-700 mx-auto mb-4" />
              <p className="text-slate-700 font-bold">Nenhum condomínio encontrado</p>
            </div>
          )}
        </div>

        {/* Fila de Ocorrências */}
        <div className="h-full">
          {/* A semente evita as 13 consultas de abertura da Fila: os numeros
              ja vieram no painel. Ela continua se atualizando sozinha pelo
              tempo real — o que sai e so a rajada inicial. */}
          <FilaOcorrencias
            semente={data ? { ocorrencias: data.ocorrencias, contagens: data.fila_contagens } : null}
            esperandoPainel={!data && !error}
            onRevalidar={mutate}
          />
        </div>

      </div>

      {/* ── BASE: Stats Principais ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* O numero que importa e a operacao, nao o cadastro. Quem vai entrar
            aparece na propria etiqueta, para nao sumir da vista. */}
        {/* O "+N a entrar" só para quem pode fazer alguma coisa a respeito.
            Para o gerente é ruído: ele não libera condomínio nenhum. */}
        <StatsCard title="Condomínios na operação" value={stats.total} icon={Building} color="cyan" loading={isLoading}
          subtitle={(aEntrarTotal && ['master', 'departamento'].includes(profile?.role)) ? `+${aEntrarTotal} a entrar` : undefined} />
        <StatsCard title="Em Edição"          value={stats.em_edicao}        icon={FileEdit}   color="orange"  loading={isLoading} />
        <StatsCard title="Aguard. Registro"   value={emissaoStats.aguardando} icon={Clock}      color="emerald" loading={isLoading} />
        <StatsCard title="Emissão Registrada" value={emissaoStats.registrada} icon={FileCheck}  color="blue"    loading={isLoading} />
      </div>

      {/* ── BASE: Emissões em Andamento ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-2">
          <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
          <h4 className={tipo.secao}>Emissões em andamento</h4>
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

      {/* Condomínio com concessionária: confere se fatura e relatório estão em
          mãos antes de abrir a emissão. Abrir sem isso cria um pacote que fica
          parado esperando — e ninguém lembra por quê. */}
      <PainelPrioridades
        open={prioridadesOpen}
        onClose={() => { setPrioridadesOpen(false); setFocoPrioridade(null); }}
        condominios={condos}
        foco={focoPrioridade}
        onSalvo={() => mutate()}
      />

      {confirmarConsumo && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setConfirmarConsumo(null)} />
          <div className="relative w-full max-w-md bg-white border border-slate-200 rounded-2xl shadow-2xl p-6 space-y-4">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">{confirmarConsumo.condo.name}</h4>
              <p className="text-xs text-slate-500 mt-0.5">
                Emissão de {String(mesEmissao).padStart(2, '0')}/{vigente.ano}
              </p>
            </div>

            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
              <p className="text-xs font-semibold text-amber-900">Este condomínio tem consumo:</p>
              {confirmarConsumo.concessionarias.length > 0 ? (
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {confirmarConsumo.concessionarias.map(c => (
                    <span key={c} className="inline-flex items-center rounded-md border border-amber-300 bg-white px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                      {c}
                    </span>
                  ))}
                </p>
              ) : (
                // Marcado como "tem consumo" mas sem concessionária cadastrada:
                // a relação de 2025 não cobre todos. Melhor dizer isso do que
                // fingir que não tem.
                <p className="mt-1 text-[11px] text-amber-700">
                  Concessionária não cadastrada — confira qual é antes de emitir.
                </p>
              )}
              <p className="mt-2 text-[11px] text-amber-800 leading-relaxed">
                Você já tem a <strong>fatura</strong> e o <strong>relatório de leitura</strong> em mãos?
                Sem eles a emissão abre, mas fica parada.
              </p>
            </div>

            {/* O estado de cada conta, com a data da leitura e o botão de
                cobrar. É aqui que o emissor descobre que falta — então é aqui
                que ele tem de poder cobrar, sem ir a outra tela. */}
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {contasDoModal === null ? (
                <p className="px-3 py-2.5 text-[11px] text-slate-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Conferindo o que já chegou…
                </p>
              ) : contasDoModal.length === 0 ? (
                <p className="px-3 py-2.5 text-[11px] text-slate-500">
                  Nada registrado ainda para este mês.
                </p>
              ) : contasDoModal.map(ct => (
                <div key={ct.concessionaria} className="px-3 py-2.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-slate-800 w-20 shrink-0">{ct.concessionaria}</span>

                  {ct.ja_anexada ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                      <CheckCircle2 className="w-3.5 h-3.5" /> anexada
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      {ct.leitura_prevista ? (
                        <>
                          leitura {new Date(ct.leitura_prevista + 'T12:00:00').toLocaleDateString('pt-BR')}
                          {ct.leitura_passou
                            ? <span className="text-amber-700 font-semibold"> · já passou, conta não veio</span>
                            : <span className="text-slate-400"> · a conta ainda não foi emitida</span>}
                        </>
                      ) : 'ainda não temos a informação da leitura'}
                    </span>
                  )}

                  {ct.cobranca?.cobrancas > 0 && (
                    <span className="text-[11px] text-slate-400">
                      · {ct.cobranca.cobrancas}ª cobrança
                    </span>
                  )}

                  {!ct.ja_anexada && ct.cobranca?.status !== 'suspensa' && (
                    <button type="button" onClick={() => cobrarConta(ct.concessionaria)}
                      disabled={cobrandoConta === ct.concessionaria}
                      title={`Manda o e-mail agora para o gerente e o assistente de ${confirmarConsumo.condo.name}`}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors">
                      {cobrandoConta === ct.concessionaria
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Send className="w-3 h-3" />}
                      Cobrar
                    </button>
                  )}

                  {ct.cobranca?.status === 'suspensa' && (
                    <span className="ml-auto text-[11px] text-slate-500" title={ct.cobranca.suspensa_motivo}>
                      cobrança suspensa
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button type="button" onClick={() => setConfirmarConsumo(null)}
                className="flex-1 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors">
                Ainda não
              </button>
              <button type="button" onClick={() => { const c = confirmarConsumo.condo; setConfirmarConsumo(null); irParaEmissao(c); }}
                className="flex-[2] py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium text-xs transition-colors">
                Tenho tudo — abrir emissão
              </button>
            </div>
          </div>
        </div>
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
