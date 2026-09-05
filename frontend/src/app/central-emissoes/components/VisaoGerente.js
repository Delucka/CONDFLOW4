'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { createClient } from '@/utils/supabase/client';
import { FileText, CheckCircle, XCircle, Search, Loader2, Package, AlertCircle, Droplet, UserCheck } from 'lucide-react';
import StatusBadge from './StatusBadge';
import TrilhaAprovacao from '@/components/TrilhaAprovacao';
import { proximoStatusAprovacao, registrarNaTrilha, avisoTrilhaFalhou, pedirCorrecao } from '@/lib/aprovacaoFluxo';
import { devolverConjunto, anexarGrupos } from '@/lib/conjuntoEmissao';
import SeloGrupo from './SeloGrupo';
import SeloCancelada, { AvisoCanceladas, MarcaDaguaCancelada } from '@/components/SeloCancelada';
import ComparativoConsumo from './ComparativoConsumo';
import { useToast } from '@/components/Toast';
import VisualizadorConferencia from '@/components/VisualizadorConferencia';
import { useAuth } from '@/lib/auth';
import { abrirArquivoSeguro, getArquivoUrlSeguro } from '@/lib/arquivo';
import { combina } from '@/lib/busca';
import { useRealtime } from '@/lib/realtime';
import { useRevalidarAoVoltar } from '@/lib/useRevalidarAoVoltar';

/**
 * `cobertura` (0117): quando presente, este painel deixa de ser "meus pacotes" e
 * passa a ser a carteira de OUTRO gerente, durante as férias dele.
 *   { ausenciaId, gerenteNome, motivo, dataFim, condoIds }
 * Só muda três coisas: de onde vêm os pacotes, o aviso no topo, e o contexto que
 * vai junto da assinatura na trilha.
 */
export default function VisaoGerente({ profile, cobertura = null }) {
  const supabase = createClient();
  const { addToast } = useToast();
  const { user } = useAuth();

  const [pacotes, setPacotes] = useState([]);
  const [loading, setLoading] = useState(true);
  // Ver o comentário em fetchPacotes(): distingue primeira carga de rebusca.
  const jaCarregouRef = useRef(false);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [termoBusca, setTermoBusca] = useState('');
  const [consumoAberto, setConsumoAberto] = useState(null);   // pacote com o comparativo aberto
  const [arquivoAberto, setArquivoAberto] = useState(null);

  // Modal de correção
  const [showModal, setShowModal] = useState(false);
  const [currentPacote, setCurrentPacote] = useState(null);
  const [comment, setComment] = useState('');

  // Detecta perfil do usuário pra ajustar o fetch e o filtro "minha aprovação"
  const role = profile?.role;
  const isSupervisor = ['supervisora', 'supervisora_contabilidade', 'supervisor_gerentes'].includes(role);

  async function fetchPacotes() {
      // Spinner de tela cheia SÓ na primeira carga. Antes, todo rebusca (voltar
      // para a aba, evento do realtime) acendia o spinner e desmontava a árvore:
      // carteira expandida fechava, rolagem voltava ao topo, filtro parecia
      // "sair de ordem". O dado nem mudava — o que se perdia era o lugar.
    if (!jaCarregouRef.current) setLoading(true);
    try {
      let pacotesData = [];

      if (cobertura) {
        // Cobrindo férias: os condomínios vêm da divisão feita na criação do
        // período. A RPC `get_pacotes_gerente` não serve aqui — ela resolve a
        // carteira por quem eu SOU, e estes condomínios são de outra pessoa.
        // Quem autoriza de verdade é o RLS (0117), não esta consulta.
        if (!cobertura.condoIds?.length) { setPacotes([]); setLoading(false); return; }
        const { data, error } = await supabase
          .from('emissoes_pacotes')
          .select('*, condominios(name)')
          .in('condominio_id', cobertura.condoIds)
          .order('atualizado_em', { ascending: false });
        if (error) {
          console.error('[VisaoGerente/cobertura] erro:', error);
          addToast('Não consegui carregar a carteira de ' + cobertura.gerenteNome + ': ' + error.message, 'error');
          setPacotes([]); setLoading(false); return;
        }
        pacotesData = (data || []).map(p => ({ ...p, condo_name: p.condominios?.name }));
      } else if (isSupervisor) {
        // Supervisor: vê TODOS os pacotes (sem filtro de carteira)
        const { data, error } = await supabase
          .from('emissoes_pacotes')
          .select('*, condominios(name)')
          .order('atualizado_em', { ascending: false });
        if (error) {
          console.error('[VisaoGerente/sup] erro:', error);
          setPacotes([]); setLoading(false); return;
        }
        pacotesData = (data || []).map(p => ({
          ...p,
          condo_name: p.condominios?.name,
        }));
      } else {
        // Gerente: RPC filtra pela carteira
        const { data, error } = await supabase.rpc('get_pacotes_gerente');
        if (error) {
          console.error('[VisaoGerente] erro rpc:', error);
          setPacotes([]); setLoading(false); return;
        }
        pacotesData = data || [];
      }

      if (pacotesData.length > 0) {
        const pacoteIds = pacotesData.map(p => p.id);
        const { data: arquivos } = await supabase
          .from('emissoes_arquivos')
          .select('id, pacote_id, arquivo_nome, arquivo_url, formato, categoria, subtipo, nome_condominio_fatura, vencimento_fatura, valor_fatura, relatorio_empresa, relatorio_tipo_servico, relatorio_data_leitura, relatorio_unidades, relatorio_consumo_total, relatorio_valor_total, extracao_dados_brutos, condominio_id, mes_referencia, ano_referencia')
          .in('pacote_id', pacoteIds);

        const arqMap = {};
        (arquivos || []).forEach(a => {
          if (!arqMap[a.pacote_id]) arqMap[a.pacote_id] = [];
          arqMap[a.pacote_id].push(a);
        });

        // Trilha de aprovação (quem aprovou e quando) — visível para todos
        const { data: aprovacoes } = await supabase
          .from('emissoes_pacotes_aprovacoes')
          .select('pacote_id, acao, role, usuario_nome, usuario_email, criado_em')
          .in('pacote_id', pacoteIds)
          .order('criado_em', { ascending: true });
        const aprMap = {};
        (aprovacoes || []).forEach(a => { (aprMap[a.pacote_id] = aprMap[a.pacote_id] || []).push(a); });

        const comGrupo = await anexarGrupos(supabase, pacotesData);
        setPacotes(comGrupo.map(p => ({
          ...p,
          condominios: p.condominios || { name: p.condo_name },
          arquivos: arqMap[p.id] || [],
          aprovacoes: aprMap[p.id] || [],
        })));
      } else {
        setPacotes([]);
      }
    } catch (err) {
      console.error('[VisaoGerente] erro geral:', err);
    }
    jaCarregouRef.current = true;
    setLoading(false);
  }

  useEffect(() => {
    fetchPacotes();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRealtime(['emissoes_pacotes'], () => fetchPacotes());

  // Voltou para a aba: rebusca (o realtime não sobrevive à aba dormindo).
  useRevalidarAoVoltar(() => fetchPacotes());

  async function handleAprovar(pacote) {
    // Só vira 'aprovado' quando TODOS os cargos do nível assinaram (via trilha)
    const nextStatus = await proximoStatusAprovacao(supabase, pacote.id, pacote.nivel_aprovacao, user?.role);
    const agora = new Date().toISOString();
    const payload = { status: nextStatus, atualizado_em: agora };
    if (nextStatus === 'aprovado') {
      payload.aprovado_por_nome = user?.full_name || user?.email || null;
      payload.aprovado_por_role = user?.role || null;
      payload.aprovado_em = agora;
    }

    const { data, error } = await supabase
      .from('emissoes_pacotes')
      .update(payload)
      .eq('id', pacote.id)
      .select('id, status');

    if (error) {
      addToast('Não foi possível aprovar: ' + error.message, 'error');
    } else if (!data || data.length === 0) {
      // RLS bloqueou o update silenciosamente (0 linhas afetadas)
      addToast('Aprovação bloqueada pelas regras de acesso. Avise o admin.', 'error');
    } else {
      const { error: errTrilha } = await registrarNaTrilha(supabase, {
        pacoteId: pacote.id, acao: 'aprovacao', user,
        // "aprovado por Denner · férias da Suellen"
        emNomeDe: cobertura?.gerenteNome || null,
        motivo: cobertura?.motivo || null,
      });
      if (errTrilha) addToast(avisoTrilhaFalhou('aprovacao', errTrilha), 'error');
      addToast(nextStatus === 'aprovado' ? 'Pacote aprovado!' : `Enviado para: ${nextStatus}`, 'success');
      fetchPacotes();
    }
  }

  function abrirModalCorrecao(pacote) {
    setCurrentPacote(pacote);
    setComment('');
    setShowModal(true);
  }

  async function confirmarCorrecao() {
    if (!comment) return addToast('Comentário é obrigatório.', 'warning');

    // De onde a emissão saiu — é para cá que ela volta depois de corrigida.
    // Guardar o MARCO, e não o papel de quem pediu, é o que faz a volta
    // funcionar mesmo quando o master pede em nome de outra pessoa.
    //
    // `pedirCorrecao` tolera a coluna do marco não existir ainda: sem isso, um
    // campo novo derruba o pedido de correção inteiro até a migration rodar.
    const { error, semMarco } = await pedirCorrecao(supabase, currentPacote.id, {
      status: 'solicitar_correcao',
      comentario_correcao: comment,
      atualizado_em: new Date().toISOString(),
      status_pre_correcao: currentPacote.status,
      correcao_por_nome: user?.full_name || user?.email || null,
      correcao_em: new Date().toISOString(),
    });
    if (semMarco) {
      addToast('Correção enviada, mas o banco ainda não tem a coluna do marco (rode a 0102) — '
             + 'a volta pode não ser para você.', 'warning');
    }

    if (error) {
      addToast('Falha ao solicitar correção.', 'error');
    } else {
      // Marca o ciclo: aprovações anteriores deixam de valer (re-conferência do zero)
      const { error: errTrilha } = await registrarNaTrilha(supabase, {
        pacoteId: currentPacote.id, acao: 'correcao', user,
      });
      if (errTrilha) addToast(avisoTrilhaFalhou('correcao', errTrilha), 'error');

      // O conjunto volta junto: se este condomínio emite em dois vencimentos,
      // deixar um lado aprovado e o outro em correção manda meio mês de boleto.
      const { devolvidas, error: errConj } =
        await devolverConjunto(supabase, currentPacote, { comentario: comment, user });
      if (errConj) addToast('A emissão voltou, mas não consegui devolver as outras do mês: ' + errConj.message, 'error');

      addToast(devolvidas
        ? `Correção solicitada. As ${devolvidas + 1} emissões do mês voltaram juntas, sem aprovação anterior.`
        : 'Correção solicitada. As aprovações anteriores foram retiradas.', 'success');
      setShowModal(false);
      fetchPacotes();
    }
  }

  async function openFileUrl(doc, pacote) {
    const url = await getArquivoUrlSeguro(doc.arquivo_url);
    if (!url) return addToast('Erro ao gerar link.', 'error');
    if (url) {
      setArquivoAberto({
        id: doc.id,
        nome: doc.arquivo_nome,
        url: url,
        processo_id: pacote.processo_id || null,
        pacote_id: pacote.id,
        pacote_status: pacote.status,
        pacote_nivel: pacote.nivel_aprovacao,
        comentario_correcao: pacote.comentario_correcao || null,
        correcao_arquivo_url: pacote.correcao_arquivo_url || null,
        correcao_arquivo_nome: pacote.correcao_arquivo_nome || null,
        resposta_correcao_comentario: pacote.resposta_correcao_comentario || null,
        resposta_correcao_arquivo_url: pacote.resposta_correcao_arquivo_url || null,
        resposta_correcao_arquivo_nome: pacote.resposta_correcao_arquivo_nome || null,
        resposta_correcao_em: pacote.resposta_correcao_em || null,
        condominio_id: pacote.condominio_id,
        mes: pacote.mes_referencia,
        ano: pacote.ano_referencia,
        eh_retificacao: pacote.eh_retificacao || false,
        emitido_por: pacote.uploaded_by,
        arquivos: pacote.arquivos || [],
      });
    }
  }

  // Define que status conta como "minha aprovação" baseado no role
  // - gerente:                  Aguardando Gerente / pendente_gerente / pendente
  // - supervisor_gerentes:      Aguardando Chefe / pendente_sup_gerentes
  // - supervisora/sup_contab:   Aguardando Supervisor / pendente_sup_contabilidade
  function isMinhaAprovacao(s) {
    s = (s || '').toLowerCase();
    if (role === 'gerente') return s.includes('aguardando gerente') || s === 'pendente_gerente' || s === 'pendente';
    if (role === 'supervisor_gerentes') return s.includes('aguardando chefe') || s === 'pendente_sup_gerentes';
    if (role === 'supervisora_contabilidade' || role === 'supervisora') return s.includes('aguardando supervisor') || s === 'pendente_sup_contabilidade';
    return false;
  }
  // "Em outra etapa" = pacotes em fluxo de aprovação mas não com este role
  function isEmOutraEtapa(s) {
    s = (s || '').toLowerCase();
    if (!s || s === 'rascunho' || s === 'aprovado' || s === 'registrado' || s === 'expedida' || s === 'solicitar_correcao') return false;
    return !isMinhaAprovacao(s);
  }

  // Filtragem
  const filtered = useMemo(() => {
    return pacotes.filter(p => {
      const s = (p.status || '').toLowerCase();
      if (s === 'rascunho') return false;

      if (filtroStatus !== 'todos') {
        if (filtroStatus === 'pendente_gerente') {
          if (!isMinhaAprovacao(s)) return false;
        } else if (filtroStatus === 'em_supervisor') {
          if (!isEmOutraEtapa(s)) return false;
        } else {
          if (s !== filtroStatus) return false;
        }
      }

      if (termoBusca) return combina(termoBusca, p.condominios?.name);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pacotes, filtroStatus, termoBusca, role]);

  // Contadores para badges nas abas
  const counts = useMemo(() => ({
    pendente_gerente:   pacotes.filter(p => isMinhaAprovacao(p.status)).length,
    em_supervisor:      pacotes.filter(p => isEmOutraEtapa(p.status)).length,
    aprovado:           pacotes.filter(p => (p.status||'').toLowerCase() === 'aprovado').length,
    solicitar_correcao: pacotes.filter(p => (p.status||'').toLowerCase() === 'solicitar_correcao').length,
    todos:              pacotes.filter(p => (p.status||'').toLowerCase() !== 'rascunho').length,
    cancelada:          pacotes.filter(p => (p.status||'').toLowerCase() === 'cancelada').length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pacotes, role]);

  // Labels da aba "Em outra etapa" mudam por role
  const labelOutraEtapa = isSupervisor ? 'Outras etapas' : 'Em Supervisor';

  const FILTROS = [
    { value: 'pendente_gerente',   label: 'Aguard. minha aprovação' },
    { value: 'em_supervisor',      label: labelOutraEtapa            },
    { value: 'aprovado',           label: 'Aprovado'                 },
    { value: 'solicitar_correcao', label: 'Correção'                 },
    { value: 'todos',              label: 'Todos'                    },
    // Quem aprova também precisa achar a cancelada: é onde está o motivo que
    // explica por que existe uma emissão nova do mesmo mês. Só aparece quando
    // há alguma.
    ...(counts.cancelada > 0 ? [{ value: 'cancelada', label: 'Canceladas' }] : []),
  ];


  const avisoCobertura = cobertura ? (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
      <UserCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-amber-900">
          Carteira de {cobertura.gerenteNome} — {String(cobertura.motivo || 'Férias').toLowerCase()}
        </p>
        <p className="text-[12px] text-amber-800 mt-0.5">
          Você responde por {cobertura.condoIds?.length || 0} condomínio(s) até{' '}
          <strong>{new Date(cobertura.dataFim + 'T12:00:00').toLocaleDateString('pt-BR')}</strong>.
          O que você aprovar fica registrado no seu nome, com a observação de que era cobertura.
          Depois dessa data eles somem daqui e voltam para {cobertura.gerenteNome}.
        </p>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      {avisoCobertura}

      {/* Deixa explícito que aqui é a EMISSÃO (etapa 2), não a planilha (etapa 1) */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium px-2.5 py-1 rounded-lg bg-emerald-600 text-white">
          Etapa 2 · Emissão
        </span>
        <span className="text-[10px] text-slate-500">
          Aqui você <b className="text-slate-700">confere e aprova o documento</b> da emissão. Os <b className="text-slate-700">valores</b> são definidos antes, na Planilha.
        </span>
      </div>

      {/* Filtros */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between border border-slate-200 rounded-3xl bg-slate-50 p-4 shadow-xl">
        <div className="flex gap-2 w-full md:w-auto overflow-x-auto pb-2 md:pb-0 hide-scrollbar">
          {FILTROS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFiltroStatus(value)}
              className={`relative px-4 py-2.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${
                filtroStatus === value
                  ? 'bg-violet-600 text-white '
                  : 'bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {label}
              {counts[value] > 0 && (
                <span className={`ml-2 text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                  filtroStatus === value ? 'bg-slate-100 text-slate-700' : 'bg-violet-500/20 text-violet-400'
                }`}>
                  {counts[value]}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="Buscar condomínio..."
            value={termoBusca}
            onChange={e => setTermoBusca(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-900 focus:border-violet-500 outline-none transition-colors"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="animate-spin w-8 h-8 text-violet-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-12 border border-slate-200 rounded-3xl bg-slate-50 flex flex-col items-center gap-3">
          <AlertCircle className="w-8 h-8 text-slate-400" />
          <span className="text-slate-500 text-sm">
            {pacotes.length === 0
              ? 'Nenhuma emissão encontrada para a sua carteira.'
              : 'Nenhum pacote nesta categoria.'}
          </span>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(pacote => {
            const numArquivos = pacote.arquivos?.length || 0;
            const s = (pacote.status || '').toLowerCase();
            const aguardandoGerente = isMinhaAprovacao(s);
            // Aprovar sem saber que a emissão anterior do mesmo mês foi
            // cancelada é aprovar sem o motivo — e o motivo é justamente o que
            // ficou guardado quando ela foi descartada.
            const canceladasDoCondo = s === 'cancelada'
              ? []
              : pacotes.filter(o =>
                  o.condominio_id === pacote.condominio_id
                  && o.mes_referencia === pacote.mes_referencia
                  && o.ano_referencia === pacote.ano_referencia
                  && (o.status || '').toLowerCase() === 'cancelada');

            return (
              <div key={pacote.id} className={`tem-marca-dagua relative overflow-hidden rounded-2xl bg-white ${
                s === 'cancelada' ? 'border border-rose-300' : 'border border-slate-200'}`}>
                {s === 'cancelada' && <MarcaDaguaCancelada />}
                {canceladasDoCondo.length > 0 && (
                  <div className="px-5 pt-4">
                    <AvisoCanceladas canceladas={canceladasDoCondo} />
                  </div>
                )}
                {/* Header */}
                <div className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500/20 to-violet-500/20 border border-slate-200 flex items-center justify-center shrink-0">
                      <Package className="w-5 h-5 text-violet-400" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-900 text-sm truncate">{pacote.condominios?.name || '—'}</h4>
                      <SeloGrupo pacote={pacote} className="my-1" />
                      {/* Quem aprova precisa ver o cancelamento e o motivo: sem
                          isso, olharia uma emissão descartada como se ainda
                          estivesse em jogo. */}
                      <SeloCancelada pacote={pacote} className="my-1" />
                      <p className="text-[10px] font-bold text-violet-400 ">
                        {String(pacote.mes_referencia).padStart(2, '0')}/{pacote.ano_referencia}
                        {' • '}{numArquivos} arquivo{numArquivos !== 1 ? 's' : ''}
                      </p>
                      <TrilhaAprovacao pacote={pacote} />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 flex-wrap sm:justify-end pl-[60px] sm:pl-0">
                    <StatusBadge status={pacote.status} />
                    {aguardandoGerente && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => abrirModalCorrecao(pacote)}
                          className="w-9 h-9 rounded-xl bg-slate-50 border border-slate-200 text-rose-400 hover:bg-rose-500 hover:text-white hover:border-rose-500 flex items-center justify-center transition-all"
                          title="Solicitar Correção"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleAprovar(pacote)}
                          className="w-9 h-9 rounded-xl bg-violet-600  text-white hover:bg-violet-500 flex items-center justify-center transition-all"
                          title="Aprovar Pacote"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Consumo do mês anterior — quem aprova decide sem isso hoje.
                    Sob demanda: montar em toda linha seria uma consulta por
                    cartão, e a lista tem dezenas. */}
                <div className="border-t border-slate-200 px-5 py-2">
                  <button type="button"
                    onClick={() => setConsumoAberto(v => (v === pacote.id ? null : pacote.id))}
                    aria-expanded={consumoAberto === pacote.id}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-500 hover:text-violet-700 transition-colors">
                    <Droplet className="w-3.5 h-3.5" />
                    {consumoAberto === pacote.id ? 'Ocultar consumo' : 'Comparar consumo com o mês anterior'}
                  </button>
                  {consumoAberto === pacote.id && (
                    <div className="mt-3">
                      <ComparativoConsumo
                        condominioId={pacote.condominio_id}
                        mes={pacote.mes_referencia}
                        ano={pacote.ano_referencia}
                        arquivosAtuais={pacote.arquivos}
                      />
                    </div>
                  )}
                </div>

                {/* Arquivos */}
                {numArquivos > 0 && (
                  <div className="border-t border-slate-200 bg-slate-50 px-5 py-3">
                    <div className="flex flex-wrap gap-2">
                      {pacote.arquivos.map(arq => (
                        <button
                          key={arq.id}
                          onClick={() => openFileUrl(arq, pacote)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 rounded-xl hover:border-violet-500/30 hover:bg-violet-500/5 transition-all group"
                        >
                          <FileText className="w-3 h-3 text-slate-500 group-hover:text-violet-400" />
                          <span className="text-[11px] font-bold text-slate-500 group-hover:text-slate-900 truncate max-w-[140px]">{arq.arquivo_nome}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Comentário de correção */}
                {s === 'solicitar_correcao' && pacote.comentario_correcao && (
                  <div className="px-5 py-3 bg-rose-500/5 border-t border-rose-500/10 space-y-2">
                    <p className="text-xs text-rose-400">
                      <span className="font-semibold">Correção:</span> {pacote.comentario_correcao}
                    </p>
                    {pacote.correcao_arquivo_url && (
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          const ok = await abrirArquivoSeguro(pacote.correcao_arquivo_url);
                          if (!ok) addToast('Erro ao abrir anexo', 'error');
                        }}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[11px] font-bold">
                        📎 {pacote.correcao_arquivo_nome || 'Ver anexo da correção'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Correção */}
      {showModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-xl font-semibold text-slate-900 mb-1">Solicitar Correção</h3>
            <p className="text-xs text-slate-500 mb-5 font-medium">
              {currentPacote?.condominios?.name} — {String(currentPacote?.mes_referencia).padStart(2,'0')}/{currentPacote?.ano_referencia}
            </p>
            <textarea
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-900 focus:border-rose-500 outline-none min-h-[110px] mb-5"
              placeholder="Descreva o que precisa ser ajustado..."
              value={comment}
              onChange={e => setComment(e.target.value)}
            />
            <div className="flex items-center gap-3 justify-end">
              <button onClick={() => setShowModal(false)} className="px-5 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">
                Cancelar
              </button>
              <button onClick={confirmarCorrecao} className="px-5 py-2.5 rounded-xl text-xs font-medium bg-rose-500 text-white hover:bg-rose-400 transition-colors">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Visualizador de arquivo */}
      {arquivoAberto && (
        <VisualizadorConferencia
          arquivo={arquivoAberto}
          arquivos={arquivoAberto.arquivos}
          currentUser={user}
          onClose={() => setArquivoAberto(null)}
          onAction={() => { setArquivoAberto(null); fetchPacotes(); }}
        />
      )}
    </div>
  );
}
